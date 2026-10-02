# Android release hardening — Phase 1

Scope: production builds and verification of the existing Steps 0–14. No domain,
migration, dependency-version, lockfile, or product-feature changes.

## Baseline

| Component | Pinned/configured value |
| --- | --- |
| Expo / React Native / React | 57.0.25 / 0.86.3 / 19.2.3 |
| Reanimated / Worklets | 4.5.1 / 0.10.1 (pinned transitive peers) |
| MapLibre React Native / Android | 11.4.0 / 13.6.1, OpenGL |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| Android Build Tools / NDK | 36.0.0 / 27.1.12297006 |
| CMake / Ninja | 3.22.1 / 1.10.2 |
| Android Gradle Plugin / Gradle | 8.12.0 / 9.3.1 |
| JDK | Temurin 17.0.20.1; use JDK 17, not Android Studio's JDK 25 |
| ABIs | armeabi-v7a, arm64-v8a, x86, x86_64 |
| Package / versionName / versionCode | com.tripmemoryvault.app / 0.1.0 / 1 |
| Display name | Trip Memory Vault |

The existing media importer requires API 28 despite the app's minimum API 24;
older versions show the existing explicit unsupported-import error. This phase
does not change that product contract.

## Fresh reproduction and root cause

Started from the clean Step 14 checkout using the documented JDK 17 environment:

```powershell
.\android\gradlew.bat -p android :app:bundleRelease --no-watch-fs --parallel --max-workers=4 --stacktrace --console=plain
```

The fresh release attempt failed after 16m 18s. First failing task:
`:expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a]`. Reanimated then failed
at `:react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a][reanimated]`.
Both repeatedly regenerated CMake output before Ninja reported
`manifest 'build.ninja' still dirty after 100 tries`.

The Reanimated working directory was:

```text
C:/dev/tripmemoryvault/.pnpm/_0876b228697baf1b19e314628d469c0a/node_modules/react-native-reanimated/android/.cxx/RelWithDebInfo/s682j123/arm64-v8a
```

`ninja -n -d explain` reported an existing Worklets Prefab CMake configuration as
missing. The relative input includes `../prefab/arm64-v8a/prefab/lib/` followed by
`aarch64-linux-android/cmake/react-native-worklets/react-native-workletsConfigVersion.cmake`.
Its working-directory-plus-relative spelling is 268 characters (255 normalized).
The corresponding Expo Modules Core path is 262 characters (249 normalized).
Node/Windows successfully stat both files. Ninja 1.10.2's Windows path handling
does not: the supposedly missing inputs perpetually dirty the manifest.

This is generated-path length, exposed by the longer `RelWithDebInfo` variant
and ABI/Prefab directories, not evidence of incompatible Reanimated or a JDK 17
failure. Existing `.pnpm`/32-character virtual-store settings alone are insufficient.
The release CMake directories were newly generated, so stale debug outputs do
not explain this reproduction. Evidence: ignored `.expo/release-baseline.log`,
`release-ninja-explain.log`, and `release-core-ninja-explain.log`.

## Fix and build hygiene

The tracked `withAndroidRelease` Expo config plugin reapplies two small Gradle
policies after prebuild. `android-native-paths.gradle` sets Windows library CMake
staging to `android/.cxx/<project-name>`, outside the long dependency directories.
Variant/hash/ABI separation remains managed by AGP. Other platforms are unchanged.
The regenerated Reanimated Worklets config-version paths are 202 characters for
ARM64 and 204 for armeabi-v7a (normalized), leaving room for Ninja's relative spelling.
No package patches, Ninja/CMake/NDK upgrades, ABI exclusions, or lockfile edits.

After the failed build, stopped Gradle and moved only the affected Reanimated and
Expo Modules Core generated `.cxx` directories into
`.expo/release-native-before/`. They are recoverable diagnostic output. Expo
prebuild regenerated the ignored Android project. Native source remains in
`modules/archive-media`, and persistent configuration remains in app.json/plugins/scripts.
No emulator data or app source was removed.

## Reproducible release build

From this short local checkout (not a synced folder):

```powershell
$env:JAVA_HOME = 'C:\Users\rohit\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:NODE_ENV = 'production'
$env:EXPO_NO_TYPESCRIPT_SETUP = '1'
pnpm install --frozen-lockfile
pnpm exec expo prebuild --platform android --no-install
.\android\gradlew.bat -p android :app:bundleRelease :app:assembleRelease --no-watch-fs --no-parallel --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m' --console=plain
```

Configure upload signing first (below). For explicitly **unsigned, non-uploadable**
verification only, append `-PtmvUnsignedRelease=true`. Do not limit
`reactNativeArchitectures` to x86_64. One Gradle worker and two JS bundler workers
bound memory on this 8 GiB Windows host; the emulator can be stopped during build
and restarted without wiping its data.

Release uses Expo `export:embed` and Hermes, with `index.android.bundle` packaged
as an application asset. Running a bundler during compilation is expected;
the installed release must not need a running Metro server.

