# Archive restore native SQLite close failure

## Scope and diagnosis — 14–15 October 2026

The production correction is confined to `src/core/database/open.ts`. No schema,
archive-format, route-provider, MapTiler, ORS, dependency, or product UI changes.

Historical evidence: `.expo/map-v2-physical-restore-crash-oct9.log` records a
Scudo invalid-chunk deallocation SIGABRT, with `exsqlite3_finalize` underneath
`NativeDatabaseBinding::sqlite3_close` / `SQLiteModule.closeDatabase`. That log's
fingerprint identifies SM-S921E/Android 16, not the current SM-M146B/Android 15.

The first actionable cause is **double finalization of FTS5-owned prepared
statements by Expo's default close sweep**. In the pinned expo-sqlite 57.0.3:

1. `SQLiteModule.closeDatabase` calls `maybeFinalizeAllStatements` before close.
2. `NativeDatabaseBinding::sqlite3_finalize_all_statement` traverses
   `exsqlite3_next_stmt` and finalizes every returned statement.
3. These include FTS5's private cached statements. FTS5 still owns their pointers.
4. `exsqlite3_close` disconnects FTS5, which finalizes/frees those resources again.

This does not require outstanding application queries, an open transaction,
concurrent work, React unmounting, or a database-file replacement. The minimal
reproducer commits its transaction and finalizes its application statement first.
On SM-M146B the unsafe native executable crashed with SIGSEGV in allocator / FTS5
teardown; the original SM-S921E log reports SIGABRT. Allocator-dependent signal
differences do not make these different ownership bugs.

