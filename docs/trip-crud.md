# Step 2 — local Trip CRUD

This milestone follows the user-requested Step 2 scope (the trip vertical slice),
using the Step 1 SQLite, domain validation, migration and repository foundation.
No schema migration or dependency change was needed.

## Behavior

- Trips Home reads SQLite and groups saved trips, undated saved trips, and drafts.
  Newest known start dates appear first, UUID breaks ties, unknown starts sort last.
  Lists are virtualized and offer another page after each 100 records.
- Empty Home shows “No trips yet” and “Create first trip”.
- Create/edit supports title, independent day/month/year/unknown endpoints,
  approximate certainty, optional date label and summary, and favourite status.
  Unknown end never means the start date. No synthetic sorting date is displayed.
- Valid input autosaves after 600 ms. A new trip first becomes a durable draft.
  Save trip publishes it; Save as draft retains/resets draft status. The editor
  serializes saves so rapid input cannot create duplicate drafts or reorder writes.
  Success appears only after commit. Invalid or failed input stays in the editor;
  leaving unsaved input requires save, explicit discard, or staying in the editor.
- A process kill can lose input that has not committed (including incomplete,
  invalid input). Committed drafts survive restart. This milestone does not add
  a separate incomplete-text draft table.
- Detail shows title, honest date label, summary, favourite and draft/saved status,
  edit, and a confirmation naming the trip before deletion.
- Repository writes invalidate screen queries only after commit. Focused screens
  requery SQLite; there is no Zustand/canonical in-memory trip store.
- Edits retain omitted fields, IDs and creation timestamps. Editing unrelated
  fields preserves DateSpec provenance and its original unknown-end representation.
- Home no longer links to the Step 0/1 verification screens. Their routes and
  underlying tests remain available for development verification.

## Trash limitation

Trash uses the existing `deleted_at` tombstone. Deletion/restoration is a short,
vault-scoped transaction, preserves draft/saved status and all content, and hides
deleted trips from ordinary queries. Trash can be reopened after process death.
There is no permanent delete, expiry, purge worker, or 30-day retention enforcement
in this slice: records remain recoverable indefinitely. Only Trip and Vault exist
in the current schema; future child aggregates must extend these commands before
they are introduced. No broad future trash infrastructure was added here.

## Android navigation compatibility

The runtime test reproduced Screens 4.26.2's native header lifecycle exception
when saving and leaving an editor. Step 2 routes now use a minimal React-rendered
header, keeping native stack navigation and unsaved-input protection. The save,
edit, back, delete, restore and discard paths subsequently passed. No dependency
upgrade or native patch was made. Related upstream report:
https://github.com/software-mansion/react-native-screens/issues/4429

## Verification

- `pnpm run typecheck`: passed.
- `pnpm run test:step1`: 20 passed, no failures.
- `pnpm run test:step2`: 8 passed, no failures. Tests exercise the actual form
  command path against real SQLite: create/publish/edit, exact ranges, invalid
  fields, transaction rollback, stable list pagination/order, date labels,
  grouping/empty state, provenance preservation, tombstone ownership, restore
  after reopen, and post-commit subscriptions.
- Android `:app:assembleDebug -PreactNativeArchitectures=x86_64`, JDK 17:
  passed; final rebuild completed in 2m 53s (477 tasks). APK installed on
  `emulator-5554` (Pixel_8, Android 17/API 37).
- Emulator UI smoke: empty state, title-only autosaved draft, approximate 2022
  saved trip, summary/favourite, title edit, trash confirmation, deletion, restore
  after force-stop, resumed draft, December 2022 edit, invalid February 29 input
  and discard protection, exact 29 February–2 March 2024 range, and back to Home.
  Final cold relaunch retained saved exact/approximate trips and the month/year
  draft in the expected list order and sections.
  Offline edit/create/restore ran with Wi-Fi and mobile data disabled; the
  development bundle remained reachable through adb reverse. Networking was
  restored after testing. This is development-build emulator evidence, not
  physical-device or standalone release certification.
- Final process log had no fatal exception or JavaScript error. It recorded a
  nonfatal development-launch `ReactNoCrashSoftException` for window focus before
  the React context was ready; the app then loaded and rendered persisted trips.
- Local ignored evidence: `.expo/step2-*.xml`, `.expo/step2-detail.png`,
  `.expo/step2-runtime-final.log`, `.expo/step2-android-build*.log`.

Synthetic emulator smoke trips are named `Step2-Smoke-Edited`, `Step2-Draft`, and
`Step2-Exact`; these are test fixtures, not asserted travel history.

No places, media, maps, companions, chapters, dreams, search, backend, auth or sync
work was implemented. No commit or push was performed.
