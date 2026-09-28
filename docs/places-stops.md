# Step 3 — Places and ordered Stops

This implements only the requested local Places/Stops vertical slice. A Place is
reusable inside one vault; each Stop is a separate occurrence inside one Trip.
Repeated visits retain distinct UUIDs. No map, geocoder, external place lookup,
TripDay, media, or cloud functionality is introduced.

## Schema and durability

Migration `0002-places-stops.ts` adds only `places` and `stops`, plus
`trips.order_revision` for route changes. Migration 1 remains unchanged. The
existing backup/checksum/transaction/integrity workflow handles upgrades.

- Places have UUID/vault/audit/tombstone fields, required nonunique name, nullable
  coordinate pair, coordinate precision, source, provenance and aliases.
  Coordinates are both present and in range, or both null; absent coordinates
  require unknown precision. Explicit user-entered zero coordinates are valid.
- Stops have UUID/vault/trip/place ownership, nonnegative safe-integer position,
  visit/stay/transit kind, visit confirmation, independent detail certainty,
  source, optional DateSpec/note, and optional lodging label/checkout DateSpec.
  Stay fields live on Stop. Non-stay records cannot carry stay-only fields.
- Composite foreign keys prevent cross-vault references; active-parent triggers
  reject writes under deleted trips/places/vaults. Physical parent deletion is
  restricted. Local name lookup is parameterized and treats `%`/`_` literally.
- A partial unique index enforces active `(trip_id, position)`. Reorder validates
  the complete ID set and expected route revision, moves into disjoint temporary
  positions, and writes final positions in one transaction. Add/remove/edit also
  advance the revision. Removal compacts surviving positions.
- Creating a new place and adding its stop is one transaction. Failed stop
  validation/insertion cannot leave an orphan place. Existing places are reused
  by ID; similar or identical names are never automatically merged.
- Provider identifiers, administrative geography fields and TripDay references
  are deferred because no provider, geography editor or timeline exists here.
  The architecture's source enums remain represented; this UI writes user data.

## UI

Trip Detail now contains Route / Stops, an honest empty state and an ordered
textual sequence. Its route editor supports creating/selecting local places,
up/down ordering, repeat occurrences, stop edits, and stop removal with immediate
undo. Restored stops append to the current route and can be moved as desired.

Stop forms support kind, confirmation, certainty, note, optional dates and stay
fields. Dates accept year, month or day precision and approximate certainty;
blank endpoints remain unknown. Place coordinates are optional. Editing a shared
Place explicitly explains that all referencing stops see the change. Name-only
edits retain coordinate source/provenance. Save commits before success is shown;
cancel/back protect unsaved form input. Stop/place forms use explicit save and do
not claim that unfinished input survives process death.

Screens requery repositories after commit and on focus. The only temporary form
copies are local React state; SQLite remains canonical. The Step 2 React header
is reused for Android compatibility. No dependency versions changed.

## Deletion contract

Stop removal soft-deletes that occurrence and never deletes its Place. A Place
cannot be soft-deleted while referenced by an active stop or by a stop retained
for a trashed trip. Repository enforcement is backed by a SQLite trigger.

Trip deletion now tombstones its active Stops in the same transaction. A local
`stops.deleted_by_trip` marker records which rows were affected by the parent
operation. Restoring the Trip restores only those Stops, never stops removed
separately. Shared Places survive. Repeated delete/restore cycles are tested.

As in Step 2, there is no retention/purge worker. Removed Stops remain tombstoned;
the route editor exposes undo for its most recent removal while that screen is
open. The repository supports restoration after reopening, but a persistent
removed-stop browser is deferred. No future trash or media tables were added.

## Checks

- TypeScript passed.
- Step 1: 20 tests passed. Schema inventory and synthetic next-migration version
  expectations were updated to include the new migration; tests were not removed.
- Step 2: 8 tests passed.
- Step 3: 14 real-SQLite tests passed: v1 upgrade/rollback, Place CRUD and literal
  local lookup, coordinate validation, repeated visits and reuse, atomic creation,
  ordering/stale revision rejection, forced reorder rollback, removal/undo,
  visit/stay/transit fields, ownership/deleted-parent guards, aggregate trash/restore
  and rollback, and reopening the database.
- Android x86_64 development APK built successfully with JDK 17 (1m 35s,
  477 tasks) and installed on `emulator-5554`.

## Android runtime verification

Passed on Android 17/API 37, x86_64, `emulator-5554`, using the Expo development
build. The old Metro session was unresponsive; a fresh server on port 8083 rebuilt
its incompatible cache and successfully served the app. Existing Step 2 trips
remained intact after the native SQLite migration.

With Wi-Fi and mobile data disabled (both settings verified as `0`):

1. Created the synthetic `Step3-Route-Smoke` saved trip with unknown dates.
2. Verified “No route added yet”. Added Jalandhar, Shimla, Sangla and Chitkul as
   four separate new Places/Stops, leaving coordinates unknown.
3. Moved Jalandhar down; detail displayed Shimla → Jalandhar → Sangla → Chitkul.
4. Edited Shimla to a stay with approximate details, `Synthetic offline note`
   and lodging label `Synthetic test lodge`.
5. Removed the Sangla occurrence. Its shared Place remained in local lookup.
6. Selected that existing Sangla Place twice, adding one visit and one transit.
7. Force-stopped the app, relaunched and reopened the trip. The route remained
   Shimla → Jalandhar → Chitkul → Sangla → Sangla, including stay certainty,
   note and lodging label. The original removed Sangla occurrence stayed removed.

The development bundle used adb reverse; archive operations used SQLite only.
Networking was restored after the walkthrough. Final process logs showed no fatal
exception, JavaScript error or native header exception. The result was also
visually checked in an emulator screenshot. No physical-device or release-build
certification is claimed.

Ignored local evidence: `.expo/step3-empty-route.xml`,
`.expo/step3-reordered.xml`, `.expo/step3-edited-and-removed.xml`,
`.expo/step3-before-restart.xml`, `.expo/step3-after-restart.xml`,
`.expo/step3-stay-after-restart.xml`, `.expo/step3-route.png`,
`.expo/step3-runtime-final.log`, and `.expo/step3-android-build.log`.

The synthetic smoke trip remains in the emulator for inspection. No commit or
push was performed. No blockers remain for this milestone.
