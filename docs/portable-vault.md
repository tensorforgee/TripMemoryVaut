# Portable vault export format v1

Step 12 adds a local, folder-based preservation package. The package is deliberately readable without SQLite or Trip Memory Vault. The JSON files are authoritative for restore; `journal/index.html` and GeoJSON are convenience views.

## Package layout

```text
Trip-Memory-Vault-YYYY-MM-DD-<vault-id-prefix>/
  manifest.json
  COMPLETE.json
  README.txt
  schemas/v1/README.txt
  data/
    vault.json
    trips.json
    trip-days.json
    places.json
    stops.json
    media.json
    trip-media.json
    companions.json
    trip-companions.json
    chapters.json
    trip-chapters.json
    dreams.json
    dream-visits.json
    reconstruction-history.json
  media/originals/<first-two-sha256-chars>/<sha256>.original
  routes/routes.geojson
  journal/index.html
```

All text is UTF-8. Every data file has an envelope with `entity`, `format_version`, and a deterministically ordered `records` array. Database JSON columns are exported as JSON objects instead of encoded strings. In particular, DateSpec keeps `start`, `end`, precision, certainty, source, optional label, and null/unknown values. IDs, relationship IDs, ordering positions, user captions/notes, archive flags, trash timestamps, and causal deletion flags are preserved.

`reconstruction-history.json` contains resolved accepted/rejected suggestions and the run records required to explain them. Pending proposals and import job state are transient and are not exported. Source picker URIs, staging paths, caches, thumbnails, display derivatives, logs, and device paths are also excluded.

## Manifest and integrity

`manifest.json` identifies `trip-memory-vault`, `format_version: 1`, export time, app and SQLite schema versions, vault ID/name/version, per-entity counts, media count/bytes, capabilities, and a sorted file inventory. Every inventoried file has a relative path, role, exact byte length, and lowercase SHA-256.

`COMPLETE.json` is written last and contains the SHA-256 of the exact manifest bytes. Its absence means the package is incomplete. The manifest does not contain secrets, tokens, API keys, or absolute/device-specific paths.

Before export completes, every registered original must exist and match the immutable Media byte count and SHA-256. Originals are copied without decode or recompression, then checked again in the staged package and in the user-selected destination. The neutral `.original` suffix prevents Android document providers from privacy-transforming EXIF-bearing images during integrity reads; `media.json` preserves the original extension, MIME type, filename, and metadata. A missing or corrupt original aborts export; no package is reported complete.

## Restore semantics

Format v1 restores only into a fresh vault. It does not merge, silently replace, or overwrite an existing archive. Selection and validation are read-only. Confirmation is offered only after the completion marker, version, required files, checksums, counts, record shapes, IDs, DateSpecs, relationships, and media inventory validate.

Originals are copied to content-addressed app storage and reverified before one SQLite transaction imports the structured data. Import order follows dependencies: Vault, Trips, Places, TripDays, Stops, Media/original registrations, TripMedia, Companions and memberships, Chapters and memberships, Dreams and visits, then reconstruction history. Stable IDs are retained. Parent tombstones and Dream archive flags are temporarily neutralized only while dependency-safe inserts run, then restored to their exported values. A final foreign-key check runs before commit.

If validation, media staging, or the database transaction fails, the current vault is unchanged. A process interruption can leave only unreferenced content-addressed bytes; a later restore trusts them only after a full byte-count and SHA-256 match. Temporary `.part` files are removed after success or handled failure. SQLite and files cannot form one atomic transaction, so verified originals are finalized before the single database commit.

Only original files are restored. Display and thumbnail derivatives are intentionally omitted because they are reproducible; the existing media worker regenerates them without modifying originals.

## Untrusted archive protections

Restore rejects unsupported format/schema versions, malformed or oversized JSON, excessive declared size, missing required files, checksum/size mismatches, unsafe absolute or `..` paths, backslashes, duplicate paths or IDs, media filename collisions, invalid DateSpecs, cross-vault/broken references, inconsistent Trip/section/Stop photo context, duplicate active relationships/order positions, and unexpected original-media entries. Files are never extracted from an archive: only validated relative paths inside the selected package and app-owned media roots are used.

## Known limitations

- Format v1 is a directory package rather than a ZIP file. Android uses the system directory picker, so broad storage permission is unnecessary.
- Restore is full and empty-vault-only; independent vault merge is intentionally unsupported.
- Cloud backup, sync, encryption/password protection, external place lookup, and scheduled backup are outside Step 12.
- Original images remain capped by the existing 100 MiB per-file media invariant.
- The HTML journal and GeoJSON are readable projections, not restore sources. GeoJSON lines show confirmed Stop sequence only, never travelled roads.

## Verification

Host coverage includes deterministic export, structured DateSpec/UUID/tombstone preservation, all current relationship families, byte-identical originals, missing-original failure, valid empty-vault round trip, checksum and missing-file rejection, unsupported version, traversal, duplicate IDs, broken FKs, interrupted restore, and nonempty-vault protection. Android verification must additionally exercise the system folder picker, inspect the exported manifest and original hash, restore after a fresh-vault reset, verify Trips/timeline/map/gallery/organization/Dream/Travel Life semantics, force-stop and relaunch offline, and reject a deliberately altered original without changing the destination vault.

The 2026-10-01 Android x86_64 development-build verification completed that cycle with three Trips, four Places, repeated Stops, approximate and unknown dates, one original photo, Companion and Chapter relationships, Dreaming and Visited Dreams, mapped and unmapped Places, and a trashed Trip. The system-picked export was re-inspected successfully; a fresh-vault restore preserved IDs and semantics; the altered-original package was rejected without mutation; and the restored archive, map data, gallery original, and generated thumbnail remained readable after force-stop and offline relaunch, with no JavaScript or native crash.
