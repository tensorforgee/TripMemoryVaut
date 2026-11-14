# Tags and organization — 14 November 2026

PASS — TAGS VERIFIED

## Implementation

Reusable tags can be created, renamed, explicitly deleted with confirmation, and
attached/detached on Trip Details and saved Travel Memories. Search includes tag
name matches and one-or-more-tag filtering; multiple selections mean all selected.
Assignments are direct, independent of parent Trip tags. The same Tag can belong
to multiple Trips and Memories. Content editors preserve associations.

`normalizeTagNameV1` uses NFKC, collapsed whitespace, locale-independent lowercase,
sharp-s and final-sigma equivalence. Active normalized names are unique. Names
are 1–80 characters; empty/control-only names are rejected. Reattaching a pair
reuses its membership ID. All operations use serialized local SQLite transactions.
No dependencies, backend, authentication, cloud sync or navigation redesign added.

## Storage, search and portability

Migration 15 adds `tags`, `trip_tags` and `memory_tags`, with stable UUIDs,
audit/tombstone timestamps, same-vault composite FKs and uniqueness constraints.
Tag deletion tombstones its links without changing Trips, Memories or media.
Trip trash hides memberships and restores independent detach state. Memory
removal detaches its tags. Reset deletes the new references in dependency order.

FTS index version 3 adds tag-name documents with transactional refresh triggers.
Filters use canonical membership joins before limits. Migrations 1–14 and their
imported v1/v2 search SQL remain frozen; no changed installed checksums.

Portable writer v5/schema 15 adds tags and both association JSON files, manifest
counts, validation and escaped journal labels. Readers retain v1–v4 support with
empty tag tables. Older formats cannot smuggle tag payloads. Restore preserves
IDs, names, timestamps and tombstones; it remains empty-vault-only. No changes to
HEIC evidence, original files, MapTiler or ORS geometry/provenance.

## Validation

- TypeScript and test compilation pass.
- 151 focused real-SQLite tests pass: tag CRUD, Unicode duplicate prevention,
  racing creates, membership reuse, detach/reattach, deletion, parent trash,
  vault isolation, edit preservation, offline reopen, FTS prefix/diacritic
  matching, filters before limits, migration rollback and upgrades from 1–14.
- Archive tests cover v1–v5, tag round trips and tombstones, malformed names,
  dangling/duplicate links, version smuggling, byte-identical HEIC/HEIF originals,
  interrupted restore, and existing route/photo/memory/settings regressions.
- `git diff --check` passes. No commit or push.

## Android evidence

Device `b0883334`, OPD2514, Android 17. Signed ARM64 builds used JDK 17 and the
existing upload certificate, verified against the installed APK before
`adb install -r`. No uninstall, app-data clear, reset or populated-vault restore.
The existing vault migrated and remained readable.

Actual UI checks used `QA Tags Organization` and `QA Tagged Memory`:

1. Create/attach QA Alpine, reject a case-only duplicate, rename to QA Mountains.
2. Reuse the same tag on the memory; attach QA Family independently.
3. One-tag filtering returns Trip and Memory; two-tag filtering returns only the
   Memory. Open the result directly.
4. With connectivity reporting `Active default network: none`, detach/reattach,
   edit the memory and verify its retained tags; create/attach QA Offline.
5. Cancel tag deletion, then export through the Android system folder picker.
   UI reports verified completion. Inspect and restore the actual device package
   into disposable host SQLite: tag/membership IDs and values match exactly;
   edited text, all-tag filtering, FTS and original bytes survive.
6. Confirm deletion of QA Mountains: both content items remain, QA Family remains
   on the Memory. Force-stop/relaunch offline: deleted-tag search returns no
   result; QA Family finds and opens the edited Memory.

The final signed ARM64 build succeeded in 2m 28s. A keyboard-tap issue found
during QA was fixed by letting the parent detail ScrollViews preserve handled
taps; creating a tag on the first tap after typing was reverified in the final
installed build. Its temporary QA Tap Check tag was then deleted.

Screenshots of selection, filters and deletion confirmation were inspected.
Current-process ReactNativeJS/AndroidRuntime/libc error capture was empty.
Wi-Fi/mobile-data settings were restored to their original enabled state.
Synthetic QA content remains for inspection. The pre-deletion v5 export remains at
`Documents/TMV-Tags-QA/Trip-Memory-Vault-2026-11-14-7ab34607` on the device.
Ignored host evidence is in `.expo/tags-qa/` (build/test logs, screenshots,
UI snapshots, device export and isolated-restore verification).

## Files changed

- New: `src/domain/tag.ts`, `src/features/tags/repository.ts`,
  `src/features/tags/TagSection.tsx`, `migrations/0015-tags.ts`, `tests/tags/`.
- Database wiring: `migrate.ts`, `open.ts`; settings `reset-database.ts` and
  `maintenance.ts`.
- UI: Trip Details, Memories, Search. Search repository and schema.
- Archive: `src/services/archive/portable.ts`.
- Tests: database inventory, HEIC migration boundary, road/archive version
  fixtures, tag coverage; `package.json`, `tsconfig.tests.json`.
- Docs: architecture, database foundation, local search, portable vault, this report.

On-device restore into the populated vault was deliberately excluded; the actual
export was restored and validated using isolated host SQLite instead.

No remaining blockers.

READY FOR NEXT STEP
