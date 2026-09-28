# Step 4 — TripDay and trip timeline

This implements the requested Step 4 scope on the existing Steps 0–3. The
architecture's entity and integrity rules govern this slice; its longer milestone
numbering is not used to expand the requested scope. No media tables, dependencies,
backend, or other product features are added.

## Storage and behavior

Migration 3 adds `trip_days` with stable UUID, vault/trip ownership, nonnegative
safe-integer position, nullable label and DateSpec JSON, and shared timestamps and
tombstone. It adds ordered lookup and unique active `(trip_id, position)` indexes.
Same-vault Trip references and active-parent triggers protect sections.

Stops gain nullable `day_id` and a composite `(vault_id, trip_id, day_id)` foreign
key to TripDay. SQLite requires rebuilding the Stop table to add that composite
constraint. The migration explicitly copies every existing column, recreates all
Step 3 indexes/triggers, and defaults existing assignments to null. Migrations 1
and 2 remain unchanged. The existing transactional backup/recovery runner handles
the upgrade. Day assignment indexes and active-section triggers are included.

Repository operations create, list, update, reorder, remove and restore sections,
and assign, move or unassign Stops. Every mutation is transactional, advances the
Trip order revision and notifies subscribers only after commit. Reorder checks the
expected revision and full sibling membership, using disjoint temporary positions.
Section ordering is independent of the Stop's existing trip-wide route position.

Removing a section first detaches all its Stops, including separately removed
Stops that might later be restored. It then tombstones the section and compacts
section positions. Stops and Places survive, and Stop date/source/stay data is
untouched. Restore appends the section as empty; it does not reclaim Stops that
may since have been assigned elsewhere. The editor offers immediate restore of
the last removed section. Repository restore also works after reopening, but this
slice does not add a persistent removed-section browser or purge worker.

Trip trash hides sections through the deleted parent, retaining their IDs and
assignments. Existing trip restoration brings these sections back into view and
restores the aggregate's Stops. Individually tombstoned sections remain removed.
All public timeline reads and writes require an active trip and vault.

## UI and dates

Trip Detail displays ordered sections and the names of their assigned Stops in
route order. Empty sections remain visible. Unassigned Stops are shown separately.
The empty timeline says “No timeline added yet”; “Add day / section” opens the
editor. The editor supports labels, optional dates, up/down ordering, removal,
restoration, and moving existing Stops between sections or back to trip level.

Date fields reuse DateSpec validation and the existing date form conversion.
They accept day, month and year precision, approximate certainty, ranges, unknown
endpoints and absent dates. To explicitly represent a single day, both endpoints
are that day. No date is derived from position; no missing days or labels are
generated. A custom label is displayed as entered, and an unlabeled, undated
section is “Untitled section”. Unchanged date values retain their source.

Section forms use explicit Save and protect unsaved input on Cancel/Back, matching
the Step 3 editor pattern. “Saved on device” follows a committed operation;
unfinished form input is not claimed to survive process death.

## Checks

- TypeScript and `git diff --check` pass.
- All 58 SQLite/domain tests pass: Step 1 (20), Step 2 (8), Step 3 (14),
  Step 4 (16). Earlier test changes only update the schema inventory.
- Step 4 covers v2 upgrade/data preservation, failed migration recovery,
  exact/approximate/day/month/year/range/absent dates, validation, stable reorder,
  stale revisions, injected rollback, assignment/movement/unassignment, repeated
  Places, safe deletion/restoration, trip/vault isolation, aggregate trash and
  database restart persistence.

## Android runtime verification

Verified on `emulator-5554`, Android 17/API 37, x86_64, using the existing Expo
development APK and the updated bundle. No native dependency or APK change was
needed. Both Wi-Fi and mobile data settings were verified as `0` throughout the
walkthrough and restart checks. Metro supplied the development bundle through
adb reverse; the timeline workflow used local SQLite.

1. Opened the existing synthetic `Step3-Route-Smoke` trip after migration and
   verified “No timeline added yet” and all five existing active route Stops.
2. Created `Early in the trip`, `Later`, and `Part 2`. Kept two undated and edited
   `Later` to approximate year 2001, retaining an unknown end.
3. Reordered sections. Assigned Shimla to `Early in the trip`, Jalandhar to
   `Later`, and Chitkul to `Part 2` using the editor.
4. Moved Chitkul from `Part 2` to `Early in the trip`. Moved `Part 2` above that
   section. Removed `Early in the trip` and verified Shimla and Chitkul remained
   in Unassigned Stops. The two Sangla occurrences also remained separate.
5. Force-stopped and reopened the app. Two clean cold launches showed `Later`
   first with its approximate year and Jalandhar assignment, empty `Part 2`
   second, and Shimla → Chitkul → Sangla → Sangla as unassigned.
6. Copied the stopped app's database/WAL for inspection and compared against the
   migration runner's v2 backup. Every original Stop field other than the new
   assignment and audit `updated_at` was unchanged; every Place row was unchanged.
   SQLite integrity and FK checks passed. Inspected the final screenshot.

During the first restart attempt, the old Metro process stopped listening on
8083, causing a development-client connection error. Restarting Metro recovered
the server. One native React Native Fabric `MountingCoordinator::pullTransaction`
SIGSEGV occurred while recovering through the development launcher. It did not
recur in either subsequent clean cold launch; no dependency changes or speculative
native workaround were introduced. The final app process log contains no fatal
signal, fatal Java exception or React Native JavaScript error. This is emulator
development-build verification, not physical-device or release-build certification.

Wi-Fi and mobile data were restored to their original enabled settings afterward.
The synthetic timeline remains on the emulator for inspection. Ignored evidence
is in `.expo/step4-after-delete.xml`, `.expo/step4-after-restart.xml`,
`.expo/step4-second-restart.xml`, `.expo/step4-timeline.png`,
`.expo/step4-runtime-final.log`, and `.expo/step4-device-*`.

## Changed files

- `app/_layout.tsx`
- `app/trips/[tripId]/timeline.tsx`
- `package.json`
- `tsconfig.tests.json`
- `src/core/database/migrate.ts`
- `src/core/database/migrations/0003-trip-days.ts`
- `src/core/database/open.ts`
- `src/domain/stop.ts`
- `src/domain/trip-day.ts`
- `src/features/route/repository.ts`
- `src/features/route/useRouteQuery.ts`
- `src/features/timeline/presentation.ts`
- `src/features/timeline/repository.ts`
- `src/features/timeline/TimelineEditorScreen.tsx`
- `src/features/timeline/TimelineSection.tsx`
- `src/features/timeline/useTimeline.ts`
- `src/features/trips/TripDetailScreen.tsx`
- `tests/step1/database.test.mjs`
- `tests/step1/native-verification.ts`
- `tests/step3/route.test.mjs`
- `tests/step4/timeline.test.mjs`
- `docs/trip-timeline.md`
