# Final release QA — 20–21 October 2026

Branch `chore/final-release-qa` matches remote main `ebb6395`. All requested
feature merges are present. No production changes were justified.

**PASS — RELEASE QA VERIFIED**

- **P0:** None reproduced.
- **P1:** Physical runtime coverage is Samsung SM-M146B, Android 15, ARM64,
  4 KiB pages. Physical 16 KiB hardware and store rollout remain unverified.
  Existing API 24–27 photo-import limitation remains documented.
- **P2:** Restored photo previews require explicit Retry preview; regeneration
  succeeds. Full K1 lint passes with 0 errors / 27 existing warnings.

Verification: TypeScript and 241 host tests pass, including populated schema
1–11 upgrades to 12. The isolated `com.tripmemoryvault.finalqa` release harness
passes native migration rollback, trip CRUD, timeline/stays, image import, pin
CRUD, v1/v2/v3 restore, checksum and nonempty-destination rejection, foreign-key,
FTS and SQLite integrity, close/reopen, and offline cold reopening. Restore
touches only synthetic disposable vaults. Normal Android pickers also pass:
two photos imported, v3 folder exported with every checksum verified, restored
into an empty disposable installation, and reopened with photos offline.

Normal Samsung UI passes fresh live ORS generation (3/3 legs), preview retention
across panels/selection/Fit/photo memory, pin creation/edit/reposition/removal,
offline photo viewing and cold map reopening. Initial transient network failures
recover on explicit retry. Cold launch retains photos/pins but discards ORS
geometry. Permanent provider storage remains disabled.

Signed APK/AAB, independent signer verification, exact permission allowlist,
four ABIs, Hermes and 16 KiB alignment pass. Installed and rebuilt production JS
bundles match byte-for-byte. SecureStore-only ORS handling, credential-canary
tests, and bounded artifact/log scans pass; the MapTiler mobile token is public.

Production installation was not replaced/reset; installation metadata is unchanged.
Its existing photo and four Stops remain. The QA pin and disposable app were
removed; radio states restored. No commits/pushes.
Reproduction: `tests/release/README.md`; local evidence:
`.expo/final-release-qa/`. Synthetic export retained in the phone's
`Download/TMV-Final-QA-Exports` folder. Store distribution is untested.

READY FOR NEXT STEP