The packaged ARM64 `libexpo-sqlite.so` Build ID is
`228abdacc41f61b5f0d51230dedba0f66920ba6c`, exactly matching the historical crash.
Disassembly confirms the statement sweep in this binary; the diagnosis does not
depend only on potentially different source code. The packaged implementation
and same-source device reproduction are the primary evidence.
[Expo issue 38168](https://github.com/expo/expo/issues/38168)
independently describes this FTS close defect. SQLite's
[close contract](https://sqlite.org/c3ref/close.html) requires applications to
finalize their own statements before close.

## Application audit

- `ArchiveScreen` verifies and restores, resets the cached media service, closes
  the old vault handle, then opens the restored vault. The service commits before
  that close; it does not replace or delete a live SQLite file.
- `restorePortableArchive` verifies the archive and stages/verifies immutable
  originals before one metadata transaction. Empty-vault checks run before file
  staging and again inside the transaction. Final FKs and the rebuilt FTS index
  are included in the commit. Canonical imports fire FTS-maintenance triggers.
- `LocalDatabase` serializes repository reads, writes, transactions and close.
  Its queue waits for callback promises, commit/rollback and awaited native
  statement cleanup. Requests queued after close reject without entering SQLite.
- Production repositories use `execAsync`, `runAsync`, `getFirstAsync` and
  `getAllAsync`; they do not retain explicit prepared statements. Expo's three
  run/get helpers await `finalizeAsync` in `finally`, including execution errors.
- `openVaultDatabase` caches one initializer/connection per validated filename
  and uses `useNewConnection`. Migration snapshots use separately owned
  connections and SQLite's backup API, with cleanup in `finally`.
- React focus hooks cancel stale view updates/unsubscribe. Their repository work
  still uses the database queue. The foreground import service has its own queue
  and persisted jobs; no native background SQLite connection was found. A fresh
  restore refuses vaults containing import jobs or media records.
- No evidence requires changing the transaction queue, component lifecycle,
  restore format or original-file handling to fix this crash.

## Correction and recovery contract

Both normal vault and migration-backup opens now use the same options:
`useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false`.
Application statements remain explicitly owned/finalized by Expo's awaited
helpers. SQLite retains ownership of its FTS5 statements. Native close still
runs and errors still propagate; no delays, catch-all suppression, native patch,
or permanent-open workaround is added.

The restore transaction and format are unchanged. Validation/staging/SQL failures
retain the original empty vault. Completed content-addressed originals left by
failure are unreferenced and reusable only after SHA-256/size verification.
Handled failures remove their `.part` files. Process death before commit relies
on SQLite WAL recovery; retry revalidates the archive and originals. Process death
after commit opens the restored vault normally. Old vault handles reject after
close; repositories are recreated with the restored identity.

## Reproducers and regression coverage

- `tests/step1/fts-close-repro.c`: pinned SQLite source, in-memory only. `unsafe`
  reproduces the exact Expo sweep in an isolated process; normal mode closes 20
  fresh FTS databases without the sweep. No valuable filesystem input is accepted.
- `tests/step12/restore-audit.gradle` and `restore-audit-entry.tsx`: standalone
  Android test application ID `com.tripmemoryvault.restoreaudit`, with embedded
  Hermes JS and the existing native dependencies. The regular app/route guards
  are unchanged. Do not install a test APK unless its actual manifest confirms
  that isolated ID.
- `restore-crash-verification.ts`: real Expo statements (success/failure), queued
  transaction/close, three full synthetic export/restore round trips, rollback
  before commit, reopen/retry, actual process-death interruption and restart
  audits. `unsafe` restores using default Expo options and intentionally crashes
  at close; it is an explicit negative control, never a production action.
- Host regression adds repeated fresh restore/FTS/close/reopen with deterministic
  re-export, failure during inserts and at commit, staging cleanup, orphan
  verification/reuse, stale-work rejection, and full legacy v1 restore on schema
  11. Existing v2 route geometry/provenance compatibility and credential exclusion
  tests remain mandatory.

Build the isolated APK with JDK 17, the existing Android SDK/Gradle cache, and
`EXPO_NO_DOTENV=1` / `NODE_ENV=production`:

```powershell
./android/gradlew.bat -p android :app:assembleRelease `
  -I "$PWD/tests/step12/restore-audit.gradle" -PtmvUnsignedRelease=true `
  --no-daemon --no-watch-fs --no-parallel --max-workers=1 --console=plain
```

This is an unsigned **test** artifact, not a production release. Sign a separate
copy with the public template debug key for disposable installation. Verify the
signature and package with `apksigner` and `aapt` before installation. Never use
uninstall, `pm clear`, or reset on `com.tripmemoryvault.app` for this procedure.
Run via `com.tripmemoryvault.restoreaudit/com.tripmemoryvault.app.MainActivity`
with VIEW and an initial URL `tripmemoryvault://audit?mode=suite`. Force-stop only
the isolated package between modes, then launch `unsafe`, `unsafefts`, `suite`,
`interrupt`, `recover`, and `audit` in separate processes. The two unsafe modes
deliberately corrupt the disposable process and can crash after close rejects;
retain their logs separately from corrected runs. For interruption, wait for
`INTERRUPT_READY_BEFORE_COMMIT` in logcat
and force-stop only the isolated package. Do not use a timer to guess the boundary.

Host command (JDK 17; writable TEMP/TMP on sandboxed Windows):

```powershell
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.tests.json
node --test tests/step1/*.test.mjs tests/step7/*.test.mjs `
  tests/step12/*.test.mjs tests/step13/*.test.mjs tests/step14/*.test.mjs `
  tests/routing-credentials/*.test.mjs tests/release/*.test.mjs
git diff --check
```

## Results

Evidence is retained locally under ignored `.expo/archive-restore-audit/`.
The physical device is Samsung SM-M146B, serial RZCW3261ZBJ, Android 15.
No original application data has been cleared, reset, replaced or uninstalled.

- Native negative control: reproduced allocator/FTS teardown crash; symbolized
  executable stack saved in `native-symbolized.txt` and crash in `native-crash.log`.
- Native corrected close: 20/20 in-memory FTS cycles passed (`native-safe.txt`).
- Actual Expo negative controls: a real archive restore committed, then default
  close rejected with SQLite code 5 (unfinalized statements/unfinished backups),
  followed by native SIGSEGV (PID 10950). A minimal Expo FTS database with all
  application statements finalized also rejected close and later SIGSEGV'd
  (PID 11219). These delayed stacks appear in React/HybridData after heap
  corruption; they are not themselves direct FTS stacks. The native reproducer
  and historical symbolized stack locate the first ownership error. Evidence:
  `final-unsafe-js.log`, `final-unsafe-crash.log`, `final-unsafefts-js.log`, and
  `final-unsafefts-crash.log`.
- Fixed Expo application: three suite runs, nine complete synthetic archive
  export/restore round trips into fresh disposable databases. Each suite also
  passed helper/explicit-statement finalization, queued transaction/close, and
  injected rollback/reopen/retry (three additional successful retry restores).
  Logs: `app-suite-1-full.log`, `app-suite-2-full.log`, `final-suite-full.log`.
- Real process interruption: force-stop at the explicit pre-commit checkpoint,
  relaunch, verify original empty vault identity and zero imported rows, then
  retry successfully (`app-interrupt.log`, `app-recovery.log`).
- Two separate cold-start audits passed, including the final APK (PID 11956):
  restored identity, SQLite/FK/FTS integrity and original SHA-256/size checks
  survived process restart (`app-restart-1.log`, `final-restart-full.log`).
  The reused older helper emits an “offline” label even when called within a
  suite; connectivity was not changed here and that label is not evidence of
  an offline test. Only the separate `audit` process runs prove cold restart.
- All seven corrected-run logs have zero matches for SIGABRT, SIGSEGV, JNI
  fatal errors, fatal exceptions, audit failures, or SQLite close errors;
  counts are saved in `fixed-log-audit.json`. Deliberate unsafe runs are excluded
  and their failures retained above.
- Integrity: original bytes and checksums, canonical IDs/relationships, unknown
  dates, trash, gallery/timeline/map projections and restored vault identity
  passed. Corrupted checksums and nonempty destinations are rejected. Insert
  and commit failures roll back, clean staging and permit verified-original
  reuse. Legacy archive v1 restores into schema 11; v2 route geometry/provenance
  and ORS credential exclusion tests passed. No archive format changed.
- Host: 107 tests passed, zero failures/skips (`host-tests-final.log`). The initial
  Java fixture packaging attempt failed because of sandbox TEMP permissions;
  rerunning with a workspace TEMP/TMP passed without changing the verifier.
- TypeScript and the test compilation passed.
- Standalone release/Hermes test APK built successfully for all four configured
  ABIs; release vital lint passed during build. The separately debug-signed test
  copy's manifest was checked for `com.tripmemoryvault.restoreaudit` before
  installation. Final APK SHA-256:
  `DB3492B04B0012B1562729C56A5E5F25038954F8206A32597F82640819396FBE`.
  This is not a production-signed release candidate.
- `git diff --check` passed.
- Full Android release lint did **not** pass. Default K2 analysis crashed in the
  Worklets dependency with `Cannot find a KaModule` (`release-lint.log`). Retrying
  with the supported command-line `'-Pandroid.lint.useK2Uast=false'` completed
  analysis and reported 1 error / 28 warnings (`release-lint-k1-final.log`,
  `lint-results-release.txt`). The error is
  `PermissionImpliesUnsupportedChromeOsHardware` on the existing source-manifest
  `<uses-permission android:name="android.permission.CAMERA" tools:node="remove"/>`.
  The merged release manifest has no CAMERA permission. This unchanged
  permission-removal directive is unrelated to SQLite, and no lint rule,
  permission policy or baseline was changed to hide the failure. Release vital
  lint and the standalone build passed; the full lint gate remains unresolved.

## Changed files and limits

Production: `src/core/database/open.ts` only. Regression coverage:
`tests/step1/database.test.mjs`, `tests/step1/fts-close-repro.c`,
`tests/step12/archive.test.mjs`, `tests/step12/restore-crash-verification.ts`,
`tests/step12/restore-audit-entry.tsx`, `tests/step12/restore-audit.gradle`.
This report is the eighth changed file.

The physical verification covers ARM64 Android 15 on a 4 KiB-page SM-M146B.
It does not claim a new SM-S921E/Android 16 run, 16 KiB hardware verification,
store rollout, or installing the fix over the valuable production vault.
The real application's version/install/update timestamps are identical before
and after testing (`protected-app-before.txt`, `protected-app-after.txt`). No
commands cleared, reset, replaced, or uninstalled that application's data.
After capturing evidence, the disposable `com.tripmemoryvault.restoreaudit`
package and `/data/local/tmp/tmv-fts-close-repro` executable were removed. The
original `com.tripmemoryvault.app` remains installed. No commit or push was
performed.

Archive crash verdict: **PASS — ARCHIVE RESTORE CRASH FIXED**. No remaining
blocker to the demonstrated archive-close correction. Full release lint remains
a separate unresolved check, so this report is not an all-green release approval.
