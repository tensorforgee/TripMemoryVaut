# Trip Memory Vault — implementation architecture

Architecture baseline: 26 September 2026. Target: one TypeScript developer, Android first, iOS later, approximately 100 trips and 10,000 photos per vault.

**Decision:** build a React Native application with Expo development builds, SQLite as its operational database, app-owned original image files, MapLibre for maps, and portable export/restore. No account is required. Add optional Supabase backup and synchronization after the local product passes its durability tests.

This document specifies one architecture. “V1” means the local release; cloud behavior is a concrete extension contract, not a requirement to build a distributed system before shipping. Package versions must be pinned together after the initial device compatibility spike; floating `latest` dependencies are not a release configuration. Performance numbers below are proposed acceptance targets, not measured results.

## 1. App boundaries and invariants

The product is a private, retrospective archive of trips, places, people, photos, and recollections. Its primary workflow happens after travel. An old trip with only a title and an uncertain date is valid. The product does not require diary writing or activity during a trip.

Core actions: create or resume a draft; import selected photos; correct suggested dates and stops; record a memory; organize companions, chapters, and tags; revisit a trip; explore visited and dreamed-of places; search; export, restore, and delete.

Excluded: bookings, itinerary generation, recommendations, public feeds, followers, expenses, live GPS collection, collaborative editing, AI inference, and video processing. Imported tracks may be supported later without adding tracking.

Core objects are Trip, TripDay, Place, Stop, Media, TripMedia, Memory, Companion, Chapter, Tag, DreamDestination, and the relationships between them. Stays are attributes of a stop. A local Vault is the ownership boundary. An authentication user is infrastructure, not a travel companion.

Product invariants:

1. **A saved trip remains readable offline when its metadata and required media are local.** Maps degrade to local geometry and a stop list when the basemap is unavailable. A cloud restore explicitly reports media that is not downloaded yet.
2. **“Imported” means an app-owned durable copy exists.** A picker URI, camera-roll identifier, thumbnail, or pending cloud upload is not an archived original.
3. **Unknown stays unknown.** Approximate dates, uncertain order, missing GPS, and generated routes are represented and visibly labeled. No guessed midnight timestamps or invented historical paths.
4. **Evidence is immutable; interpretations are editable.** Preserve received original bytes and parsed source metadata separately from corrections and trip assignments.
5. **Place identity and visit identity are separate.** Rakchham is a Place; stopping there twice produces two Stops, even in the same Trip.
6. **Every visible edit is durable locally before “Saved” appears.** Cloud failures cannot roll it back. Drafts survive process death.
7. **Deleting one photo placement does not destroy a shared original.** Only unreferenced media past retention can be collected.
8. **Export preserves meaning without the app.** Machine-readable data, original media, route provenance, and a readable HTML journal travel together.
9. **No silent loss through sync.** Concurrent conflicting versions and deletion conflicts remain recoverable until resolved.
10. **Statistics describe confirmed archive content.** Dreams, draft candidates, pass-through points, and unknown geography do not manufacture visited places.

## 2. Domain model and semantics

### Time is a value object, not a mandatory timestamp

Use this validated `DateSpec` JSON value for trip dates and optional stop/stay dates:

```ts
type PartialDate =
  | { precision: 'day'; value: string }   // YYYY-MM-DD
  | { precision: 'month'; value: string } // YYYY-MM
  | { precision: 'year'; value: string }  // YYYY
  | { precision: 'unknown' };

type DateSpec = {
  start: PartialDate;
  end: PartialDate | null; // null = end unknown, NOT same as start
  certainty: 'exact' | 'approximate' | 'unknown';
  source: 'user' | 'photo_suggestion' | 'import';
  label?: string;         // e.g. "summer after college"
};
```

“December 2022” uses month precision and unknown end; “2022” uses year precision. Fully unknown uses unknown start/end and certainty unknown. Approximate day-level values remain marked approximate. Validate calendar dates and feasible endpoint order; allow incomplete intervals. Persist derived `sort_date` and `sort_precision` for browsing only. They are never displayed as known dates. Unknown trips have an “Undated” section; trips spanning years can appear in each intersected year filter, with totals deduplicated by trip ID.

For exact endpoints, duration is inclusive calendar days, so 12–16 June is **5 days**, independent of DST. Otherwise show “About 5 days” only if the user supplied an estimated duration, or omit duration. Store an optional `duration_estimate_days`; do not infer a five-day stay from five photographed days. Empty days between exact endpoints are legitimate.

Capture time uses a separate `CaptureTime` value: local date-time string, optional UTC instant, optional offset minutes, optional IANA zone, precision, source, and warnings. EXIF without an offset is a floating wall time. Device timezone today is not evidence of the trip timezone. A user-selected grouping zone can be an explicit assumption without altering source metadata.

### Entity decisions

- **Vault, not a required User profile:** generate one local vault UUID on first launch. It can later be attached to one authenticated owner. No public profile.
- **TripDay exists:** an editable narrative section with stable identity and ordering. It can have an exact date, an approximate label, a multi-day range, or no date. The UI calls non-single-day sections “Early in the trip” or “Part 2”, not a falsely exact “Day 2”.
- **Stop exists:** an occurrence of a place along a trip. `kind=visit|stay|transit`; repeated place IDs are allowed. A stay adds optional lodging label and check-in/out DateSpecs. No booking entity.
- **Media and TripMedia both exist:** Media is a byte-identified asset; TripMedia is its use in a particular trip, including caption, day, stop, order, and favourite status. A shared asset can appear in two trips with different captions.
- **Memory exists:** plain text of any practical length with a trip owner and zero or one explicit contextual anchor: a day, stop, or TripMedia. A photo anchor inherits its place/day context. This avoids inconsistent multiple anchors.
- **Notes use Memory with `kind=note`:** no separate diary or notes subsystem. `kind=memory` can be favourite or the opening memory.
- **Route segments are derived in V1:** ordered stops create a remembered route. No redundant row per straight line. RouteArtifact is a deferred extension for recorded, photo-derived, and generated geometry, described in section 7.
- **Chapters and Tags both exist:** chapters are intentional albums with descriptions and ordering; tags are short filters. Both are many-to-many with trips.
- **DreamVisit exists:** a dream can be fulfilled by several stops across several trips. A dream is never replaced by a trip.
- **Statistics, visited countries, visited states, and companion trip lists are derived queries**, not mutable counters or separate history tables.

### Relationship and consistency rules

```text
Vault ──< Trip ──< TripDay
             ├──< Stop >── Place
             ├──< TripMedia >── Media
             ├──< Memory
             ├──< TripCompanion >── Companion
             ├──< TripChapter >── Chapter
             └──< TripTag >── Tag
Place ──< DreamDestination ──< DreamVisit >── Stop
```

All nested references must stay inside the same vault and trip. A TripMedia's day and stop may coexist; if the stop has a day assignment, it must match the photo's day. Moving a stop/day offers to move its photos; it never changes source capture times. A Memory anchored to a photo follows that placement, not every use of its underlying Media.

Place coordinates can be null. Names alone are valid; no marker is rendered at `(0,0)` for missing coordinates. Coordinates require latitude and longitude together with ranges checked. Preserve coordinate source and precision. Places are private to a vault; do not establish a shared global place catalog in V1. Similar names/nearby coordinates suggest a merge but do not automatically merge distinct locations. Merging places rewrites references transactionally, preserving original names and provenance in an alias list on the surviving Place.

## 3. Database design

### Local and future remote databases

Use **SQLite locally**, via `expo-sqlite`, with SQL migrations and typed repository functions. Enable foreign keys on every connection, WAL, a busy timeout, and explicit transactions; select `synchronous=FULL` for archive writes and measure import throughput. Use bound parameters. Expo exposes persistent SQLite and supports FTS configuration. [Expo SQLite documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/)

Use **PostgreSQL in Supabase remotely only for the optional cloud extension**. Map UUID strings to Postgres UUID, JSON text to JSONB, booleans to boolean, UTC timestamp strings to timestamptz, and calendar-day strings to date where they are exact. Partial dates remain validated JSON. Do not copy SQLite files to a server for synchronization.

Client-generated random UUIDv4 IDs are stable through export and sync. Never derive identity from titles, timestamps, coordinates, or autoincrement counters. File hashes identify content, not record ownership. Local timestamps are for display/audit; server revisions and sequence numbers decide sync order.

### Shared column conventions

Every domain table below has `id` (required UUID PK), `vault_id` (required FK), `created_at` and `updated_at` (required UTC RFC3339), and `deleted_at` (optional UTC tombstone). Vault itself uses `id` as its boundary instead of a self FK. Every table has `UNIQUE(vault_id,id)` where required for compound FKs. Every active query excludes tombstones and children of deleted parents.

Optional cloud rollout adds `server_rev` (required integer default 0), `last_device_id` (optional UUID); local acknowledged bases and pending work live in side tables. Client/server checks validate payload shape, integer ranges, and allowed enums. `?` below means nullable; all other fields are required, with explicit defaults where appropriate. JSON types refer to versioned, tested value objects, not unstructured bags.

### Domain schema, indexes, uniqueness, and deletion

In this table, “trash” means a soft delete with a 30-day undo period. “Purge” means permanent deletion after eligibility checks. Referenced parent rows use physical `RESTRICT`; user-facing cascades and detachments run as explicit transactions so they can be synced and undone.

| Table / purpose | Fields beyond shared columns | Relationships / indexes / uniqueness | Deletion rule |
|---|---|---|---|
| `vaults` — private archive | `name`, `format_version`; local settings stored separately | PK `id`; cloud ownership in `vault_owners` | Local erase explicitly removes DB/media; cloud erasure is a separate operation |
| `trips` — journey | `title`, `status=draft|saved`, `dates_json`, `sort_date?`, `sort_precision`, `duration_estimate_days?`, `summary?`, `is_favourite=false`, `cover_trip_media_id?`, `opening_memory_id?`, `order_revision=0` | Index `(vault_id,status,deleted_at,sort_date,id)`; cover/opening references must belong to trip; names not unique | Trash aggregate and hide children; restore aggregate; purge children before parent |
| `trip_days` — narrative sections | `trip_id`, `position`, `label?`, `dates_json?` | FK Trip; index `(trip_id,deleted_at,position,id)`; unique active `(trip_id,position)` | Detach associated photos/stops/memories to trip-level, then trash; preserve content |
| `places` — reusable location | `name`, `latitude?`, `longitude?`, `coordinate_precision=unknown|point|area`, `country_code?`, `subdivision_code?`, `source=user|exif|provider|import`, `provider?`, `provider_place_id?`, `provenance_json`, `aliases_json=[]` | Index `(vault_id,name)` and coordinate bounding-box indexes; unique active `(vault_id,provider,provider_place_id)` when ID non-null; no uniqueness on name/coordinates | Reject deletion while live stops/dreams refer; offer merge or detach-and-retain-label first |
| `stops` — visit occurrence, including stay | `trip_id`, `place_id`, `day_id?`, `position`, `kind=visit|stay|transit`, `visit_confirmed=true`, `dates_json?`, `note?`, `lodging_label?`, `checkout_dates_json?`, `source=user|photo_suggestion|import`, `detail_certainty=exact|approximate|unknown` | FKs Trip/Place/Day; unique active `(trip_id,position)`; indexes `(place_id,deleted_at,trip_id)`, `(trip_id,day_id,position)` | Detach photo/memory anchors to trip; trash DreamVisit links; trash stop; original media retained |
| `media` — immutable received file and evidence | `sha256`, `byte_size`, `mime_type`, `extension`, `width?`, `height?`, `original_filename?`, `source_metadata_json`, `source_fidelity=original_confirmed|picker_representation|unknown`, `capture_override_json?`, `location_override_json?`, `parser_version` | Unique `(vault_id,sha256)` including trashed rows, index `(vault_id,deleted_at)`; reimport reuses/restores asset | Trash only if no live TripMedia; purge only after no live/draft/conflict/export references and retention |
| `trip_media` — trip-specific photo | `trip_id`, `media_id`, `day_id?`, `stop_id?`, `caption?`, `position`, `is_favourite=false` | Unique active `(trip_id,media_id)`; indexes `(trip_id,deleted_at,position,id)`, `(trip_id,day_id,position,id)`, `(stop_id)`, `(media_id)` | Clear trip cover and detach photo memories to trip, then trash; never automatically purge asset |
| `memories` — recollection or note | `trip_id`, `kind=memory|note`, `body`, `day_id?`, `stop_id?`, `trip_media_id?`, `position`, `is_favourite=false` | At most one anchor non-null; index `(trip_id,deleted_at,position,id)` plus each anchor FK | Clear opening-memory ref, trash; parent anchor deletion detaches instead of deleting memory |
| `companions` — private person label | `label`, `note?` | Index `(vault_id,label)`; names deliberately not unique | Trash memberships too; warn with affected-trip count; no contact invitation or account lookup |
| `trip_companions` — membership | `trip_id`, `companion_id` | Unique active pair; index `(companion_id,trip_id)` | Trash membership; retain companion |
| `chapters` — curated album | `name`, `normalized_name`, `description?`, `position`, `cover_trip_id?`, `suggested_dates_json?` | Index `(vault_id,deleted_at,position,id)`; unique active `(vault_id,normalized_name)` | Trash memberships, keep trips; clear invalid cover |
| `trip_chapters` — membership | `trip_id`, `chapter_id`, `position` | Unique active pair; index `(chapter_id,position,trip_id)` | Trash membership only |
| `tags` — lightweight filter | `name`, `normalized_name` | Unique active `(vault_id,normalized_name)` | Trash memberships, keep trips |
| `trip_tags` — membership | `trip_id`, `tag_id` | Unique active pair; index `(tag_id,trip_id)` | Trash membership only |
| `dream_destinations` — persistent wish | `place_id`, `added_dates_json`, `note?`, `reference_url?`, `is_archived=false` | Unique active `(vault_id,place_id)`; index `(vault_id,is_archived,deleted_at)` | Trash dream and links; never delete trips/places |
| `dream_visits` — fulfilled wish link | `dream_id`, `stop_id`, `linked_at` | Unique active pair; index `(stop_id)`; same vault; valid live saved trip | Trash link; dream history remains |

