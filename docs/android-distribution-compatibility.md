# Android distribution compatibility — 21 October 2026

**PASS — ANDROID COMPATIBILITY VERIFIED**

- **Actual SDKs:** signed AAB and build evidence confirm min **24**, target **36**,
  compile **36**. Package `com.tripmemoryvault.app`, version **0.1.0**, code **1**.
  API 36 satisfies the [current Play targeting requirement](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).
- **Native packaging:** inspected all **100 libraries across four ABIs**. All 50
  64-bit libraries pass 16 KB LOAD/congruence and RELRO checks; 32-bit libraries
  retain 4 KB alignment. AAB requests `PAGE_ALIGNMENT_16K`; APK zipalign passes.
- **Runtime:** existing x86_64 Android 17/API 37 emulator confirmed
  `PAGE_SIZE=16384`. Launch, SQLite, native photo import, pin CRUD, disposable
  v1/v2/v3 restore and offline reopening pass. Normal UI folder restore, local
  MapLibre rendering, pin creation and offline photo viewing pass. Remote tiles
  timed out; offline fallback rendered. One cached-process kill interrupted the
  first folder-picker attempt; retry succeeded. Physical 16 KB and Android 16
  specifically remain untested.
- **API 24–27:** recommend API **28+ for full functionality**. Keep min 24
  unchanged; older devices are limited/unverified, with no photo import or
  preview regeneration. Disclose this before distribution; do not promise full
  functionality across all installable devices.
- **Release:** trusted signatures, permissions and privacy checks pass; 15
  relevant tests pass; full K1 release lint: **0 errors, 27 existing warnings**.
  Backup/cleartext remain disabled.
- **Store gates:** Play Console acceptance, upload-key registration, unused
  version code, listing/privacy policy/Data Safety completion and older-device
  disclosure remain unverified or pending.

Evidence: `.expo/android-distribution-qa/`. No feature changes, full packaging
rebuild, production-data changes, commits or pushes.

READY FOR NEXT STEP