Outputs are `android/app/build/outputs/bundle/release/app-release.aab` and, in
explicit unsigned mode, `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
Inspect the actual AAB with `powershell -File scripts/verify-android-bundle.ps1`.
The scanner requires Hermes bytecode, all four ABI directories, the expected
React Native/Hermes/Reanimated/Worklets/MapLibre libraries, matching ELF machine
types and at least 16 KiB LOAD alignment for 64-bit libraries. It also reports
whether a bundle certificate is present; this is not proof of upload authorization.

## Signing

The owner confirmed there is no production upload keystore. The template's debug
signing fallback is overridden with `null`. Ordinary release packaging fails
unless all four environment variables are set; partial settings and mixing
signing with explicit unsigned mode also fail. Values are never printed by the policy.

Create and securely back up a private upload key **outside the repository** using
JDK `keytool -genkeypair -v -storetype JKS -keystore <private-path>/tripmemoryvault-upload.jks -alias tripmemoryvault-upload -keyalg RSA -keysize 2048 -validity 10000`.
Let keytool prompt for passwords; do not place them in command history or chat.
The owner must retain the key, alias and passwords and configure Play App Signing.

Supply locally through a secure shell/CI secret environment:

- `TMV_UPLOAD_STORE_FILE`: absolute keystore path.
- `TMV_UPLOAD_KEY_ALIAS`: upload alias.
- `TMV_UPLOAD_STORE_PASSWORD` and `TMV_UPLOAD_KEY_PASSWORD`: private credentials.

Then rebuild without `tmvUnsignedRelease`. Verify the resulting certificate before
upload. `.gitignore` excludes keystores, JKS/P12/PFX files, signing property files
and dotenv files. Never add credentials to Gradle files or commit generated artifacts.

A verification APK may be signed separately with the existing public Android
debug key to update the emulator in place. That does **not** make the APK or an
unsigned AAB acceptable for Play submission and does not make it a debug build.

## Production configuration

- Every `*-test` route is enclosed in `Stack.Protected guard={__DEV__}`; the old
  MapLibre smoke page also has a component guard. Underlying test fixtures remain.
  Normal navigation already guards verification links. Router's automatic sitemap
  is disabled to avoid a production route/debug inventory.
- Release policy rejects `expo.devlauncher.configureInRelease=true`. Expo's pinned
  launcher/menu packages supply disabled release implementations; keeping them for
  development does not require their launcher at runtime.
- The release-only manifest removes INTERNET, ACCESS_WIFI_STATE, SYSTEM_ALERT_WINDOW
  and VIBRATE. The product uses bundled maps and local files; no network service is
  configured. ACCESS_NETWORK_STATE remains for image/map native connectivity monitors.
  Cleartext is explicitly disabled. Debug Metro permissions remain separate.
- Existing photo-picker/location/media/camera/microphone permission removals and
  `allowBackup=false` are preserved. No permission request was added.
- The inspected merged release manifest contains exactly
  `android.permission.ACCESS_NETWORK_STATE` and
  `com.tripmemoryvault.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. The latter is
  AndroidX's signature-protected receiver permission, not a user-data permission.
  Generated BuildConfig reports `DEBUG=false`, `BUILD_TYPE=release`, Hermes on,
  package/version as above; no development launcher/menu activity is registered.
- Icons/splash are still generated Expo template assets, not approved production
  branding. App/store icons, screenshots, feature graphic, privacy-policy listing,
  content/data-safety declarations, signing and Play Console setup require owner review.

## Verification results

The first fixed full release build completed in 34m 40s (878 tasks), including
all four ABIs for Worklets, Reanimated, Expo Modules Core, Screens and the app.
Running Ninja again in the ARM64 Reanimated directory reports `no work to do`,
not perpetual manifest regeneration. The final incremental rebuild also includes
the runtime-discovered Settings metadata correction (successful in 7m 6s,
83 tasks executed / 795 up-to-date): when Expo native build
metadata is absent, use configured Android versionCode, otherwise say unavailable;
never label a release as a development build merely because a field is absent.

Baseline host checks: TypeScript and all 161 Step 1–14 tests pass. Five focused
release configuration tests cover idempotent prebuild injection, signing policy,
development route guards, permission restrictions and build metadata. Before installation, the
force-stopped emulator's app files were saved to ignored `.expo/release-preinstall.tar`.
Its actual Step 14 database is schema 10, contains zero Trips, and passes SQLite
integrity and foreign-key checks. Its vault identity is preserved for the update
test; no reset is used to make compatibility pass.

Final checks: `pnpm typecheck`, test compilation and the complete Step 1–14 plus
release suite pass (166 tests, zero failures/skips), as does `git diff --check`.
Release lint completes successfully. No dependency version or lockfile changed.

### Final artifacts

- AAB: `android/app/build/outputs/bundle/release/app-release.aab`, 92,257,977 bytes,
  unsigned. SHA-256:
  `CF59E7BEBC3DE32F13932948DA3FA93C0E8959FF580FB5205FE45C0786F6B1DC`.