All membership rows get stable UUIDs and tombstones, not bare unsyncable join pairs. Name normalization is application Unicode normalization, trim, and case folding with a versioned function, not SQLite ASCII `NOCASE`. Nonempty names/text are validated. Positions are nonnegative integers; reorder siblings in one transaction, using temporary disjoint values to avoid intermediate unique collisions. `order_revision` on Trip guards cloud changes to its route/day/photo ordering; chapter ordering uses its parent revision.

`visit_confirmed` records the user's assertion that a visit happened, independently of `detail_certainty`. An old remembered visit with approximate dates or pin location still counts as visited when confirmed. Unaccepted reconstruction candidates remain suggestions; imported unreviewed stops can have `visit_confirmed=false`. All references to “confirmed stops” in this document mean this boolean, not precise coordinates or dates.

SQL storage types: IDs, labels, enums, paths, hashes, and UTC/date strings are TEXT locally; booleans are INTEGER constrained to 0/1; positions, byte sizes, dimensions, revisions, and counters are INTEGER with nonnegative checks; coordinates are REAL; JSON values are TEXT with JSON validity checks plus application validation. Optional dimensions must be positive when present. Coordinates require both values or neither. Active uniqueness uses partial unique indexes `WHERE deleted_at IS NULL`; restoration that collides with an active membership/name offers merge or rename instead of failing silently. All FK columns receive indexes unless an existing compound index already covers their leading columns.

Use composite FKs such as `(vault_id,trip_id,day_id)` to `(vault_id,trip_id,id)` with matching unique indexes. Cover and opening-memory references use same-trip composite FKs or deferred constraint triggers. Cross-table day/stop agreement and soft-deleted-parent checks need repository validation plus SQLite triggers / Postgres transaction validation; a scalar CHECK cannot inspect another row.

`capture_override_json` and `location_override_json` are either absent (use source) or `{mode:'replace', value:...}` / `{mode:'clear'}`. Clearing a bad source location must not fall back to it. Overrides apply to the Media everywhere; moving a photo between days changes only TripMedia. User confirmation does not turn an approximate source into measured evidence.

### Local operational schema

These tables describe jobs and caches, not travel history. They are not included as domain content in exports.

| Table | Required / optional fields and constraints | Index and lifecycle |
|---|---|---|
| `settings` | `key` PK, `value_json`; includes local vault/device preferences | Replace per key; no secrets |
| `import_batches` | UUID PK, `trip_id`, `state`, `created_at`, `updated_at`, `options_json` | `(trip_id,state)`; retain until completed/cancelled and cleanup safe |
| `import_items` | UUID PK, `batch_id`, `ordinal`, `state`, `attempts=0`; `source_uri?`, `staging_relative_path?`, `media_id?`, `error_code?` | Unique `(batch_id,ordinal)`; `(state)`; source access may expire; erase completed URIs |
| `local_media_files` | `media_id`, `variant`, `relative_path`, `state`, `bytes`, `pinned`, `last_access_at`; `checksum?`, `recipe_version?` | PK `(media_id,variant)`; `(state,last_access_at)`; derivative rows may be removed with cache |
| `draft_suggestions` | UUID PK, `trip_id`, `kind`, `payload_json`, `evidence_json`, `algorithm_version`, `state` | `(trip_id,state)`; accept/reject; export accepted domain data, not these proposals |
| `trash_operations` | UUID PK, `root_type`, `root_id`, `before_json`, `created_at`, `expires_at` | `(expires_at)`; records only changes made by this delete for safe undo |
| `export_jobs` | UUID PK, `state`, `snapshot_relative_path`, `manifest_json`, `created_at`; `error?` | `(state)`; pins referenced files until success/cancel |
| `schema_migrations` | `version` PK, `checksum`, `applied_at` | Append; refuse edited applied migrations |

Cloud extension side tables:

| Table | Schema contract / purpose |
|---|---|
| `outbox` (local) | `op_id` UUID PK, `vault_id`, `aggregate_id`, `entity_type`, `entity_id`, `kind`, `base_rev`, immutable `payload_json`, `depends_on_json`, `state`, `attempts`, `next_retry_at`, `created_at`, `payload_hash`; index `(vault_id,state,next_retry_at)`. Remove acknowledged payloads after safe checkpoint. Do not persist secrets. |
| `sync_shadow` (local) | PK `(entity_type,entity_id)`, acknowledged `server_rev`, `base_json`. Base for three-way comparison. |
| `sync_cursor` (local) | PK `vault_id`, committed pull `seq`, `snapshot_generation`. No wall-clock cursor. |
| `sync_conflicts` (local) | UUID PK, entity identity, `base_json`, `local_json`, `remote_json`, `remote_rev`, `state`, timestamps; index `(state)`. Export unresolved versions in recovery area. |
| `media_jobs` (local) | UUID PK, media/variant, direction, state, attempt, retry time, encrypted-session reference or resumable URL, offset, error; unique active job per media/variant/direction. |
| `vault_owners` (remote) | `vault_id` PK, `user_id` FK auth user; one owner per vault. All domain FKs enforce same-vault ownership. |
| `vault_sync_heads` (remote) | `vault_id` PK, `committed_seq`, `snapshot_generation`. Locked to serialize short per-vault sync transactions. |
| `change_log` (remote) | PK `(vault_id,seq)`, `op_id`, ordered `changes_json`, `created_at`. Transaction envelope includes explicit tombstones and parent-child changes. |
| `applied_operations` (remote) | PK `(vault_id,op_id)`, `payload_hash`, result revision/sequence/result JSON. Retain while account exists to deduplicate lost acknowledgements. |
| `media_objects` (remote) | PK `(vault_id,media_id,variant)`, immutable object key, expected hash/size, verified state, reservation expiry. |

### Deletion and migration policy

Deleting a Trip hides its aggregate immediately; an explicit tombstone transaction records affected children and joins. Shared Place, Companion, Chapter, Tag, and Media rows survive. Undo restores only rows deleted by that operation; it does not resurrect a separately deleted record. Keep trash 30 days by default, show permanent erase separately. Future sync retains compact entity tombstones indefinitely for this small personal scale; purge content fields after retention. Old clients cannot recreate a purged ID; restoration after purge creates new IDs.

Before a migration, produce a consistent database backup using SQLite backup facilities, not a raw copy of a live WAL database. Apply numbered, checksum-verified migrations transactionally where supported, run foreign-key/integrity checks, and open the UI only after success. A failed migration restores the consistent snapshot and presents recovery/export access. Media migrations are resumable jobs; never rewrite originals. Schema downgrade is unsupported; preserve pre-upgrade backups and ship forward repairs. Cloud uses expand/migrate/contract migrations and a supported protocol-version window.

### Sample records

IDs here are readable aliases for generated UUIDs. All sample dates/coordinates are illustrative archive entries; the GPS coordinate is explicitly approximate, not a verified photo location. Shared audit columns are omitted for readability.

```json
{
  "trip": {
    "id": "trip-chitkul", "vault_id": "vault-rohit", "title": "Chitkul Road Trip",
    "status": "saved",
    "dates_json": {
      "start": {"precision": "day", "value": "2026-06-12"},
      "end": {"precision": "day", "value": "2026-06-16"},
      "certainty": "exact", "source": "user"
    },
    "cover_trip_media_id": "placement-001", "opening_memory_id": "memory-001",
    "summary": "A road trip through Kinnaur.", "is_favourite": true
  },
  "day": {
    "id": "day-3", "trip_id": "trip-chitkul", "position": 2, "label": "Day 3",
    "dates_json": {
      "start": {"precision": "day", "value": "2026-06-14"},
      "end": {"precision": "day", "value": "2026-06-14"},
      "certainty": "exact", "source": "user"
    }
  },
  "place": {
    "id": "place-rakchham", "name": "Rakchham", "latitude": 31.39,
    "longitude": 78.36, "coordinate_precision": "area", "source": "user",
    "country_code": "IN", "subdivision_code": "IN-HP",
    "provenance_json": {"note": "Illustrative approximate pin"}, "aliases_json": []
  },
  "stop": {
    "id": "stop-rakchham-1", "trip_id": "trip-chitkul", "place_id": "place-rakchham",
    "day_id": "day-3", "position": 5, "kind": "visit",
    "source": "user", "visit_confirmed": true, "detail_certainty": "approximate", "dates_json": null
  },
  "media": {
    "id": "media-001", "sha256": "<64 hexadecimal characters computed from received bytes>",
    "mime_type": "image/jpeg", "extension": "jpg", "byte_size": 4200000,
    "width": 4032, "height": 3024, "original_filename": "IMG_1432.JPG",
    "source_fidelity": "picker_representation", "parser_version": 1,
    "source_metadata_json": {
      "exif": {"DateTimeOriginal": "2026:06:14 15:42:09"},
      "capture": {"local": "2026-06-14T15:42:09", "utc": null, "offset_minutes": null},
      "gps": null
    },
    "capture_override_json": null, "location_override_json": null
  },
  "trip_media": {
    "id": "placement-001", "trip_id": "trip-chitkul", "media_id": "media-001",
    "day_id": "day-3", "stop_id": "stop-rakchham-1", "position": 0,
    "caption": "The road after Rakchham", "is_favourite": true
  },
  "memory": {
    "id": "memory-001", "trip_id": "trip-chitkul", "kind": "memory",
    "body": "The road after Rakchham was insane.", "stop_id": "stop-rakchham-1",
    "day_id": null, "trip_media_id": null, "position": 0, "is_favourite": true
  },
  "companion": {"id": "person-brother", "label": "Brother", "note": null},
  "trip_companion": {"id": "tc-001", "trip_id": "trip-chitkul", "companion_id": "person-brother"},
  "dream": {
    "id": "dream-spiti", "place_id": "place-spiti",
    "added_dates_json": {
      "start": {"precision": "year", "value": "2026"}, "end": null,
      "certainty": "exact", "source": "user"
    },
    "note": "One day, a slow trip through the valley.", "reference_url": null,
    "is_archived": false
  }
}
```

The full route is seven Stop rows in positions 0–6: Jalandhar, Chandigarh, Shimla, Rampur, Sangla, Rakchham, Chitkul. Brother, Aman, and Rahul are three Companion rows with three membership rows. No precise track is implied by those seven stops.

## 4. Local-first behavior and optional synchronization

### V1 write path

UI invokes a feature command; the command validates domain rules and executes a short SQLite transaction. The transaction updates rows and search documents. Publish a query-invalidation event only after commit. Media file operations use a recovery journal because a filesystem rename and a SQL commit are not one transaction. No server call sits on the save path.

Autosave valid form changes after a short debounce, flush on explicit Done and navigation, and show Saving/Saved/Error accurately. A sudden kill can lose an uncommitted keystroke; do not claim otherwise. Long memory edits use persisted draft text separate from final validation. Closing a screen never silently discards a draft.

Cloud-disabled V1 needs no growing network outbox. Add its tables with the cloud migration; activation takes a consistent local snapshot and queues initial records/files while capturing subsequent edits transactionally. Until activation succeeds, existing local data remains authoritative and accessible.

### Optional cloud sync contract

Sync is application-level replication, **not something Supabase automatically provides for SQLite**. Implement one small protocol, no CRDT, no event-sourcing framework, no always-on socket requirement.

