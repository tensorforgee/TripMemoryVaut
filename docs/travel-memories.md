# Dedicated travel memories — 12 November 2026

PASS — TRAVEL MEMORIES VERIFIED

## Audit and scope

Trip summaries, Stop notes, timeline sections, chapter descriptions, photo
captions, and manual map photo pins already existed. There was no written Memory
table, editor, attachment relationship, archive payload, or search document.
The implementation adds these without copying existing notes into a second model.
Navigation uses Trip Details and the existing stack. No backend, account,
background location, cloud sync, dependencies, or map/routing behavior changed.

## Storage and UX

Schema 13 adds `memories`, `memory_media`, and local `memory_drafts`. Memories have
UUIDs, required Trip/title/body, nullable DateSpec, audit timestamps, tombstones,
and one optional existing same-trip section/Stop anchor. Place context comes from
the Stop. Attachments reference shared imported Media; original bytes and source
metadata remain unchanged. Trip trash hides/reveals memories through the parent;
independent anchor removal detaches context. Removing a memory retains photos.

Trip Details exposes browse/create/read/edit, existing-vault photo attachment and
detachment, offline photo viewing, and confirmed removal. Editor drafts survive
reopening separately from explicitly saved memories. Search index version 2
indexes saved title/body and opens the selected memory. Integrity/rebuild tools
use the expanded projection. Migration 10 and versions 1–12 retain their original
SQL checksums.

Portable format v4 adds memories and attachment payloads, timestamps/tombstones,
structured dates, shared media references, and readable escaped journal text.
Readers restore v1/v2/v3 with empty written-memory tables. ORS geometry persistence
is unchanged. Draft text is local recovery state and excluded from exports;
save a draft as a memory before exporting it. Browse order is stable creation
order; custom reordering and favourites are outside this scoped milestone.

## Validation

- TypeScript (`pnpm typecheck`) and test compilation passed.
- **124 tests passed** across Memories, database, Trips, timeline, photo pins,
  road-route/archive regression, portable archives, search, settings, and populated
  schema upgrades from every version 1–12. Coverage includes unknown/approximate
  dates, CRUD, shared assets, deleted parents, detachments, rollback, offline
  reopen, draft retention, FTS updates/rebuild, and v1/v2/v3/v4 compatibility.
- `git diff --check` passed. No commit or push.

## Android evidence

Device `b0883334`, model OPD2514, Android 17/API 37. Built a signed ARM64 APK with
JDK 17 and verified its certificate matches the installed application. Installed
using `adb install -r`; no uninstall, data clear, reset, or populated-vault restore.
The existing trip remained readable after migration. Final build succeeded in
2m 4s after the initial native build.

Actual UI verification used the clearly labeled `QA Travel Memories by` draft
Trip, an undated `QA Early section`, and a synthetic blue PNG. Verified:

1. Create/save/read an undated memory and attach the imported photo/section.
2. Force-stop with an unfinished draft, reopen offline, resume the saved text.
3. Edit to approximate year 2009 while leaving the end unknown; detach/re-attach.
4. Search body text, open the matching memory, force-stop, reopen, and view its
   saved photo offline. Connectivity reported `Active default network: none`.
5. Export through Android's folder picker; UI reported verified completion.
   Copied this v4 package to the host and restored it into disposable SQLite.
   Memory/date/context/attachment/search survived; the original PNG matched byte
   for byte. The populated device vault was never restored or replaced.
6. Cancel removal, then confirm removal; search no longer found the memory and
   its original still opened in the existing trip gallery.

Screenshots were inspected. Current-process AndroidRuntime/ReactNativeJS/libc
error capture was empty. Original Wi-Fi/mobile-data preferences were restored.
The synthetic QA Trip/photo remain for inspection; the test memory was removed
as part of the removal test. A pre-removal export remains in
`Documents/TMV-Memories-QA/Trip-Memory-Vault-2026-11-12-7ab34607` on the device.
Ignored host evidence: `.expo/travel-memories-qa/` (build/test logs, UI XML,
screenshots, exported package, isolated-restore verification script).

## Files changed

- Routes: `app/_layout.tsx`, `app/trips/[tripId]/memories.tsx`.
- Database/domain: `src/core/database/migrate.ts`, `open.ts`,
  `migrations/0013-travel-memories.ts`, `src/domain/memory.ts`.
- Features: new `src/features/memories/repository.ts` and `MemoriesScreen.tsx`;
  `trips/TripDetailScreen.tsx`; search `schema.ts`, `repository.ts`,
  `SearchScreen.tsx`; settings `maintenance.ts`, `reset-database.ts`.
- Archives: `src/services/archive/portable.ts`.
- Checks: `package.json`, `tsconfig.tests.json`, new
  `tests/memories/memories.test.mjs`, relevant database/photo-pin/road/archive/
  settings/migration regression fixtures.
- Docs: `architecture.md`, `local-search.md`, `portable-vault.md`, this report.

No remaining blockers. On-device restore was intentionally excluded because the
vault is populated; compatibility/restore used isolated host databases instead.

READY FOR NEXT STEP