- Release APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
  Local-only installed copy: `.expo/release-smoke-final.apk`, externally signed
  with the public debug certificate; not a store artifact.
- Actual AAB inspection: 25 native libraries per ABI (arm64-v8a, armeabi-v7a,
  x86, x86_64); matching ELF architectures, 16 KiB minimum LOAD alignment for
  both 64-bit ABIs. Embedded Hermes bytecode is 3,251,444 bytes.
- APK verification: `apksigner verify --verbose` passes v2/v3 signatures on the
  local verification copy; `zipalign -c -P 16 4` passes. `aapt dump badging` and
  `dump permissions` confirm version/package/ABIs and the two permissions listed
  above. No `application-debuggable` flag.

Build evidence: `.expo/release-fixed-build.log` and `.expo/release-final-build.log`.
The unsigned AAB is a production-variant build foundation, not an upload-ready release.

### Standalone runtime

Test device: existing Pixel_8 Google Play x86_64 emulator, API 37, 16 KiB pages.
Installed the release APK in place with `adb install -r`, signed separately with
the public template debug certificate solely to preserve the existing emulator
installation. It is the non-debuggable release variant with embedded Hermes JS,
not the Expo development client. No Metro server or ADB reverse was used. Wi-Fi
and mobile data were disabled throughout the workflow checks.

| Check | Observed result |
| --- | --- |
| Existing Step 14 data | Opens without reset; schema 10 and same vault UUID verified through export |
| Trips / Trip Detail | Created and saved disposable ReleaseVerification; edited to ReleaseVerificationEdited |
| Route / Stops | Created ReleasePlace with synthetic coordinates 30.1, 77.1 and one confirmed Stop |
| Timeline | Added ReleaseSection with unknown date; canonical unknowns remain unknown |
| Photos / gallery | System picker imported synthetic transparent.png; one archived photo and working viewer |
| Trip Map / My Map | Both report local map ready and show the synthetic Place while offline |
| Reconstruction | Existing reconstruction screen opens; no suggestions automatically accepted |
| Companions / Chapters / Dreams | Normal empty-state screens render, no dev routes exposed |
| Travel Life | Reports 1 Trip, 1 Place, 1 visit, 1 unique photo |
| Search | Release query returns the Trip, Place and Trip section |
| Settings | Archive actions, storage, privacy, maintenance and About render |
| Integrity | Healthy SQLite/FKs, known schema 10, 1 original verified, 3 healthy search documents, no interrupted imports |
| Derived maintenance | Search rebuilt; preview regeneration reports 0 needed, 0 failures, 0 missing originals |
| Portable export | User-selected SAF destination; app confirms verified export |
| Dev deep links | All eight *-test routes remain inaccessible; positive-control /search opens normally |
| Final offline cold start | Final rebuilt APK installed in place, force-stopped, cold-launched with Wi-Fi/mobile data off; Trip, photo viewer, search and Settings/integrity remain functional |
| Final About | Version 0.1.0, build 1, schema 10, portable format 1 |
| Crash checks | No JS/native app crashes during release smoke checks; process logs bounded to the current launch and app exit history checked |

The export is stored separately in the emulator's
`Download/TMVExports9/ReleaseHardening/Trip-Memory-Vault-2026-10-02-26f8947b`.
All 19 manifest-listed files were independently checked for SHA-256 and size.
The original is 301 bytes with SHA-256
`78a142d9b15903ad9ceb777925097f201e0a630d42246b13b9016392336661c8`, identical to
`tests/fixtures/media/transparent.png` after preview maintenance. Exported vault
UUID matches the saved pre-update database. Storage correctly separates 301 B
originals from 418 B previews, reports zero staging bytes and labels database
size as an estimate. No destructive reset was performed.

No Metro processes or ADB reverse mappings were present during final runtime
verification. Emulator Wi-Fi/mobile data were restored to their previous enabled
state afterward. Historical emulator logs include older Step 14 exits and reused
PIDs; they must not be mistaken for crashes of this release session. The package
replacement terminated the prior process as expected, then cold launch succeeded.

Local evidence remains under ignored `.expo/release-*`: build logs, runtime UI
hierarchies/screenshots, process logcat, pre-install snapshots and pulled export.
These are verification evidence, not permanent application logs or telemetry.

### Remaining release gates

- No production upload keystore exists. The AAB is deliberately unsigned and
  **cannot be submitted to Play**. Default release packaging without signing
  credentials was tested and correctly rejected before execution. Owner must
  provision signing as above, rebuild and verify the upload certificate.
- Runtime coverage is x86_64 emulator only. ARM64 and other ABIs are built and
  inspected, not physically exercised; real ARM64 device validation is still
  recommended before store rollout.
- Branding/store listing assets are placeholders; Play Console setup, privacy
  policy and store declarations require owner approval. No branding redesign was
  attempted in this phase.
- The existing API 24–27 photo-import limitation remains; do not advertise that
  import works on those OS versions without addressing the documented contract.

Phase 1 outcome: build blocker fixed, standalone smoke/regression checks pass;
release remains blocked on production upload signing and owner store preparation.