Each operation has an immutable UUID idempotency key, payload hash, expected server revision, and changes. The server transaction validates ownership, dependencies, same-trip references, quotas, and expected revisions. It locks the vault sync-head row, applies the batch, increments revisions, records a committed sequence envelope, stores the operation result, and commits. Per-vault serialization makes cursor order correspond to commit order; a bare database sequence is insufficient because transactions may commit out of order.

Push returns `accepted`, `conflict`, or `invalid`; repeat submission of the same ID/hash returns the original result. Reusing an ID with a different payload is rejected. A local acknowledgement only clears the submitted edit generation; edits made while the request was in flight remain pending and rebase onto the acknowledged revision. Queue operations per entity in order; serialize multirow structural changes at the Trip aggregate. Do not mutate an already-submitted payload.

Pull requests use `after_seq`, bounded page size, and a pinned high-water mark. Deliver complete transaction envelopes in sequence; apply each envelope and cursor in one local transaction. Parent-first inserts and explicit tombstones preserve references. For unsynced local rows, update the shadow and merge/conflict instead of overwriting the working row. A lost cursor update simply replays idempotently.

### Conflict policy

Keep the last acknowledged base. Compare base/local/remote values; merge disjoint scalar fields and identical edits. Treat DateSpec, capture override, geometry, and ordering as atomic values. Concurrent edits to the same text/value prompt the user with both versions. Preserve losing versions in `sync_conflicts`; provide “Keep this”, “Keep other”, and copy text into a new memory. Device timestamps never choose the winner.

Membership insertion is set-like using active pair uniqueness. Remove/add of the same membership and same-place merge conflicts require explicit resolution. Concurrent route/day reorders conflict at `order_revision`, not a mixture of row positions. Delete-versus-edit leaves the shared record deleted but retains the edited version as recoverable content; offer restore as an explicit operation, or copy after hard purge. Tombstoned-parent validation prevents a stale device inserting a new child under a deleted trip. Resolve a conflict against the latest remote revision and retry if it changed again.

Retry transient failures with exponential backoff and jitter, e.g. 2 seconds to 15 minutes, honoring `Retry-After`. Authentication failure pauses for sign-in, validation failure requires repair, and quota failure pauses uploads with a useful explanation. Reachability is a hint, not proof the backend is reachable. Run on foreground/resume, manual Sync, and opportunistic background tasks with a time budget. The OS chooses background execution timing, so foreground continuation must always work. [Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/)

Display independently: local-save state, metadata sync state, media backup count, and unresolved conflicts. “Backed up” requires every referenced original in the snapshot to be uploaded and verified; “Metadata synced” does not mean the photos are safe.

### Required failure scenario, step by step

1. **Offline create:** insert a draft Trip and DateSpec locally. If cloud is already enabled, enqueue its create operation in the same transaction.
2. **Add 30 photos:** persist 30 import jobs, copy each available item into owned staging, verify/hash, move to originals, create Media and TripMedia, and generate derivatives. UI shows, for example, “30 selected · 27 archived · 3 downloading.” Only archived items count as saved photos.
3. **Close:** completed copies and committed edits remain. Staging/jobs survive; a picker-only item may need reselection after permissions expire. On relaunch reconcile orphan files and resume jobs. A force-stop can prevent background execution.
4. **Internet returns:** when the app next receives execution time, refresh auth if cloud is enabled. Local-only V1 does nothing automatically to upload personal data.
5. **Sync begins:** send dependency-ordered metadata and media manifests; upload two originals at a time from files. Other devices may see an explicit “original pending” placeholder until transfer completes.
6. **One upload fails:** retain the original locally and job state; report “29/30 originals backed up”. Continue unrelated operations and retry only the failed transfer. On restart query resumable offset or safely restart an expired upload. Never duplicate TripMedia due to retry.
7. **Another device edits later:** it pulls metadata and desired media, then saves locally. A title change concurrent with a summary change merges. Two different title edits create a visible conflict. Device A pulls the accepted version without losing its offline changes. Deleting on B cannot silently erase an unacknowledged memory on A.

Change-log compaction later uses snapshot generations: a device older than the retained log must preserve its outbox, download a consistent snapshot, and rebase pending changes. Tombstones still prevent resurrection. For this scale, initially retain the log and compact only after measurements justify it.

## 5. Media architecture

### Selection and durable import

Use the system photo picker for user-selected images, no broad library scan and no camera permission in V1. Expo ImagePicker exposes the system selection UI and optional EXIF; treat that metadata as a hint, then parse the copied bytes. Original availability and picker conversion vary by platform. [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)

Pipeline:

1. Create import batch and item jobs before doing costly work. No base64 image payloads through JS.
2. Acquire selected representation; cloud-only items may need a network download. Request original access only when required and explain it. Android picker grants are scoped, and long-lived access must be handled deliberately. [Android photo picker](https://developer.android.com/training/data-storage/shared/photopicker)
3. Stream into `staging/<job-id>.part`; enforce actual byte and pixel limits, inspect magic bytes, and validate that a native decoder can read the image. File extensions/MIME declarations are not sufficient validation.
4. Hash the received bytes with streaming SHA-256. Record size and source fidelity. If the OS supplied a converted rendition, call it the “imported file”, not a guaranteed camera original.
5. Parse EXIF/IPTC where supported into immutable JSON, preserving raw strings, orientation, original date/time/offset fields, GPS, dimensions, and parser version. Original bytes remain the final source of truth, including metadata the parser does not understand.
6. Resolve exact duplicate by `(vault_id,sha256)`. Restore/reuse existing asset; if already placed in this trip show “Already added”. A similar-looking image or recompressed JPEG is not an exact duplicate. No perceptual auto-deletion.
7. Rename within the same storage volume to final original path, then transactionally add Media, local file row, TripMedia, and completed import state. Recovery handles crash between rename and commit. Existing final files are verified and reused.
8. Generate oriented, color-managed sRGB display derivative (max long edge 2048px, JPEG quality around 85) and thumbnail (max 320px). Preserve PNG transparency when relevant using PNG derivatives. Record dimensions, checksum, and recipe version. Never write orientation/edits back into original.
9. A derivative failure leaves the original archived, with a placeholder and retry action. It does not trigger another import or delete the original.

Use `expo-file-system` for paths and file operations. File transfer progress objects do not themselves survive process termination; persisted job state must. [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)

### Small native boundary

Implement a focused local Expo module `archive-media` for streaming file hashing, metadata reading, dimension probing, and bounded decode if the standard image path fails the memory spike. Android uses AndroidX ExifInterface plus platform decoders; iOS later uses ImageIO. ExifInterface documents supported metadata formats, but does not by itself guarantee the device can decode every format. [AndroidX ExifInterface](https://developer.android.com/reference/androidx/exifinterface/media/ExifInterface)

Use Expo ImageManipulator for standard resizing/encoding where measured memory is acceptable; use the module's subsampled decode path for large originals. This is a deliberate native implementation task, not a claim that a JS EXIF option covers all archive requirements. [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/)

### File layout and naming

```text
app-private/
  vaults/<vault-id>/
    database/vault.sqlite          # SQLite-managed location, WAL companions
    media/originals/ab/<sha256>.jpg
    media/display/v1/ab/<sha256>.jpg
    media/thumbnails/v1/ab/<sha256>.jpg
    staging/<import-job-id>.part
    exports/<export-job-id>/
    recovery/
```

Store relative paths, never absolute sandbox paths that can change on reinstall or restore. Extension comes from validated content type. Hash prefix shards folders. Original filenames are metadata only; never concatenate untrusted filenames into paths. Include variant/recipe in derivative paths; regenerated outputs cannot overwrite evidence.

Originals live in durable app document storage, never OS cache. Imported originals are pinned until the user explicitly removes them. Display/thumb variants can be rebuilt, but “Keep trip offline” pins display files. LRU evicts only unpinned derivatives. Future cloud-restored originals may start absent; show separate metadata/display/original availability. Never automatically delete the only verified local copy to free space.

### V1 format contract

| Format | V1 behavior |
|---|---|
| JPEG | Fully supported; preserve received bytes and metadata; oriented derivatives |
| PNG | Supported as a still image; transparency preserved; capture time may be absent |
| HEIC/HEIF still | Supported on the tested device/OS matrix when native decoding succeeds; preserve received HEIC bytes and make JPEG previews. Unsupported decoder produces an explicit “Convert to JPEG and retry” failure, never false success |
| Live Photo | Import still component only, clearly shown before confirmation. Paired motion is outside V1; do not claim full Live Photo backup |
| RAW/DNG | Unsupported in V1; explain and allow importing an externally converted JPEG |
| Video, animated GIF/WebP, burst groups, AVIF | Unsupported as V1 archive formats; filter where possible, reject explicitly otherwise |
| Very large photo | Initial guardrails: 100 MiB encoded, 100 megapixels decoded dimensions. Subsample before rendering; reject safely above limit. Limits are product policy and can be revised after device testing |

Export includes JPEG display versions for HEIC readability over decades while preserving originals. A failed decode or unsupported file remains an actionable import item, not a successfully archived Media row. The picker may already have converted the source, which is why `source_fidelity` matters.

### Cloud media lifecycle

Upload immutable keys under `<user-id>/<vault-id>/<media-id>/original/<sha256>.<ext>`. No cross-account deduplication. Server allocates a manifest/quota reservation; client transfers bytes; server verifies object size and checksum before marking available. If the storage path cannot provide a trustworthy checksum, the verification endpoint must stream-read and hash within documented service limits; platform execution limits and 100 MiB files are a release-gate spike. Do not treat a multipart ETag as SHA-256.

Use resumable TUS for large/flaky transfers, with persistent upload URL/offset and file-backed chunks. Supabase documents resumable uploads and signed upload tokens; its browser example is not proof of a memory-safe React Native adapter. Test the adapter on devices before cloud release. [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)

Upload originals first for durability; derivatives are optional and regenerable. Deletion of a TripMedia removes a placement. GC requires zero live/draft/trash/conflict/export references, completed retention, and no active transfer. Remote deletion jobs are idempotent and delete all variants via the storage API. Local deleting or evicting a file is separate from deleting domain content everywhere.

## 6. Photo-based trip reconstruction

Input is a selected import batch; output is an **editable, persisted draft**, never an automatically saved historical account. Implement deterministic functions in TypeScript with a versioned parameter set.

1. Read parsed source metadata and user overrides. Keep imported selection order as a fallback ordering only.
2. Validate capture values: malformed dates, impossible offsets, and implausible years become warnings. Prefer DateTimeOriginal with explicit offset, then floating DateTimeOriginal, then a documented library creation timestamp as a low-confidence proposal. Filesystem modification/import time is never silently used as capture time.
3. Normalize known instants for comparison while retaining local wall time. Group by local capture date where trustworthy. For mixed zones or floating times, display the grouping assumption and flag boundary photos. Do not convert everything to the phone's present timezone.
4. Suggest date endpoints from usable capture evidence, labeled “Photos span 12–16 June”. This is not proof of departure/return dates.
5. Build editable day groups. Photos with no usable date go to “Date unknown”; gaps between days remain gaps. User can merge/split sections and manually add missing days without changing EXIF.
6. Process GPS independently from time. Reject out-of-range pairs and malformed values; `(0,0)` is a possible real location, but a suspicious isolated point warrants review. Use chronological contiguous clustering with an initial 250m radius, roughly 2-hour break, and a robust representative point. These are tunable heuristics, not confidence probabilities.
7. Preserve recurrence: A → B → A yields two visits to A, even if both use the same Place. One coordinate can suggest a candidate, but never proves a prolonged stop. Untimed photos can suggest places without establishing route order.
8. Reverse-geocode cluster representatives when online and permitted. Deduplicate requests using rounded coordinate/query keys; do not upload photo bytes. A failed lookup leaves a coordinate candidate with “Unnamed place”. Match existing private Place records conservatively; user chooses merges.
9. Suggest stops in supported chronological order, with separate undated candidates. Mark rapid long-distance jumps, discontinuities, and mixed camera-clock patterns for review. Never fill a missing road section or assume a transport mode.
10. Review presents included/excluded photos, suggested dates, day groups, places, and route order. Allow corrections, missing stops, companions, memories, and cover selection. Committing creates/updates domain rows transactionally; unaccepted candidates do not count as visited history.

Confidence is per proposed field:

| Evidence state | Meaning | UI |
|---|---|---|
| `supported` | Parseable relevant metadata, no detected contradiction | “From photo timestamp/GPS” |
| `tentative` | Inference, floating timezone, geocoder area label, single weak point | “Suggested — check this” |
| `conflicting` | Competing source values or implausible sequence | “Needs review”, display alternatives |
| `unknown` | No evidence | Blank/unknown, never substitute today |

Store evidence photo IDs, rule/version, source fields, warnings, and accepted/rejected state in draft suggestions. User confirmation is a separate state from evidence quality. GPS metadata can be edited or wrong, so even `supported` is not proof of physical travel. No AI is needed.

For the example 50-photo flow, the draft immediately shows import progress, then date/day/place proposals as they become available. Removing unrelated photos removes placements, not other trips' copies. Save is allowed with unknown dates or unresolved optional suggestions; pending photo imports remain explicitly listed and retryable.

## 7. Route and map architecture

### Four route meanings

| Kind | Canonical representation | Meaning and UI | Release |
|---|---|---|---|
| Remembered ordered stops | Stop rows ordered by `position`; derive disconnected/straight geographic segments where coordinates exist | Dashed line, numbered stops, “Approximate route from remembered stops”. Never report road distance from this line | V1 |
| Photo-location path | Accepted photo GPS/time observations with source Media IDs; optional materialized GeoJSON LineString/MultiLineString | Dotted line, photo-point markers, “Photo locations joined in time order; travel between them is unknown” | Later; V1 can show photo points |
| Recorded route | Imported source track file plus parsed GeoJSON, recorded timestamps, gaps, accuracy where present | Solid line, “Imported recorded track”; distinguish missing sections. A recording can still be incomplete/inaccurate | Later |
| Generated road route | Routing response geometry, ordered waypoint IDs, travel mode, provider, request time, route-data version, input hash | Distinct dash pattern and “Suggested road route generated on [date]; may differ from the historical route” | Later |

The later `route_artifacts` table uses the shared domain envelope plus required `trip_id`, `kind`, `geometry_geojson`, `provenance_json`, `input_hash`, `generated_at?`, `provider?`, `source_file_relative_ref?`, and `supersedes_id?`. Index `(trip_id,kind,deleted_at)`; no uniqueness limiting multiple track parts. `route_artifact_sources` links artifact to Media/Stop using separate typed FK columns, with exactly one target required and unique artifact/target pairs. Physical source track bytes use an immutable `route_files` registry with UUID, vault, SHA-256 unique per vault, MIME, size, and local availability. These tables are deferred migrations, not V1 implementation obligations.

Never overwrite a recorded artifact when generating a road route. Reordering stops invalidates generated-route inputs; show stale state and regenerate on request. Split lines at missing coordinates/known gaps; do not join the last known point before an unknown stop to the first after it as if that leg were established. Handle antimeridian crossings and coordinate order `[longitude,latitude]`. Export route kind and provenance alongside geometry; no global “exact route” flag.

### Provider comparison and choice

| Choice | Practical advantage | Cost/constraint for this archive | Decision |
|---|---|---|---|
| Google Maps | Familiar maps and rich place lookup | Places content has storage/display restrictions; durable archive data must not depend on unrestricted retention of responses | Do not choose for initial architecture |
| Mapbox | Integrated native maps and documented offline map workflows | Vendor service terms, separate search/routing licensing, and a React Native integration to maintain | Viable, but unnecessary vendor coupling here |
| MapLibre | Native renderer using chosen styles/data, local GeoJSON, provider separation | It supplies no bundled worldwide tiles, geocoder, or routing service; Expo needs a compatible native build | **Choose** |

Google documents Places caching exceptions and attribution requirements. Mapbox documents offline resources and restrictions. MapLibre documents its Expo/native requirements and explicitly requires production style/tile data. These are distinct capabilities, not interchangeable provider promises. [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Mapbox offline maps](https://docs.mapbox.com/help/dive-deeper/mobile-offline/), [MapLibre setup](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/)

**Initial stack:** `@maplibre/maplibre-react-native` renderer, MapTiler Cloud online style/tiles and forward/reverse geocoding, local GeoJSON overlays, manual place creation as a full offline path. Route drawing is client-side from accepted stops; no Directions API in V1. Configure a restricted, monitored public map key; mobile keys cannot be treated as secrets.

**Data licensing is a release check:** MapTiler's geocoding page describes permanent storage for many uses, while Cloud terms distinguish temporary caching and custom agreements. Record the applicable grant for durable selected-place storage and portable export before enabling provider-derived archival data. Do not assume tiles and geocoding have identical rights. If the selected plan does not cover the intended saved/exported fields, omit those fields from persistent provider results and use user-entered names/pins or photo GPS for archival records. Do not relabel copied provider results as user-created data to bypass terms. [MapTiler geocoding service](https://www.maptiler.com/search/), [MapTiler Cloud terms](https://www.maptiler.com/terms/cloud/)

### Concrete rendering and offline behavior

- Online: MapLibre displays MapTiler basemap with required attribution; local Stop/Place/Dream GeoJSON is overlaid. Data loads from SQLite before tiles arrive.
- Offline or map service failure: load a fully bundled local style, local fonts/symbols, and a coarse Natural Earth world outline; show personal markers and route overlays. At high zoom the background may be blank with coordinates and an “Offline overview” label. The stop list remains complete. Natural Earth publishes its data as public domain; keep its version/source in the repository. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)
- A route without any coordinates becomes a labeled ordered place list. It is still a valid route memory.
- Place search first queries local Places; online lookup is an explicit enhancement. Reverse geocode only clustered candidate coordinates, rate-limited and cancellable. Store provider, retrieval time, retained fields, attribution, and applicable retention policy with cached responses.
- `geocode_cache` is local operational data: `(provider,normalized_query,locale)` PK, response JSON, fetched/expiry times, license policy ID. Clear expired entries. Accepted archival fields live in Place only if storage is allowed. Never export cached API payloads by default.
- SDK-permitted transient tile cache is an optimization, not an offline promise. No bulk tile download in V1. Later offline packs require a provider/data license permitting them even though MapLibre exposes an offline manager. [MapLibre OfflineManager](https://maplibre.org/maplibre-react-native/docs/modules/offline-manager/)
- Countries/states come from accepted Place metadata or user entry, never from a generated line crossing a boundary. Preserve user corrections and show unknown geography separately. No need for PostGIS or polygon containment in V1.

## 8. Mobile stack

| Option | Fit for this developer | Tradeoff | Choice |
|---|---|---|---|
| React Native + Expo development builds | Reuses TypeScript skills and provides access to native modules | Photo fidelity, large image decoding, and maps require real-device/native integration work | **Selected** |
| Flutter | Strong cross-platform UI model and native interoperability | Adds Dart and a different ecosystem without removing photo/map native edge cases | Not selected |
| Native Kotlin / Swift | Most direct OS media/background integration | Two application stacks for eventual iOS; greater solo maintenance effort | Reserve native code for the focused media module |

Expo development builds allow custom native libraries; Expo Go is not the intended environment for this application. Flutter's architecture also provides platform integration, but it does not remove this project's language/maintenance tradeoff. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Flutter architecture](https://docs.flutter.dev/resources/architectural-overview)

| Concern | Selected implementation |
|---|---|
| Language and UI | TypeScript strict mode, React Native, Expo development build; Android physical device first |
| Navigation | Expo Router: four tabs plus stack/modal editors |
| Forms/validation | React local form state; Zod schemas shared with import/export and cloud payload validation |
| UI state | Zustand for cross-screen selections and filters; Context for service/theme providers |
| Persistent data | `expo-sqlite`, hand-written numbered SQL migrations, typed SQL repository functions; no ORM initially |
| Query updates | Lightweight repository subscriptions that invalidate affected screen queries after commit |
| Files | `expo-file-system` and the small `archive-media` Expo module |
| Photo selection | `expo-image-picker`, no broad asset enumeration; `expo-document-picker` for archive restore |
| Metadata and hashing | Native streaming SHA-256 and AndroidX ExifInterface; iOS ImageIO implementation before iOS release |
| Derivatives | Expo ImageManipulator plus native bounded decoding where measured necessary |
| Image display | `expo-image`, disk-backed derivative URIs, virtualized FlatList/SectionList |
| Maps | MapLibre React Native + MapTiler online services + local fallback style |
| Secure storage | `expo-secure-store` for future auth refresh tokens and sensitive job credentials |
| Background | `expo-background-task`, persisted jobs, foreground/manual continuation |
| Network signals | `@react-native-community/netinfo`, fetch cancellation/timeouts |
| Backend, later | Supabase Auth, PostgreSQL, private Storage, small Edge Functions and transactional SQL functions |
| Sync, later | Custom bounded outbox/pull protocol; no realtime subscription required |
| Crash reporting | `@sentry/react-native`, opt-in production error reports with aggressive scrubbing; local diagnostic codes always available |
| Tests/builds | Jest, React Native Testing Library, SQLite integration harness, Maestro on devices; EAS Build or local Android builds |

Do not claim Expo package versions and MapLibre versions are universally compatible. Phase 0 pins a tested Expo/RN/MapLibre/native module matrix and records it in `docs/compatibility.md`, the package lock, and build configuration. Android-first does not imply immediate iOS parity.

## 9. Minimum backend

**V1 needs no product backend or user account.** Online map/search requests can occur without a vault account, with appropriate consent and provider key controls. Complete local usage remains possible with manual places and offline maps.

| Backend option | Fit | Why not/why selected |
|---|---|---|
| Supabase | Relational domain, constraints, SQL transactions, auth, private object storage | **Selected for optional cloud**; sync engine remains application work |
| Firebase/Firestore | Convenient managed client and document offline features | Document shape is less natural for this model; SDK cache is not the chosen SQLite archive/sync contract |
| Custom Node/NestJS + DB + storage | Maximum protocol control | More deployment, auth, storage, and maintenance work than necessary |

Firestore documents offline persistence and last-write behavior, but using it would not implement this architecture's preserved-conflict policy automatically. [Firestore offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline)

```text
Mobile SQLite + files
   │ authenticated HTTPS, only after opt-in
   ▼
Supabase Auth ── JWT ──► Edge API / transactional Postgres functions
                                  ├── PostgreSQL + RLS + change log
                                  └── Private Storage: immutable image objects
```

Activate cloud in Settings → Backup: explain uploaded content, estimate size, choose Wi-Fi preference, create/sign into account, explicitly attach local vault, then queue initial backup. Do not silently merge a device's local vault with a different signed-in account. Keep local vault UUIDs stable; server creates ownership only after authenticated claim checks. Restoring an existing cloud vault uses its ID in a separate local directory. Cross-vault merging is outside the first cloud release.

Authentication: email OTP with verified email as the initial flow; tokens in SecureStore, refresh handled through one auth service. Expired auth pauses sync while local access continues. Sign-out pauses work and offers retaining or removing this device's local copy. Account switching never reassigns another vault's outbox or paths.

Authorization: all domain rows belong to a vault with exactly one owner. RLS checks `auth.uid()` through `vault_owners`; apply both read predicates and write checks. Composite ownership FKs prevent referencing another owner's Media/Place. The mobile app never receives a service-role secret. Restrict direct table writes; sync mutations go through narrowly scoped transactional functions with fixed search paths and explicit owner checks. Storage access uses private buckets and owner/vault path checks, not guessed filenames. Supabase supports RLS-controlled storage access; public buckets do not provide this privacy model. [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Private storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)

Initial API contracts:

| Endpoint / function | Input | Response and guarantee |
|---|---|---|
| `claim-vault` | local vault ID, protocol version | owner mapping or conflict; no accidental account merge |
| `sync-push` | operation ID/hash, expected revisions, ordered change batch | accepted revision/sequence, conflict current/base details, or typed error; idempotent |
| `sync-pull` | vault, cursor, limit, optional high-water | complete transaction envelopes, high-water, next cursor |
| `media-reserve` | media ID, hash, size, MIME, variant | authorized object key and expiring upload authorization; atomically reserves quota |
| `media-finalize` | reservation ID | verified availability or pending/error; repeated calls safe |
| `media-download` | vault/media/variant | short-lived signed read URL after ownership check |
| `backup-status` | vault | committed metadata point and available/missing original counts |
| `delete-account` | recent auth, request ID | durable deletion-job ID, status for retries |

Read signed URLs expire in a short period (e.g. five minutes); refresh when needed and never persist them in exported data/logs. They are bearer credentials until expiry. Store object keys instead. Set file-size/type restrictions and reserve quota atomically before upload; expire abandoned reservations. Client-supplied ownership/size/hash is not trusted without validation. Rate-limit requests and bound batch sizes, memory text lengths, route geometry size, and decoded images.

Account deletion first revokes new writes and sessions, then an idempotent worker deletes object variants, rows, and auth account in a recoverable sequence. Report pending/failed cleanup, not premature success. Publish the actual provider-backup retention policy at cloud release. Remote account deletion cannot erase offline devices immediately; expose local erase separately and propagate deletion status when they reconnect. Keep a documented local-export path before account deletion.

Cloud sync is not an independent backup because it propagates deletions. Retain user trash plus server recovery policy, and continue encouraging dated portable exports. Do not advertise the mere presence of synchronized objects as a decades-long preservation guarantee.

## 10. Application layers

Use **feature folders with small shared infrastructure modules**, not a generic clean-architecture framework. Each feature has screens/components, domain functions, repository SQL, and commands where needed.

```text
Screen → command/domain validation → repository transaction → SQLite
   └── read hook → repository query → view model
Import/export/sync services → same domain validation + controlled repository writes
Native media/maps/auth adapters → isolated external boundaries
```

- UI renders view models and submits intent. It cannot issue raw SQL, upload files, or rewrite EXIF.
- Domain code contains DateSpec formatting, visit counting, duplicate decisions, reconstruction, and route provenance rules. Keep it pure where possible.
- Repositories contain explicit, typed SQL queries and transactions for features. Avoid a generic repository per entity interface with boilerplate methods.
- Services coordinate cross-feature workflows: import, export/restore, deletion, and later sync. File jobs persist state before yielding.
- External adapters wrap exactly the behavior that needs replacement/testing: picker access, native image operations, geocoder, object transport. Do not wrap every library call.

Define commands such as `createTripDraft`, `saveTrip`, `assignPhotoContext`, `reorderStops`, `deleteStopPreservingMemories`, `linkDreamVisit`, and `exportVault`. Return typed failures. Database invalidation follows committed transactions, never optimistic global object copies. Cloud application uses a distinct trusted repository entry point that suppresses new outbox generation while still updating search and subscriptions.

## 11. State management

| Tool/state | Store here | Do not store here |
|---|---|---|
| React component state | Editor focus, temporary form input, sheet visibility | Sole copy of imported files or resumable drafts |
| Context | DB/services, theme, auth service reference | Frequently changing 10,000-photo collections |
| Zustand | Current cross-screen selection IDs, filters, sort preference, gallery selection mode | Whole Trip/Media records mirrored from SQLite |
| Redux Toolkit | Not selected; could support complex global event workflows | Unnecessary initial actions/reducers for each database row |
| TanStack Query | Not initially required; later optional cache for ephemeral remote lookup/account requests | Canonical trip database or durable upload queue |
| SQLite | Domain records, persisted drafts, job states, conflicts, cursors | Decoded image bitmaps or bearer tokens |
| SecureStore | Auth/session secrets | Large metadata/documents |

A screen query keeps only the current bounded page/view model in memory and re-reads relevant SQL after invalidation. Persistent filters may be stored in Settings. Sync status is derived from outbox/media job states, with transient progress in memory; restart recomputes it. Add local `editor_drafts(id PK, entity_type, entity_id, field, text, updated_at)` with a unique entity/field key for incomplete long-text edits; migrate accepted text through a command and clear its draft atomically.

## 12. Screen architecture

Four bottom tabs: **Trips · Map · Dreams · My Life**. Global Add Trip button in Trips; Settings from My Life. Detail/editors are stack routes; the OS photo picker is a native sheet. Preserve navigation state sensibly, but do not restore an obsolete picker URI as if valid.

| Screen | Local data source | Main components and actions | Destinations |
|---|---|---|---|
| Trips home | Saved trips, cover thumbnail joins, filters; separate draft query | Year/chapter/tag controls, search, virtualized cards, resume draft, add | Trip Detail, Add Trip, Search, Chapters |
| Add Trip | New/resumed draft and import jobs | Start from photos / Start manually; title/date inputs; autosave | Photo Picker, Reconstruction Review, Trip Editor |
| Photo Picker | OS selection, then import batch rows | Multi-select stills, cancel without destroying draft, progress/errors | Reconstruction Review |
| Reconstruction Review | Draft suggestions, placed Media, days/stops | Date range evidence, unknown bucket, exclude photos, split/merge groups, accept/correct | Route Editor, date editor, Companions, Memory Editor, Trip Detail on save |
| Trip Editor | Trip and relationship queries | Title, DateSpec controls, summary, cover, tags, chapters, companions, delete/undo | Route Editor, timeline editor, picker, detail |
| Date editor | DateSpec and duration estimate | Exact day/month/year/unknown, approximate toggle, custom label | Calling editor |
| Timeline editor | TripDays plus assigned counts | Add, reorder, split/merge, relabel, assign ungrouped photos; review reassignment before deleting section | Day detail, review, detail |
| Route Editor | Stops joined to Places | Ordered list, drag/reorder, new place, repeated visit, stay fields, uncertainty badge | Place editor, Trip Map, calling screen |
| Place editor/detail | Place, qualifying Stops/Trips, Dream links | Manual name/pin, optional lookup, correct region, merge duplicate; visit list | Linked trips, Dream detail, route editor |
| Memory Editor | Memory or persisted editor draft | Plain multiline text, anchor selector, note/memory toggle, favourite | Calling trip/day/photo/stop |
| Trip Detail | Bounded trip overview and section queries | Cover, summary, route, days, gallery preview, memories, people | All trip-focused screens |
| Day detail | Day, stops, paged TripMedia, memories | Narrative sections, add memory, reassignment controls | Gallery, stop/place, editors |
| Gallery | Keyset-paged TripMedia + local file availability | Thumbnail grid, filter by day/place, multi-select, favourite | Photo viewer, picker |
| Photo viewer | Current and adjacent placement IDs/files | Display image, lazy original zoom, caption, metadata provenance, memory, retry missing file | Memory Editor, day/stop, metadata correction |
| Trip Map | Coordinate Stops, local paths, optional photo points | Numbered markers, route legend, list fallback, marker sheet | Stop detail, Route Editor |
| Chapters | Chapters and membership counts | Albums, add/edit, arrange, choose trip membership | Chapter detail filtered trips |
| Companions | Companion and trip membership query | Private labels, add/edit, merge cautiously, trips together | Companion detail filtered trips |
| Lifetime Map | Distinct confirmed Places with visit/trip counts; dreams layer | Marker clustering, visited/dream filters, list equivalent | Place detail, trip, dream |
| Dreams | Dreams joined Places and DreamVisit count | Add wish, note/link, dream/visited/archive filter | Dream detail, Place editor, link visit |
| My Travel Life | Aggregate SQL over saved live trips | Trips/years/places/people counts, favourites, chapter shelves | Chapters, Companions, filtered Trips, Settings |
| Search | FTS hits joined live entities; filters | Search field, typed results/snippets, year/tag filters | Trip/Photo/Memory/Place/Companion/Chapter |
| Settings | Settings, local storage/job summaries | Privacy, map online preference, storage, diagnostics, trash | Backup/Export, Trash; auth only with cloud extension |
| Backup/Export | Export jobs, file availability; later cloud jobs | Export all/trip, restore archive, destination choice, verify status | OS document destination, restore review, later account/sync |
| Trash | Deleted root records and undo records | Restore, affected-content summary, permanent erase | Restored detail |
| Sync conflicts (later) | Unresolved conflict triples | Compare base/local/remote, select/copy/merge | Affected editor, Backup status |

Accessibility: usable text scaling, screen-reader labels, tap targets, non-color route uncertainty cues, predictable editor focus. Maps always have an equivalent list. Destructive actions name exactly which archive records/copies they affect. “Remove from trip”, “Remove downloaded copy”, and “Delete everywhere” are separate commands.

## 13. Trip Detail UI architecture

The screen should feel like opening a personal album. Recommended order:

1. **Cover and title:** bounded display derivative, date label, favourite/edit controls.
2. **At-a-glance summary:** duration only if supported, companion chips, short summary; no dashboard overload.
3. **Opening memory:** optional chosen recollection, with its context label.
4. **Route strip:** ordered stop labels and approximation badge; tap opens full Trip Map. Avoid mounting a heavy interactive map inside the scrolling list.
5. **Day/section timeline:** day label, stops, up to three thumbnails, one memory excerpt, counts. Unknown-day content gets its own section.
6. **Photo shelf:** bounded preview and “View all 50 photos”.
7. **Favourite memories:** short excerpts linking to their anchors, no duplicate full rendering of the opening memory.
8. **Stops and stays:** compact grouped list for content not obvious from timeline.
9. **Companions, chapters, tags:** navigable context and archive organization.

Implementation: one virtualized SectionList with stable keys, independent bounded queries. First read Trip plus cover/companion names and counts; then first page of day summaries and a photo preview. Paginate photos with `(position,id)` cursor, e.g. 60 grid items; memories with a similar cursor. Include unassigned photo/memory counts so unstructured material never disappears.

Use thumbnails in timeline/grid, display derivatives in viewer/cover, originals only on explicit zoom/export. Prefetch at most neighboring viewer items. Do not allocate 100 original bitmaps or issue a per-photo query. Day summary query aggregates counts and bounded thumbnails; cache derived counts only if profiling demonstrates a need. Cancel obsolete image loads when leaving the trip.

## 14. Local search

Use **SQLite FTS5** from V1. One rebuildable local search document per searchable source: trip title/summary, memory body, photo caption, place name/aliases, companion label, chapter name, tag name. Retain entity type/ID and optional trip ID for navigation; never index raw EXIF, auth fields, or deleted content. FTS supports prefix matching and ranking without semantic infrastructure. [SQLite FTS5](https://www.sqlite.org/fts5.html)

```sql
CREATE TABLE search_documents (
  rowid INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  trip_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);
CREATE VIRTUAL TABLE search_fts USING fts5(
  title, body,
  content='search_documents', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE INDEX search_documents_trip ON search_documents(trip_id);
```

Add insert/update/delete triggers on `search_documents` to maintain the external-content FTS table using its documented delete/insert protocol. Feature commands and cloud application update corresponding documents in the same transaction as domain writes. On parent trip trash, remove all its contextual documents; restore rebuilds them. Places/companions remain searchable only if active. Include `vault_id` in documents if multiple vaults ever share one DB; the initial design uses one DB per vault.

Query with bound parameters, quote/escape user tokens for FTS syntax, limit results to 30 and use ranked pagination. Match source records first; resolve companion/place/tag/chapter hits to associated trips with indexed joins, so “Brother” finds both the person and their trips without copying the entire relationship graph into every document. Apply year/tag/chapter filters in SQL and deduplicate Trip results.

Maintain sort/date indexes separately; FTS is not a date/range engine. Rebuild FTS after index-version changes or detected inconsistency. Unicode tokenization is a starting point; test Hindi and mixed-language labels and provide normalized substring fallback for short names where tokenization underperforms. No vector database, embeddings, or cloud search.

## 15. Dream Places

DreamDestination belongs to Place and keeps its own added date, note, link, and archive flag. New dreams receive today's actual added date; imported historical dreams can have approximate/unknown added dates. `created_at` is record creation time, not necessarily when the wish began.

Derive visible status: archived if explicitly archived; otherwise visited when at least one live DreamVisit points to a live confirmed stop in a saved trip; otherwise dreaming. There is no independently editable visited boolean to drift out of sync.

After adding a stop, suggest matching dreams. User confirms the link; don't auto-fulfil “Japan” from an ambiguous search result. A regional dream may link to a child-city stop by explicit user choice without inventing a complex geographic containment model. Dream detail displays “Dream added 2026” and linked visits in 2028 and 2034. Repeated stops in one trip can remain separate visits, while the trip list is distinct.

Deleting a link/stop/trip changes the derived current status, but the dream's creation date and note survive. V1 undo retains deleted links for 30 days. An account owner choosing permanent deletion intentionally removes that visit evidence. Validate reference URL schemes (`https`/`http` only), open externally, and do not auto-fetch preview images that leak private interests.

## 16. Life chapters and statistics

Allow a trip to belong to **multiple chapters**. “College Years” and “Bike Trips” can both contain Chitkul. A chapter is a user-curated album with cover/description/order, optionally a date hint. Tags are terse facets such as `mountains`, `road-trip`, `winter`. No exclusive category tree, implicit auto-membership, or required chapter.

“Trips With Brother” can be a chapter the user curates; the Companion screen already supplies a dynamic query for every trip with Brother. Do not silently bind the chapter to that query in V1. Smart chapters are later work.

Statistics contract:

| Metric | Definition |
|---|---|
| Total trips | Count distinct saved, nondeleted Trip IDs; drafts/trash excluded |
| Places visited | Distinct Place IDs referenced by confirmed visit/stay stops in saved live trips; transit excluded |
| Repeat visits | Number of qualifying Stop occurrences; show both “4 visits across 3 trips” where applicable |
| Countries/states | Distinct non-null accepted country/subdivision codes from those places; never infer from line intersections |
| Years travelled | Years supported by known trip dates; unknown dates separate; range years qualified as approximate where needed |
| Companions | Distinct live companions linked to saved live trips, not every unused label |
| Memories | Live `kind=memory` rows in saved live trips; notes counted separately if shown |
| Favourite trips | Saved live trips with favourite flag |
| Chapter totals | Distinct trip memberships per chapter; global total does not sum chapter totals |

No distance-travelled statistic in V1 because straight lines and generated routes would imply unsupported precision. No invented country totals when a place's administrative region is unknown.

## 17. Backup, export, and restore

**Ship portable export and tested restore in V1.** A file users cannot restore is not a sufficient backup architecture. JSON is canonical; HTML is the readable view; original media is retained; GeoJSON carries geographic content. Use UTF-8, stable IDs, ISO dates with explicit precision, relative paths, and explicit schema/format versions.

```text
Trip-Memory-Vault-2026-09-26/
  README.txt
  manifest.json                   # format version, scope, counts, paths, SHA-256
  schemas/v1/                     # JSON Schema definitions and enum meanings
  data/vault.json
  data/trips.json
  data/trip-days.json
  data/places.json
  data/stops.json
  data/media.json
  data/trip-media.json
  data/memories.json
  data/companions.json
  data/trip-companions.json
  data/chapters.json
  data/trip-chapters.json
  data/tags.json
  data/trip-tags.json
  data/dreams.json
  data/dream-visits.json
  routes/<trip-id>.geojson         # features carry kind, uncertainty, source IDs
  media/originals/ab/<sha256>.heic
  media/display/ab/<sha256>.jpg
  journal/index.html
  journal/trips/<trip-id>.html
  journal/styles.css
  recovery/                      # unresolved conflicts/drafts, if included
```

HTML uses static links, escaped text, local styles and relative media URLs. No server, JS fetch, CDN fonts, or external basemap is needed. Render an inline SVG route schematic with the same uncertainty legend; GeoJSON contains actual coordinates and gaps. If a memory contains markup-looking text, treat it as text; protect the journal against HTML/script injection. Strip provider tile caches and expiring URLs. Include only provider data allowed to be exported with required attribution.

Manifest fields include `format_version`, export UTC time, app/schema versions, vault ID, full/trip scope, snapshot ID, row/file counts, checksums, missing-item list, and completeness status. Exporting a single trip includes its reference closure: used places/people/chapters/tags/media and relationships. Dreams linked to that trip may be included with only applicable visit links; say the archive is a subset. Full vault export includes all live dreams. Trash is an explicit optional recovery export, not included as live data.

Export algorithm:

1. Estimate required space and destination limits; acquire a consistent DB snapshot and pin referenced immutable files against GC. Later edits belong to a later export.
2. Build files incrementally from the snapshot with streaming writes/hashes. Do not hold all images or a multi-gigabyte ZIP in JS memory.
3. Verify every file and manifest. Missing/corrupt originals make it an explicitly **incomplete export**, with paths/IDs and repair guidance. Offer to download cloud originals before full export.
4. Write to a staging destination, then finalize with a completion marker/rename where the destination supports it. Interrupted exports retain job progress or can be safely restarted; they never receive a success label.
5. Prefer a folder export to a user-chosen document directory on Android; provide a streaming ZIP64 packaging option where destination/OS supports it. V1 release requires one proven large-archive destination path. Sharing a small trip ZIP and archiving a 40GB vault are different workloads.

Restore first extracts to isolated staging with path-traversal protection and bounds on entry count, total size, and compression ratio. Validate schemas, hashes, references, and version compatibility; report counts/missing files before import. V1 restores into an empty/separate vault, avoiding a complex merge UI. IDs stay stable within that vault; copied media deduplicates by hash. Atomically activate the new DB only after validation and required file placement. Unknown future fields must either be preserved by a compatible reader or cause a clear “newer format” refusal, never silently discarded.

Restore does not import auth tokens, device identifiers, sync cursors, server revisions, or active network jobs from the portable archive. Start as a local vault. If that vault ID is already attached to a cloud account, reconnecting requires an explicit restore/reconciliation workflow; never push an old portable snapshot as newer server truth. In V1, refuse overwriting an already-open vault with the same ID and offer switching to a separately restored copy through a controlled recovery flow.

Keep at least one export outside the phone and periodically verify a restore. The app can show last verified export date; copying to another drive is the user's chosen workflow. Uninstall/device loss destroys local-only app data. Make that fact clear in Backup settings without forcing account creation. Exclude large originals from implicit OS app backup where appropriate and do not count unspecified OS backups as verified vault backups.

## 18. Security and privacy

Private by default means no public profile, no public objects, no social graph, and no mandatory telemetry. Companion records are local labels; no contact-book permission. No current/background location permission for V1: photo metadata access is different from requesting the phone's current location. Android may redact location EXIF depending on access path; request any additional media-location permission only for the specific user-enabled import behavior, and preserve “unavailable/redacted” rather than inventing coordinates.

The baseline local protection is app sandboxing plus OS device encryption and lock-screen protection. **V1 does not claim application-level end-to-end encryption.** Plain SQLite and image files are not independently encrypted by this design. Optional biometric app lock can protect casual in-app access later; it is not a replacement for file encryption. If stronger threat protection becomes a requirement, SQLCipher alone is insufficient: image files, derivatives, export keys, recovery, and background access need a coordinated encrypted-vault design.

For cloud: TLS in transit, provider storage/database encryption at rest, SecureStore tokens, RLS and owner-scoped objects. The backend operator can access server-side data; state this honestly. E2EE is later, because key recovery and portable restoration must be designed before claiming it. Do not embed service secrets in the mobile bundle.

Original photos retain sensitive EXIF including GPS by default for archival fidelity. Explain that a full export contains it. A future “share sanitized copy” flow can remove metadata from a derivative; it must not modify the archived original. Derived images should omit GPS metadata. Original filenames, captions, EXIF, companion names, search queries, signed URLs, and tokens are scrubbed from crash reports. Opt-in diagnostics use operation IDs and error codes rather than personal content.

Online place lookup sends text/coordinates and IP information to the provider; present an online maps/search setting and keep manual creation available. Thumbnails and map views can reveal sensitive places even without original EXIF. Avoid automatic link previews and external HTML assets in exports. Plain exports are sensitive files; show this at destination selection. Portable password-encrypted exports are later and must use a maintained standard implementation, never custom cryptography.

Local erase closes the DB, deletes its files and owned media/jobs/caches, clears tokens for that vault, and verifies the directory contents removed. It cannot promise forensic secure erase on flash or erase copies already exported elsewhere. Cloud account deletion follows section 9; downloaded offline copies on other devices require local removal.

## 19. Performance and storage budgets

Optimize measured behavior on a representative midrange Android device with 100 trips and 10,000 photos. No sharding, Redis, dedicated search service, or server-side materialized analytics pipeline.

| Area | Implementation | Initial acceptance target |
|---|---|---|
| Startup | Open/migrate DB, render first trip page; no startup EXIF scan, network wait, or mass file stat | Cold usable Trips screen under 2 seconds after completed migrations on reference device |
| Trip overview | Small indexed joins, bounded day/preview data | Local summary visible within 300ms warm |
| Gallery | Keyset pages of 60, virtualized cells, stable IDs, thumbnail-only grid | Responsive scrolling without original-image decode in grid |
| Search | FTS + indexed relationship filters, bounded results | First local page under 200ms warm for test corpus |
| Media import | Two copy/hash jobs; one large decode at a time; native work off UI thread | UI remains interactive, no OOM across the corpus |
| Image memory | 320px grid images, 2048px display, neighbor prefetch limit | Decode budget around 64–96MiB on reference device, tune through profiling |
| Maps | Cluster source features natively; do not mount 10,000 React marker views | Viewport updates remain responsive; selected trip only loads its photo points |
| Background | Short persisted batches, time-budget checkpoints | Resumes correctly after every forced termination |
| Queries | FK indexes, trip/date indexes, parent/order indexes; inspect query plans | No per-cell SQL calls or full-table gallery scans |

Storage reality: 10,000 originals averaging 4MiB are approximately 39GiB. At 250KiB display and 20KiB thumbnail averages, derivatives add roughly 2.6GiB. Actual images vary widely. Import estimates and low-space handling matter more than reducing a few megabytes of metadata. Exports may require substantial extra staging space; support streaming to external/user-selected storage rather than assuming a second complete copy fits internally.

An uncompressed 100MP RGBA image can require roughly 400MB before processing overhead. Checking dimensions without decoding and using sampled native decoding are necessary. Encoded file size alone does not bound memory. LRU cache limits are configurable; pin durable originals and offline trips. Rebuildable derived counters/search/maps need versioned invalidation, not sync.

## 20. Error handling

| Failure | User experience | Durable system action |
|---|---|---|
| Photo unavailable / picker grant expired | “Select this photo again”; retain filename/selection context where available | Keep failed import item; no successful Media claim without owned file |
| Cloud-only picker photo download fails | Retry, skip, or finish other photos; show network need | Keep draft and jobs; no fabricated placeholder original |
| Corrupt image | Identify failed item; allow replace/remove | Preserve recoverable staging briefly; quarantine, never run unsafe repeated decode |
| No GPS | “Location unknown”; manual place assignment | Null source GPS; preserve file |
| No timestamp | “Date unknown” group; manual date/day | Do not use import or modification time as capture |
| Geocoding fails/over quota | Unnamed coordinate or typed label; Retry later | Cache allowed negative response briefly, retain original coordinates |
| Network lost during upload | Local trip unchanged, per-file retry status | Persist transfer state, backoff, verify existing object before retry |
| Map unavailable | Offline overview and stop list with uncertainty labels | Local geometry remains usable |
| Exact duplicate | “Already added” or “Added existing photo to this trip” | Hash reuse, unique constraints, no duplicate bytes |
| Storage full | Pause import/export with required space estimate; saved work retained | Roll back DB transaction, retain valid originals, clean only safe staging/cache |
| Backend unavailable | “Saved on device; backup waiting” | Keep outbox; retry within policy |
| Sync conflict | Side-by-side changes with clear affected record | Preserve base/local/remote; block only dependent operations |
| Derivative missing | Placeholder then regenerate | Original remains intact; schedule derivative job |
| Original missing after alleged import | “Original unavailable”; restore from verified backup or reselect | Integrity incident, never silently mark backup/export complete |
| Database migration fails | Recovery screen with prior archive/export option | Keep pre-migration snapshot; do not initialize an empty DB over it |

Errors have stable codes, safe diagnostic IDs, and retryability classification. Do not use endless toast notifications. Import/export/sync screens maintain actionable job lists. A disk-full autosave keeps unsaved text in the live editor and offers copy-out; no architecture can promise a durable write when storage has rejected it.

## 21. Testing strategy

Test the durability boundaries, not just screen snapshots. Use real SQLite and real file operations for integration tests; mocked repositories alone cannot detect FK, WAL, or file/transaction problems.

| Suite | Cases | Passing evidence |
|---|---|---|
| Domain unit tests | DateSpec exact/month/year/unknown, inclusive duration, leap years/DST, visit vs transit, chapter deduplication, memory anchors | No invented time/visit values; expected formatted labels and counts |
| Database integration | Same-vault/trip FKs, duplicate memberships/assets, partial active uniqueness, detach/restore, reorder, query pagination, FTS rename/delete | Violations rejected; valid operations atomic; no skipped/duplicate page rows in stable snapshot |
| Reconstruction | Mixed timezones, floating EXIF, missing timestamps/GPS, repeated A→B→A visit, 3-day gaps, clock outliers, user corrections | Deterministic proposals and explanations; raw evidence unchanged |
| Media device tests | Picker/cloud source, copy/hash/decode, orientation, HEIC capability, huge dimensions, duplicate concurrency, disk full | Owned bytes hash-match accepted input, bounded memory, usable errors |
| Crash injection | Kill before/after copy, rename, DB commit, derivative write, export finalization | Resume/reconcile without losing successful imports or creating false success |
| Offline end-to-end | Airplane mode create/edit/import locally available photos, search, maps fallback, restart, export/restore | Complete local workflows with no account/network |
| Map tests | Unknown coordinates, same-place visits, duplicate names, antimeridian, line gaps, provider failure, zero-coordinate warning | Correct local layers and meaningful list equivalent |
| Migration | Every released schema fixture → current, migration interruption, corrupt index, old export versions | Counts/references/hashes preserved; rollback/recovery path works |
| Export/restore | Full/subset export, HEIC originals + JPEG preview, multilingual text, HTML escaping, hostile ZIP paths, incomplete media | Canonical roundtrip preserves IDs/data/files; journal opens offline; unsafe archives rejected |
| Sync, before cloud release | Lost acknowledgements, duplicate ops, in-flight edits, two devices, reordered delivery, batch failure, concurrent reorder/delete/edit, stale cursor | Idempotency and eventual convergence for nonconflicting data; no silent conflict loss |
| Authorization, before cloud release | Two account fixtures, cross-vault references, forged paths, expired URLs, quota races, account deletion retries | No cross-owner reads/writes; storage cleanup eventually completes |
| Performance | 100 trips, 10k asset records and realistic device files, long notes, many repeated places | Measured budgets from section 19 with device/build recorded |

Fixture corpus in `tests/fixtures/media/` contains licensed/synthetic files and a manifest of exact expected hashes/metadata:

- Standard JPEG, all EXIF orientation cases, GPS JPEG, no-GPS JPEG.
- HEIC from a real supported device and a variant the tested decoder rejects.
- PNG with transparency and no EXIF; mismatched extension/MIME file.
- Floating capture time; offset-aware time; DST boundary; conflicting library/EXIF time; date set decades into the future.
- Exact duplicate and recompressed visually similar photo, with expected distinct hashes.
- Huge dimensions, high encoded size, truncated/corrupt file, valid header but invalid image body.
- Cloud-only picker asset exercised manually/on-device, since a static fixture cannot model system download permissions.
- Live Photo selection to verify still-only disclosure; RAW/video rejection.

Keep real private photo fixtures out of the repository. Use a synthetic JSON manifest to generate scale datasets; don't commit 40GiB of files. Run the large-storage import/export test with an external reproducible device dataset.

CI runs typecheck, lint, domain tests, migration/SQLite tests, and export integrity/HTML escaping tests. Device smoke tests run on pinned builds; release testing includes real picker/decoder/background behavior on supported Android versions. Before iOS release, repeat the media/permissions/background/export matrix on iOS; Android results are not evidence of iOS behavior.

## 22. V1 scope

### Must have — local archive release

- Trips CRUD and resumable manual/photo drafts; exact/approximate/unknown dates and optional estimated duration.
- System picker, durable JPEG/PNG and supported-device HEIC still import, immutable evidence, exact-hash dedupe, thumbnails/display images, clear failed-item recovery.
- Editable date/day suggestions and coordinate stop candidates; basic online reverse lookup when enabled and licensed; manual correction remains complete offline.
- Ordered repeated stops, simple stay fields, day/section timeline, captions, notes/memories and favourite moments/trips.
- Private companions, multiple chapters, tags, filters and local FTS search.
- Trip detail/gallery/viewer, trip map, lifetime map with offline geographic/list fallback.
- Dream history with explicit linked visits and derived status; conservative basic statistics.
- Trash/undo, migration recovery, local job recovery, portable JSON/media/GeoJSON/HTML export and verified restore.
- Settings for storage, privacy, optional online maps, diagnostics; no required account.

These are still a substantial solo project. Implement vertical slices and ship only when the durability gates pass. The first internal milestone can have fewer screens; that is not a claim that the requested final V1 is already complete.

### Nice to have — after must-have acceptance

- More polished cover cropping and chapter visuals using reversible crop settings.
- Smarter but still explainable photo grouping; easy bulk assignment; fuller metadata comparison UI.
- Biometric app lock, if its limited protection is clearly explained.
- Better export progress/resume ergonomics and optional ZIP packaging if folder export already satisfies the large-archive requirement.

### Later — separate releases

- Optional Supabase accounts, verified media backup, restore downloads, and multi-device sync **as one fully tested feature**, not partial “automatic backup” marketing.
- Imported recorded tracks, materialized photo paths, generated road routes, licensed regional offline map downloads.
- Full Live Photo resources, RAW archival support, video support/transcoding, E2EE and encrypted portable archives.
- Automatic/smart chapters, perceptual duplicate suggestions, cross-vault merge, rich geography hierarchies.

Excluded product categories in section 1 remain excluded; “later” is not a promise to become a planner/social network.

## 23. Exact implementation order

Implement in this order. “DB changes” identify migrations/modules, not permission to mutate production databases manually. Every step must preserve passing tests from earlier slices.

| Step | Goal and modules/files | DB changes | UI changes | Completion gate |
|---|---|---|---|---|
| 0. Native feasibility | `modules/archive-media/`, `core/maps/`, `docs/compatibility.md`; pin Expo/RN/MapLibre build | Scratch DB only | Disposable picker/image/map spike | Physical Android device imports JPEG/HEIC, streams hash, handles huge image without OOM, renders bundled offline map; record unsupported cases |
| 1. App shell | `app/_layout.tsx`, tab routes, `shared/ui/`, theme/errors | Migration runner and empty vault/settings | Four tabs, loading/recovery boundary | Cold launch/relaunch works offline; no account gate |
| 2. Domain and schema | `domain/date-spec.ts`, validation, `core/database/`; numbered initial migrations | Core domain tables, constraints, indexes, jobs/trash/drafts | Minimal developer seed screen | Date/identity/FK/delete tests pass; migration backup/recovery proven |
| 3. Trip vertical slice | `features/trips/{commands,repository,screens}` | Trip/date fields already present; query tuning only | Create/edit/list/detail basics; exact/month/year/unknown | Create 2022 old trip, edit offline, kill/reopen, data intact |
| 4. Places/stops/stays | `features/places/`, route order domain functions | Place/Stop queries and constraints | Manual place editor, ordered route list, repeated visits/stays | A→B→A retained; reorder atomic; missing coordinates valid |
| 5. Durable photo pipeline | `features/media/`, `services/import/`, native module | Media/TripMedia/import/local files | Picker, progress/retry, gallery cells | Kill at every boundary; dedupe and low-space cases pass; original integrity checked |
| 6. Timeline and memories | `features/timeline/`, `features/memories/` | Day/Memory/anchor and draft writes | Day editor, memory editor, captions/favourites | Reassign/delete day/stop without losing text/photos; original EXIF unchanged |
| 7. Reconstruction | `services/reconstruction/`, suggestion repo | `draft_suggestions` | Full from-photos review with unknown bucket | 50-photo example editable end to end; conflicting/missing metadata honest |
| 8. Organization | `features/companions/`, `features/chapters/`, tags | Membership queries/constraints | People/chapter screens, tag filters | Trips with Brother; one trip in multiple chapters; no double global counts |
| 9. Finished Trip Detail | trip section queries/components, viewer | Bounded query indexes after query-plan checks | Final section order, virtualized gallery/viewer | Large trip loads without full originals or per-cell SQL |
| 10. Maps | `core/maps/`, `features/map/`, local style/assets | `geocode_cache`, provenance fields validation | Trip/lifetime map, place sheet, online search setting | Offline fallback and unknown-place list; provider-data retention terms recorded; no false road-route claim |
| 11. Dreams and My Life | `features/dreams/`, `features/life/` | DreamVisit and aggregate queries | Wish list/history, statistics, favourite shelves | Dream links to two trips; stats exclude transit/drafts/deleted rows |
| 12. Search | `features/search/`, FTS migration/triggers | Search documents/FTS/index version | Global search + filters | Rename/delete/restore reflected; Brother finds correct trips; Unicode fixtures pass |
| 13. Backup/export/restore | `services/archive/`, format schemas, `features/settings/` | Export jobs/pins, restore staging registry | Destination/progress/restore review | Fresh-vault roundtrip verified, static journal offline, multi-GB device destination works |
| 14. Local V1 release hardening | tests, privacy copy, integrity scanner, release docs | Final audited migration fixtures | Trash/recovery/storage/error polish | Airplane-mode suite, 10k-photo profiling, process-kill matrix, migration/restore drills pass |
| 15. Cloud protocol development | `supabase/`, `core/sync/`, `core/auth/` | Remote tables/RLS/functions; local sync migration | Internal auth/sync diagnostics only | Two-client concurrency/idempotency/authorization suites pass; no public backup claim yet |
| 16. Cloud media and restore | object transport/resume/verifier/deletion worker | Media manifests/quota/jobs/snapshot state | Opt-in setup, backup progress, download/pin controls | Fail one of 30 uploads and recover; expired session, huge upload checksum, quota race, delete retry pass |
| 17. Optional cloud release | conflict UI, recovery docs, account deletion | Protocol compatibility checks | Conflict resolution, account/sync settings | Two-device real-world test + local export still works with backend down |
| 18. iOS release | iOS module/platform config, device matrix | No domain redesign | Native picker/export/privacy adaptations | Same local durability gates plus iOS permissions and background tests |

Do not start phase 15 because a login screen is easy; start it after local V1 is reliable. The largest early unknowns are media fidelity/memory, native compatibility, and archive export scale, hence the early spike and explicit release gates.

## 24. Initial repository structure

This is the planned repository, not a claim that an application has been implemented by this architecture document. Create concrete files when their implementation step begins; keep future cloud paths documented instead of adding empty frameworks.

```text
trip-memory-vault/
├── app/
│   ├── _layout.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx                  # Trips
│   │   ├── map.tsx
│   │   ├── dreams.tsx
│   │   └── life.tsx
│   ├── trips/
│   │   ├── new.tsx
│   │   └── [tripId]/
│   │       ├── index.tsx
│   │       ├── edit.tsx
│   │       ├── review.tsx
│   │       ├── route.tsx
│   │       ├── timeline.tsx
│   │       ├── gallery.tsx
│   │       └── map.tsx
│   ├── days/[dayId].tsx
│   ├── photos/[tripMediaId].tsx
│   ├── memories/[memoryId].tsx
│   ├── places/[placeId].tsx
│   ├── companions/{index,[companionId]}.tsx
│   ├── chapters/{index,[chapterId]}.tsx
│   ├── dreams/[dreamId].tsx
│   ├── search.tsx
│   └── settings/{index,backup,trash}.tsx
├── src/
│   ├── domain/
│   │   ├── date-spec.ts
│   │   ├── capture-time.ts
│   │   ├── coordinates.ts
│   │   ├── ids.ts
│   │   ├── provenance.ts
│   │   └── validation.ts
│   ├── features/
│   │   ├── trips/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── commands.ts
│   │   │   ├── repository.ts
│   │   │   ├── queries.ts
│   │   │   └── types.ts
│   │   ├── timeline/
│   │   ├── places/
│   │   ├── media/
│   │   ├── memories/
│   │   ├── companions/
│   │   ├── chapters/
│   │   ├── tags/
│   │   ├── dreams/
│   │   ├── map/
│   │   ├── life/
│   │   ├── search/
│   │   └── settings/
│   ├── services/
│   │   ├── import/{pipeline,recovery,validation}.ts
│   │   ├── reconstruction/{timestamps,days,clusters,confidence,review}.ts
│   │   ├── archive/{export,restore,manifest,html,geojson}.ts
│   │   └── deletion/{trash,restore,gc}.ts
│   ├── core/
│   │   ├── database/{connection,migrate,transactions,subscriptions}.ts
│   │   │   └── migrations/
│   │   │       ├── 0001_vault.sql
│   │   │       ├── 0002_domain.sql
│   │   │       ├── 0003_local_jobs.sql
│   │   │       └── 0004_search.sql
│   │   ├── filesystem/{paths,atomic-files,capacity}.ts
│   │   ├── media/{native-adapter,derivatives,availability}.ts
│   │   ├── maps/{maplibre,maptiler,offline-style,geojson}.ts
│   │   ├── jobs/{runner,retry,background}.ts
│   │   ├── diagnostics/{errors,logger,sentry}.ts
│   │   ├── auth/                     # Added with cloud
│   │   └── sync/                     # Added with cloud
│   │       ├── protocol.ts
│   │       ├── outbox.ts
│   │       ├── push.ts
│   │       ├── pull.ts
│   │       ├── merge.ts
│   │       ├── transport.ts
│   │       └── media-transfer.ts
│   └── shared/{ui,hooks,theme}/
├── modules/archive-media/
│   ├── expo-module.config.json
│   ├── src/index.ts
│   ├── android/
│   └── ios/                          # Implement before iOS release
├── assets/
│   ├── icons/
│   └── maps/{offline-style.json,world.geojson,LICENSE.txt}
├── schemas/archive/v1/
├── tests/
│   ├── unit/
│   ├── database/
│   ├── reconstruction/
│   ├── import/
│   ├── archive/
│   ├── migrations/
│   ├── sync/                         # Added with cloud
│   ├── fixtures/{media,databases,archives}/
│   └── e2e/                          # Maestro flows
├── scripts/{seed-scale-data,verify-archive}.ts
├── supabase/                         # Added with cloud
│   ├── migrations/
│   ├── functions/{media-reserve,media-finalize,delete-account}/
│   └── tests/
├── docs/
│   ├── architecture.md
│   ├── data-dictionary.md
│   ├── compatibility.md
│   ├── archive-format.md
│   ├── recovery-runbook.md
│   ├── privacy-data-flow.md
│   └── adr/001-008-*.md
├── .github/workflows/ci.yml
├── .env.example                      # Names/placeholders, no secrets
├── .gitignore                        # Private images, exports, DBs, secrets
├── app.config.ts
├── eas.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── eslint.config.js
├── jest.config.js
└── README.md
```

Braced path names above are shorthand for multiple files, not literal filenames. Router files are thin screen exports and ID parameter parsing. Features own user behavior; services own workflows spanning features; core owns technical boundaries. `schemas/archive` is a public compatibility contract and should outlive framework replacements. Native source is version-controlled; generated build files follow the chosen Expo prebuild workflow. Never commit real vault content as fixtures.

## 25. Concrete architecture diagrams

### Overall architecture

```text
Trips | Map | Dreams | My Life | Settings
                    │
             Feature commands/queries
                    │
          Domain validation + repositories
               ┌────┴───────┐
               ▼            ▼
           SQLite      Owned media files
        records/jobs    originals/derivatives
               │            │
               ├── Export snapshot ──► JSON + HTML + media + GeoJSON
               │
               └── Optional sync workers ──► Supabase Auth/API
                                               ├── Postgres
                                               └── Private Storage

Map view ──► local geometry + bundled fallback
         └─► optional MapTiler tiles/search
```

### Local write flow

```text
User edits title
  → command validates title + ownership
  → BEGIN SQLite transaction
      update Trip + updated_at
      update search document
      if cloud enabled: enqueue immutable operation
  → COMMIT
  → invalidate trip/list query keys
  → read new view model → render “Saved on device”
  → optional sync later; never block local save
```

### Photo import flow

```text
System picker selection
  → persist batch/items
  → acquire selected bytes (may wait for cloud library)
  → stream staging .part → validate dimensions/type → hash → parse evidence
        ├── existing hash → reuse Media → add/reuse TripMedia
        └── new hash → move durable original → SQL commit Media + placement
  → generate thumb/display → update local availability
  → reconstruction proposals
  → optional media upload job

Process death → job/file reconciler → resume or request reselection
```

### Cloud sync flow

```text
Local edit + outbox committed together
  → worker/auth → push(op_id, hash, expected rev, changes)
  → server owner/revision checks + vault lock
      ├── accepted: domain writes + revisions + change envelope + op result
      └── conflict: return current state, preserve local version
  → client acknowledge only submitted generation
  → pull(after_seq, high_water)
  → merge against shadow or record conflict
  → apply accepted changes + cursor atomically

Independent file queue → reserve → resumable upload → verify → available
                                     failure → backoff, local original intact
```

### Trip reconstruction flow

```text
Imported evidence + existing corrections
  → validate capture times / retain unknowns
  → date/day proposals
  → contiguous GPS clusters / repeated-visit boundaries
  → optional reverse lookup / local Place matches
  → confidence + evidence + gap warnings
  → persisted editable draft
  → user removes/corrects/adds/groups
  → save accepted domain objects; evidence stays unchanged
```

### Trip loading flow

```text
Trip ID → local query: title/date/cover/summary/people/counts
        → first section page + bounded photo previews
        → render virtualized detail using thumbnail/display files
        → scrolling requests next bounded page
        → Gallery requests photo page
        → Photo viewer reads display, then optional original on zoom
        → Map opens local geometry; basemap optional

Missing local file → explicit availability UI → regenerate/download/reselect
                   → no hidden requirement to fetch before reading memories
```

## 26. Initial Architecture Decision Records

### ADR-001 — React Native with Expo development builds

**Status:** accepted for V1.

**Context:** one TypeScript developer, Android first, potential iOS, photos/maps need native capabilities.

**Decision:** TypeScript React Native, Expo development builds, Expo Router, focused native media module.

**Alternatives:** Flutter; separate Kotlin and Swift applications; Expo Go-only development.

**Reason:** retains the developer's language and shared UI/domain code while allowing native image and map integrations.

**Consequences:** maintain a pinned native compatibility matrix; physical-device tests are mandatory; iOS still needs native implementation/testing. Revisit only if the initial memory/fidelity spike cannot meet requirements.

### ADR-002 — Local-first archive

**Status:** accepted for V1.

**Context:** archiving must work without signal or a login and survive backend/service changes.

**Decision:** commands write SQLite and owned files first; all archive screens read local state. Optional network work is asynchronous.

**Alternatives:** server-authoritative app with request cache; account-required onboarding.

**Reason:** supports the core “travel first, archive later” flow and makes local readability independent of cloud service availability.

**Consequences:** durable job recovery, disk-space UX, export/restore and explicit availability states are required. Local-only users need an external copy to survive device loss.

### ADR-003 — SQLite local, PostgreSQL for optional cloud

**Status:** accepted local; remote choice accepted for cloud extension.

**Context:** trips/visits/media placements are relational; local filtering and full-text search are needed.

**Decision:** Expo SQLite with numbered SQL migrations, foreign keys, indexes, FTS5; Supabase PostgreSQL mirrors synchronized domain rows later.

**Alternatives:** document database, JSON-file primary storage, Realm-style alternative local object store, one remote database only.

**Reason:** relational invariants and SQL queries fit the product; explicit schemas are portable and inspectable.

**Consequences:** maintain SQLite/Postgres type mappings and constraints; use protocol-level sync rather than database-file replication. No ORM is initially needed.

### ADR-004 — Immutable files separate from photo context

**Status:** accepted for V1.

**Context:** photos can be reused, edits must not destroy evidence, and originals are too large for DB blobs.

**Decision:** hash-deduplicated originals in durable app storage; Media records store evidence; TripMedia stores contextual placement; derivatives are versioned and rebuildable.

**Alternatives:** camera-roll references only; BLOBs in SQLite; separate physical copy per trip; overwriting originals with compressed images.

**Reason:** preserves original fidelity, avoids redundant storage, and supports independent trip captions/assignments.

**Consequences:** filesystem/database reconciliation and reference-aware GC are required; hashing does not detect recompressed duplicates; OS-supplied renditions must be labeled accurately.

### ADR-005 — MapLibre plus separately licensed services

**Status:** accepted; provider retention/export rights are a release check.

**Context:** map rendering and permanent personal geography should not depend on a provider's tile cache remaining available.

**Decision:** MapLibre native renderer, MapTiler online basemap/geocoding, bundled coarse local map and personal GeoJSON; no road routing or bulk offline tiles in V1.

**Alternatives:** Google Maps; Mapbox; a custom map renderer.

**Reason:** separates durable archive geometry from optional online services and supports an honest offline fallback.

**Consequences:** MapLibre supplies no tiles/geocoder by itself; provider attribution/licensing must be tracked; native build compatibility needs testing. No promise of detailed offline roads.

### ADR-006 — Optional Supabase backend

**Status:** accepted for a later cloud release; no backend required by V1.

**Context:** one developer needs relational storage, auth, private file storage, and a small trusted API if cloud is added.

**Decision:** Supabase Auth/Postgres/Storage with narrow functions for sync, reservations, verification, and deletion.

**Alternatives:** Firebase; custom NestJS services; mandatory cloud from launch.

**Reason:** avoids operating independent auth/database/storage services while retaining transactional SQL and ownership controls.

**Consequences:** RLS and storage policies need adversarial tests; object verification and cleanup are application responsibilities; cloud is not E2EE and is not an automatic SQLite sync solution.

### ADR-007 — Revision-based outbox synchronization

**Status:** accepted design for cloud extension.

**Context:** occasional multi-device edits, possible long offline periods, and valuable text/photos that must not be overwritten silently.

**Decision:** local transactional outbox; idempotent server operations; expected revisions; commit-ordered per-vault change cursor; three-way disjoint-field merge; explicit conflicts for overlapping edits and structural reorderings.

**Alternatives:** timestamp last-write-wins; whole-trip JSON replacement; CRDTs; off-the-shelf replication introduced before requirements are proven.

**Reason:** small, comprehensible protocol for a personal archive with infrequent contention, preserving conflicts without distributed editing machinery.

**Consequences:** acknowledged shadows, tombstones, operation IDs, conflict UI, and careful in-flight acknowledgement are required. Per-vault serialized writes are intentionally sufficient at this scale. Do not release partial sync under a backup label.

### ADR-008 — Open portable archive format

**Status:** accepted for V1.

**Context:** memories should remain interpretable after the application and its services disappear.

**Decision:** versioned JSON plus original media, readable static HTML, GeoJSON/provenance, schemas, and checksum manifest; verified restore to a separate vault.

**Alternatives:** SQLite file only; proprietary backup blob; HTML-only export; cloud-only backup.

**Reason:** supports both human readability and machine restoration without relying on the original framework/database.

**Consequences:** format versioning, dependency closure, streaming export, metadata privacy, and restore regression tests are part of the product. Large archives need a real destination/space strategy.

## 27. Final authoritative architecture

### Product architecture

A private retrospective travel archive: Trips, Map, Dreams, and My Life. Manual or photo-assisted creation produces editable local drafts. Uncertain history is first-class; no precise date/route is invented. Trip Detail is the primary reading experience.

### Mobile stack

TypeScript, React Native, Expo development builds, Expo Router, Zustand for limited shared UI state, Expo SQLite, system image picker, Expo filesystem/image display, and a small native media module for robust byte/metadata handling. Android first; iOS after equivalent device tests.

### Backend stack

None required for local V1. The selected optional cloud extension is Supabase Auth, PostgreSQL, private Storage, and minimal trusted functions. Accounts appear only when users enable cloud backup/sync.

### Database

SQLite is the device's operational source of truth, with foreign keys, explicit migrations, typed SQL queries and FTS5. Stable UUIDs, explicit date precision, immutable source metadata, and per-vault ownership. PostgreSQL mirrors domain data when cloud is enabled.

### Media storage

App-owned immutable imported originals, content-hash deduplication, contextual TripMedia placements, versioned thumbnails/display files, durable job recovery. Supported V1 still formats are JPEG, PNG, and tested-device HEIC. Local originals stay pinned unless explicitly removed.

### Maps

MapLibre renderer with MapTiler online maps/geocoding and a bundled coarse local fallback. Stop geometry and provenance remain local. Approximate remembered routes are dashed; detailed offline tiles, recorded-track import, and generated routing are later features.

### Offline strategy

All domain edits and reads are local; draft/import/export state persists. Photo assets report actual availability. Offline maps retain personal geometry and a stop list even without a detailed basemap. Backend failure never prevents reading locally archived memories.

### Sync strategy

Optional post-V1 revision-based outbox/pull protocol, idempotent operations, commit-ordered cursors, explicit tombstones, deterministic disjoint-field merges, and preserved conflicts. Media transfers are independently resumable and verified; metadata sync alone is not full backup.

### Core domain entities

Vault, Trip, TripDay, Place, Stop (including stay), Media, TripMedia, Memory (including note), Companion, Chapter, Tag, DreamDestination, DreamVisit, and explicit membership joins. User auth and local job state are infrastructure. Statistics and V1 route segments are derived.

### Repository structure

Thin Expo Router routes; feature-owned screens/commands/SQL; shared pure domain value objects; import/reconstruction/archive services; database/filesystem/maps/job infrastructure; one native media module; format schemas, ADRs, fixtures, integration tests. Cloud directories are introduced when their release begins.

### V1 scope

Complete local trip archive with photo import/review, dates, stops/stays, timeline, notes/memories, people, chapters/tags, galleries/maps, dreams, search, statistics, trash, portable export and verified restore. No mandatory account, cloud sync, planner, social features, video pipeline, or live tracking.

### Development order

Native feasibility → shell/database → trip CRUD → places/stops → durable photos → timeline/memories → reconstruction → people/chapters/tags → finished detail → maps → dreams/statistics → search → export/restore → local release validation → optional cloud protocol/media/conflict release → iOS.

### Main technical risks

1. **Photo fidelity and native memory limits:** picker conversion, EXIF redaction, HEIC variability, huge decodes. Address in the first device spike and preserve source fidelity labels.
2. **Archive scale and durability:** originals may occupy tens of gigabytes; storage exhaustion, partial imports, and interrupted exports need tested recovery.
3. **Mapping data rights and native compatibility:** verify provider retention/export permissions and pin a working Expo/MapLibre build; retain the independent local fallback.
4. **Sync correctness:** lost acknowledgements, concurrent structural edits, stale deletes, and ownership isolation. Keep optional cloud behind its own tests and release gate.
5. **Long-term readability:** evolving schemas, unsupported future image decoders, dependency changes, and service disappearance. Preserve originals plus common display formats and regularly tested open exports.

The governing choice is durability with honest uncertainty: preserve what the user actually has, make corrections reversible, and keep the archive readable without a network or the original service.
