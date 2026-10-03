# Android release hardening

Scope: production builds and verification of the existing Steps 0–14. No domain,
migration, dependency-version, lockfile, or product-feature changes.

Current status: the production upload-signed AAB is cryptographically verified,
and its companion production APK passes physical ARM64 verification on a Pixel 9
(API 36, 4 KB pages). See the final physical-device results below; earlier missing
signing/device results are historical. Store rollout checks remain separate.

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
Inspect the actual AAB with `./scripts/verify-android-bundle.ps1` in PowerShell,
after configuring bundletool and the certificate fingerprint below.
The scanner requires Hermes bytecode, all four ABI directories, the expected
React Native/Hermes/Reanimated/Worklets/MapLibre libraries, matching ELF machine
types and at least 16 KiB LOAD alignment for 64-bit libraries. It also reports
the verified upload signature against an independently supplied certificate.
Explicit unsigned inspection requires `-AllowUnsigned` and never establishes
upload readiness.

## Signing

### Audit before key provisioning and signing policy

At the initial 2026-10-03 audit all four `TMV_UPLOAD_*` signing inputs were absent from the build
process. The repository (including ignored Android output, excluding dependency
trees) contained only the public template debug keystore. No production upload
keystore is available through the configured sources; unrelated private folders
were not searched. The owner previously confirmed none existed. No key was created
at that stage. The authorized provisioning section at the end supersedes this
historical input status.

| Input | Current status |
| --- | --- |
| Upload keystore / absolute path | Not provisioned |
| Upload alias | Not supplied |
| Keystore password | Not supplied |
| Key password | Not supplied |
| Release signing configuration | Implemented and injected by `plugins/withAndroidRelease.js` |

`app.json` registers that plugin. It appends the tracked
`scripts/android-release.gradle` policy after the generated Expo template, so
prebuild cannot silently restore release debug signing. The template's release
debug assignment is overridden with `null`, then replaced only for complete
upload credentials. Debug builds retain the ordinary template key.

Normal release packaging fails before compilation when inputs are missing,
partial, whitespace-only, mixed with unsigned mode, or invalid. The policy opens
the keystore, resolves the private-key alias, checks both passwords, certificate
validity, a non-debug certificate, and RSA strength of at least 2048 bits. Failures
withhold provider messages, paths, aliases and values. Credentials are environment
only: no dotenv loading, Gradle `-P` passwords, or committed local-properties
fallback. Do not use Gradle debug logs, `properties`, `signingReport`, build scans,
shell transcripts, or environment dumps in a credential-bearing session.

The explicit `-PtmvUnsignedRelease=true` escape is retained solely for compilation
and ABI inspection without secrets. It creates **non-uploadable** artifacts and
is never a signed-release command. No debug fallback is used in either mode.

### Owner-operated key creation

Run these commands yourself in a private PowerShell terminal with JDK 17, outside
any recorded/transcribed session. Choose a restricted folder outside this checkout
and shared/synced folders; preserve its access controls. Do not send passwords or
the keystore to chat. Values entered at prompts are not literal shell history.

```powershell
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.gradle/jdks/eclipse_adoptium-17-amd64-windows.2'
$env:Path = "$env:JAVA_HOME/bin;$env:Path"
$uploadDirectory = Read-Host 'Existing private directory outside the repository (absolute path)'
$uploadStore = Join-Path $uploadDirectory 'tripmemoryvault-upload.jks'
if (Test-Path -LiteralPath $uploadStore) { throw 'Keystore already exists; do not overwrite it.' }
$uploadAlias = Read-Host 'Choose the upload key alias (retain privately)'
keytool -genkeypair -storetype JKS -keystore $uploadStore -alias $uploadAlias -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000
if ($LASTEXITCODE -ne 0) { throw 'Key generation did not complete.' }
```

Keytool prompts for the store password, certificate identity and key password.
Use a strong password from a password manager; pressing Enter at the key-password
prompt uses the same password, which is compatible with the Android tooling.
JKS is explicitly selected to support Gradle's two password fields; RSA 3072,
SHA-256 and 10,000 days provide a modern key and more than 25 years of validity.
No secret values or real alias are in these instructions.

### Load inputs, build and clear the session

Supply these process environment variables from a local password manager/secure
prompt or masked CI secrets. All four are required; passwords are passed unmodified.

| Variable | Meaning |
| --- | --- |
| `TMV_UPLOAD_STORE_FILE` | Absolute path to the existing private keystore |
| `TMV_UPLOAD_KEY_ALIAS` | Private-key entry alias |
| `TMV_UPLOAD_STORE_PASSWORD` | Keystore password |
| `TMV_UPLOAD_KEY_PASSWORD` | Key password; set even when equal to the store password |

The following uses secure input and clears process credentials in `finally`.
Environment strings necessarily exist in the build process memory; run only on
a trusted workstation/runner. This does not persist secrets using `setx` or files.

```powershell
function Read-PrivateInput([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    try { ([System.Net.NetworkCredential]::new('', $secure)).Password }
    finally { $secure.Dispose() }
}
try {
    $env:TMV_UPLOAD_STORE_FILE = Read-Host 'Absolute upload keystore path'
    $env:TMV_UPLOAD_KEY_ALIAS = Read-PrivateInput 'Upload alias'
    $env:TMV_UPLOAD_STORE_PASSWORD = Read-PrivateInput 'Keystore password'
    $env:TMV_UPLOAD_KEY_PASSWORD = Read-PrivateInput 'Key password'
    $env:NODE_ENV = 'production'
    $env:EXPO_NO_TYPESCRIPT_SETUP = '1'
    pnpm exec expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Prebuild failed.' }
    .\android\gradlew.bat -p android :app:bundleRelease :app:assembleRelease --no-daemon --no-watch-fs --no-parallel --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m' --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed; do not use a previous output.' }
} finally {
    'TMV_UPLOAD_STORE_FILE','TMV_UPLOAD_KEY_ALIAS','TMV_UPLOAD_STORE_PASSWORD','TMV_UPLOAD_KEY_PASSWORD' |
        ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
    Remove-Item Function:Read-PrivateInput
}
```

Outputs after a successful signed build:
`android/app/build/outputs/bundle/release/app-release.aab` and
`android/app/build/outputs/apk/release/app-release.apk`. Never treat a stale AAB
left by a failed build as a newly signed artifact. `.gitignore` already excludes
JKS/keystore/P12/PFX files, dotenv files, signing/keystore/local properties and the
generated Android tree. Ignore protection was checked at root and nested paths;
no signing files are tracked. Never force-add secrets or commit generated artifacts.

### Cryptographic and bundle verification

Use the official [bundletool 1.18.1 all.jar](https://github.com/google/bundletool/releases/tag/1.18.1),
matching the pinned build tool dependency; no application dependency upgrade.
The downloaded official binary used here has SHA-256
`675786493983787FFA11550BDB7C0715679A44E1643F3FF980A529E9C822595C`.
Keep it outside tracked source (this audit uses ignored `.expo/`).

Independently obtain the expected **upload** certificate SHA-256 from Play Console
App signing, or before initial enrollment inspect your keystore with the following
command in your private terminal. It prompts for the store password. Keep its
alias and identity output private; the fingerprint and exported public certificate
are not private keys. Do not derive the expected fingerprint from the AAB under test.

```powershell
keytool -list -v -keystore $uploadStore -alias $uploadAlias
keytool -exportcert -rfc -keystore $uploadStore -alias $uploadAlias -file (Join-Path $uploadDirectory 'upload-certificate.pem')
$env:TMV_BUNDLETOOL_JAR = (Resolve-Path '.expo/bundletool-all-1.18.1.jar').Path
$env:TMV_UPLOAD_CERT_SHA256 = Read-Host 'Trusted upload certificate SHA-256 fingerprint'
./scripts/verify-android-bundle.ps1
if (!$?) { throw 'Release verification failed.' }
```

`VerifyAndroidBundle.java` uses JDK JAR cryptographic verification while fully
reading every entry, requires signature coverage of every payload entry, rejects
duplicate entries, debug/expired/weak certificates and mismatched signers, and
compares the signer to that trusted fingerprint. This allows an Android self-signed
upload certificate without pretending it is a public CA certificate. It does not
print certificate subjects, aliases or private-key material. A `.RSA` entry alone
or `jarsigner` exit zero on an unsigned ZIP is insufficient.

The PowerShell verifier also runs bundletool validation and inspects the **actual
AAB** manifest: package/version match `app.json`, minSdk 24 / targetSdk 36,
non-debuggable/non-test-only flags, disabled backup/cleartext, no dev activities,
and exactly the two allowed release permissions. It checks all four ELF ABIs,
required native libraries, Hermes magic, 64-bit ELF LOAD alignment and bundle
`PAGE_ALIGNMENT_16K`, then prints the artifact hash. Follow the
[Android bundletool guidance](https://developer.android.com/tools/bundletool) and
[16 KB guidance](https://developer.android.com/guide/practices/page-sizes) for
derived APK checks; alignment alone is not a physical-device runtime pass.

For unsigned build inspection only:
`./scripts/verify-android-bundle.ps1 -AllowUnsigned`. Signed bundles are rejected
in that mode so certificate checks cannot accidentally be skipped on a release.

### Play App Signing and backups

The upload key authenticates AAB submissions; Google uses a separate **app signing
key** to sign APKs delivered to users. Enroll the package in Play App Signing and
register/confirm the upload certificate in Play Console. A valid local signature
does not prove Console enrollment or upload authorization. Prefer a separate
Google-managed app signing key for this new Play app. If distributing through
other stores with the same app identity, decide app signing key custody before
enrollment. See [Android signing guidance](https://developer.android.com/studio/publish/app-signing).

Securely back up the upload keystore, alias, both passwords and recovery details;
keep an encrypted offline copy and a separate password-manager record. Retain the
public upload/app-signing certificates and fingerprints, package name, Console
ownership/recovery access and build/version records. If you supply your own app
signing key, protect its backup separately. Never upload private key material to
chat or source control. Losing an upload key requires the Play upload-key reset
process, not an app signing key replacement.

An upload-signed local APK cannot update a debug-signed or Play-app-key-signed
installation. Use a spare device/test profile or export and verify the existing
vault first; never uninstall and discard user data merely to make a smoke test pass.

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

### Phase 1 remaining release gates (historical)

- No production upload keystore exists. The AAB is deliberately unsigned and
  **cannot be submitted to Play**. Default release packaging without signing
  credentials was tested and correctly rejected before execution. Owner must
  provision signing as above, rebuild and verify the upload certificate.
- Runtime coverage is x86_64 emulator only. ARM64 and other ABIs are built and
  inspected, not physically exercised; real ARM64 device validation is required
  before declaring this release ready (architecture ADR-001).
- Branding/store listing assets are placeholders; Play Console setup, privacy
  policy and store declarations require owner approval. No branding redesign was
  attempted in this phase.
- The existing API 24–27 photo-import limitation remains; do not advertise that
  import works on those OS versions without addressing the documented contract.

Phase 1 outcome: build blocker fixed, standalone smoke/regression checks pass;
release remains blocked on production upload signing and owner store preparation.

## Signing follow-up — 2026-10-03

### ARM64 physical runtime

`adb devices -l` lists only `emulator-5554`, model `sdk_gphone16k_x86_64`.
No physical ARM64 device is connected. **NOT RUN**: cold launch, Trip list/detail,
timeline, route, media import, gallery/viewer, map, reconstruction, search, export,
integrity and offline restart on ARM64. The earlier emulator results above do not
satisfy this gate. No installation, data reset or device setting change was made
during this signing follow-up.

When hardware and signing inputs are available, build `assembleRelease` alongside
`bundleRelease` with the same environment/configuration as documented above. Verify
the APK before installing (Build Tools 36.0.0):

```powershell
$buildTools = Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/36.0.0'
$apk = 'android/app/build/outputs/apk/release/app-release.apk'
& "$buildTools/apksigner.bat" verify --verbose --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature failed.' }
& "$buildTools/zipalign.exe" -c -P 16 -v 4 $apk
if ($LASTEXITCODE -ne 0) { throw 'APK ZIP alignment failed.' }
& "$buildTools/aapt.exe" dump badging $apk
& "$buildTools/aapt.exe" dump permissions $apk
$adb = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
& $adb devices -l
$device = Read-Host 'Authorized physical ARM64 device serial'
& $adb -s $device shell getprop ro.kernel.qemu
& $adb -s $device shell getprop ro.product.cpu.abilist
& $adb -s $device shell getprop ro.build.version.sdk
& $adb -s $device shell getconf PAGE_SIZE
& $adb -s $device install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'Install failed; preserve existing app data.' }
```

Compare the APK signer SHA-256 with the independently trusted upload certificate,
check package/version/permissions, and confirm this is physical ARM64 hardware
before installation. Do not substitute an emulator based on its display name.
If its existing certificate differs, use a spare profile/device; do not uninstall
an existing vault. No Metro server or ADB reverse should be active. Record
model/OS/ABI/page size, AAB/APK hashes and certificate fingerprint with results.

Cold-launch, create a disposable trip with unknown dates, open detail/timeline,
add a clearly synthetic place/route, import a synthetic local photo, view its
gallery/full image, inspect both maps and reconstruction, search the test title,
export to SAF and independently verify hashes, run the integrity check, then
force-stop/restart offline and reopen that data. Inspect current-session crash
logs for native loader, MapLibre, Reanimated/Worklets and media-module failures;
verify picker/file access without broad permissions. Preserve existing vault data
and restore connectivity settings afterward. On a 16 KB device repeat the full
workflow with `PAGE_SIZE=16384`; a 4 KB physical pass does not establish 16 KB
ARM64 runtime compatibility. Play internal testing later also checks APKs signed
with Google's app signing key rather than the local upload certificate.

### API 24–27 compatibility decision

**A — retain minSdk 24 with documented degraded photo import**, for this scoped
signing follow-up. No minimum SDK or product behavior change.

The current AAB manifest itself declares minSdk 24 and targetSdk 36. API 24–27
devices therefore meet its OS installation minimum. A high targetSdk selects
platform behavior and satisfies targeting rules; it does not exclude older OS
versions. Unless the owner separately excludes devices in Play Console, the
photo-import limitation is user-visible there. See Android's
[uses-sdk filtering rules](https://developer.android.com/guide/topics/manifest/uses-sdk-element).

`ArchiveMediaModule.decode` already checks SDK >= 28 before calling ImageDecoder;
the pipeline preserves `ANDROID_9_REQUIRED` as a failed import instead of reporting
an archived original. This affects JPEG/PNG import as well as derivative decoding,
not only HEIC. `docs/media-import.md` documents the API 28 requirement. A fresh
API 24–27 runtime matrix has not been performed; retaining installation eligibility
must not be described as verified full functionality on those versions.

Alternative B (an earlier UI capability gate) could improve the unsupported-import
experience in a separate compatibility fix, but is not necessary to configure
signing. Alternative C would exclude Android 7/8 users entirely, including uses
that do not import photos, and requires a product support decision plus evidence
from the supported-device matrix. Raising minSdk merely to hide the documented
limitation is not justified here. Store copy must disclose Android 9+ photo import;
if full photo import is a launch promise on every eligible device, resolve B/C
with the owner before rollout. No broader media/decoder change was made.

### Verification and outstanding gates

- Full four-ABI `bundleRelease` + `assembleRelease` in explicit unsigned mode:
  **BUILD SUCCESSFUL in 3m 28s**, 878 tasks (57 executed, 821 up-to-date).
  Evidence: ignored `.expo/signing-multiabi-build.log`. No ABI was excluded.
- JDK 17 TypeScript/test compilation and all Step 1–14/release tests: **168 passed**,
  zero failures or skips. Added ignore protection checks and actual JAR verifier
  rejection tests using only the existing public debug key; no private keys generated.
- Real Gradle release task-graph checks reject missing inputs, partial settings,
  signing mixed with unsigned mode, a wrong alias, wrong store/key passwords,
  and a complete configuration pointing at the public debug key. Negative cases
  use only public/disposable test input values and assert they are absent from
  diagnostics. Evidence: `.expo/signing-*.log`. All seven release tests also pass
  after the final signing-policy adjustment. The valid production-key path
  remains untested until provisioned.
- Bundletool validates the rebuilt unsigned AAB. Actual package
  `com.tripmemoryvault.app`, versionName `0.1.0`, versionCode `1`, minSdk 24,
  targetSdk 36, exactly the two documented permissions, 25 libraries per ABI,
  matching ELF machines, 16 KiB 64-bit LOAD alignment and `PAGE_ALIGNMENT_16K`
  pass; Hermes bytecode is 3,251,444 bytes.
- Final artifact: `android/app/build/outputs/bundle/release/app-release.aab`,
  92,257,977 bytes, SHA-256
  `CF59E7BEBC3DE32F13932948DA3FA93C0E8959FF580FB5205FE45C0786F6B1DC`.
  The unchanged hash is expected: only host signing/verification policy and docs
  changed. `jarsigner -verify` explicitly reports `jar is unsigned`.
  Evidence: `.expo/signing-artifact-final.log`. `git diff --check` passes.
- No upload-signed AAB or cryptographic production-signature pass exists.
  Default verification fails closed without the trusted fingerprint; unsigned
  inspection is explicitly labeled and cannot establish signed readiness.

Remaining store blockers: provision/back up the owner's upload key and credentials,
build and cryptographically verify the signed AAB, confirm Play App Signing/package
and upload-certificate enrollment, complete physical ARM64 testing, approve the
API 24–27 degraded-support/store disclosure, and finish production branding,
privacy policy, listing and Play declarations. Signing readiness does not grant
store publishing approval. No commits, pushes, dependency upgrades or features.

**FAIL — RELEASE BLOCKED**

## Authorized upload-key provisioning — 2026-10-03

The owner subsequently authorized creating the production upload key locally.
`scripts/android-upload-signing.ps1 -Action Initialize` created one JKS upload key
with RSA 3072, SHA256withRSA and 10,000-day validity. Its password contains 256 bits
of cryptographic randomness; store and key password are equal for Android tooling
compatibility. The alias is also generated and kept private. No personal identity
was invented for the certificate; its common name identifies the project upload key.

The key is stored at `.local-signing/upload.jks`, outside Git-tracked source.
`/.local-signing/` explicitly ignores the whole directory, in addition to existing
keystore ignore rules. The directory ACL disables inheritance and allows only the
creating Windows account and SYSTEM. `credentials.dpapi` contains the alias, absolute
keystore path and both passwords encrypted with Windows CurrentUser DPAPI.
`upload-certificate.cer` contains only the public certificate, exported directly
from the keystore for independent signer verification. No secret value is printed,
committed, added to documentation, passed as a password command argument, or
stored in plaintext credential files. Initialization refuses to overwrite an
existing signing directory; it is not a key-rotation command.

### Rebuild with this local key

Run in PowerShell 7 under the Windows account that created the credentials:

```powershell
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.gradle/jdks/eclipse_adoptium-17-amd64-windows.2'
$env:TMV_BUNDLETOOL_JAR = (Resolve-Path '.expo/bundletool-all-1.18.1.jar').Path
./scripts/android-upload-signing.ps1 -Action Build
```

This decrypts credentials only in process memory, supplies the four signing
environment variables, runs `bundleRelease` and `assembleRelease` with
`--no-daemon`, clears those variables in `finally`, and verifies the AAB against
the certificate exported during key creation. Missing/unreadable local inputs,
invalid keystore credentials, debug certificates and unsigned output fail closed.
The existing Gradle environment interface remains available for secure CI inputs.
No secret entry is needed for this workstation's subsequent builds.

**Preserve `.local-signing/` when cleaning or moving this checkout.** Git ignores
are not backups; Git and remote clones cannot recover these files. DPAPI ciphertext
is bound to the creating Windows identity/profile and cannot by itself serve as a
portable password backup. Before deleting/resetting this Windows profile or using
another machine, the owner must securely transfer the keystore and recover its
credentials into a password manager in a private local session, then make an
encrypted off-device backup. Do not paste those credentials into chat or logs.
No off-device backup destination was provided, so independent backup remains an
owner action. Keep the public upload certificate/fingerprint for Play enrollment.

Provisioning does not change minSdk, app behavior, dependency versions, package ID,
versionCode or versionName. Physical ARM64 runtime and Play Console/store rollout
requirements remain separate from signed-artifact verification.

### Signed AAB verification

The production upload-signed AAB at
`android/app/build/outputs/bundle/release/app-release.aab` passes cryptographic
verification of **all 1,394 payload entries** against the independently exported
upload certificate. Standard JDK `jarsigner -verify` also reports a verified JAR.
Negative checks reject a different expected certificate, a changed Hermes byte,
and a newly appended unsigned payload entry. The real artifact was not modified;
negative cases used disposable copies under ignored `.expo/`.

| Inspected signed-bundle property | Result |
| --- | --- |
| Application ID | `com.tripmemoryvault.app` |
| versionName / versionCode | `0.1.0` / `1` |
| minSdk / targetSdk | `24` / `36` |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64; 25 libraries each |
| Hermes | Compiled bytecode, 3,251,444 bytes |
| Permissions | ACCESS_NETWORK_STATE; package DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION only |
| Release flags | Non-debuggable, non-test-only; backup and cleartext disabled |
| Native alignment | 16 KiB minimum LOAD alignment on both 64-bit ABIs; bundle requests PAGE_ALIGNMENT_16K |
| Bundle structure | Official bundletool validation passed |
| Signed AAB SHA-256 | `B4B96E07654C2FE568C93CF763B721AAE29EDFCC0077C5E704A5AD57C89F9FE0` |

Evidence: `.expo/production-aab-verification.log`. TypeScript, test compilation and
all 168 Step 1–14/release tests pass again; evidence is
`.expo/production-signing-regression.log`. ACL checks confirm only the current
account and SYSTEM can access signing files. Ignore checks, no-overwrite behavior,
source/log scans for generated signing inputs and `git diff --check` pass.
The build wrapper also redacts signing inputs from provider diagnostics before
they reach console/log output. No commits, pushes or dependency upgrades.

The final combined signed `bundleRelease` / `assembleRelease` invocation completed
successfully in **5m 38s**, 879 tasks (77 executed, 802 up-to-date). Evidence:
`.expo/production-signed-retry.log`. An earlier combined invocation signed the AAB
but reported a generic APK packaging failure; the retry passed without replacing
the key, changing dependencies or removing caches. The first packaging failure's
cause was not established; it must not be described as a diagnosed code defect.

The signed AAB is 92,337,413 bytes. The companion
`android/app/build/outputs/apk/release/app-release.apk` passes `apksigner` verification
with APK Signature Scheme v2 and the same upload certificate, plus
`zipalign -c -P 16 4`. Scheme v3 is not enabled in this APK; no v3 pass is claimed.
Its package/version, four native ABIs and two manifest permissions also match.
APK SHA-256: `23F0EB4584CE8EA549A23597F01E8892CDED1D8E187C13BFDBE9A200D4B99C26`.
It was not installed over the emulator's differently signed existing vault.

**PASS — SIGNED RELEASE READY**, for the signed artifact and verification scope.
This supersedes the earlier missing-signing blocker. It is not a store rollout
approval: independent key/credential backup, physical ARM64 runtime verification,
Play App Signing enrollment/upload-certificate registration, production listing,
privacy declarations and the documented API 24–27 support disclosure remain.

## Physical ARM64 release verification — 2026-10-04

Scope: the existing production release on the connected physical phone. No product,
dependency, signing, minimum-SDK or application-code changes were needed. No emulator
was connected or substituted. No uninstall, vault reset, commit or push was performed.

### Device and installed artifact

| Property | Observed result |
| --- | --- |
| Physical device | Google Pixel 9, product/device `tokay`; emulator properties unset |
| Android / API | Android 16 / API 36 |
| Device ABI list / installed primary ABI | `arm64-v8a` / `arm64-v8a`; secondary ABI absent |
| Page size | 4,096 bytes; this is not a 16 KB ARM64 runtime test |
| Available `/data` storage before installation | Approximately 23 GB free of 109 GB |
| Installed APK | `android/app/build/outputs/apk/release/app-release.apk`, 155,883,819 bytes |
| Package / version | `com.tripmemoryvault.app`, `0.1.0` / `1` |
| APK SHA-256 | `23F0EB4584CE8EA549A23597F01E8892CDED1D8E187C13BFDBE9A200D4B99C26` |
| Companion AAB SHA-256 | `B4B96E07654C2FE568C93CF763B721AAE29EDFCC0077C5E704A5AD57C89F9FE0` |
| Upload certificate SHA-256 | `78D9362E5104B4ECFCAF7146443234DEFC4F9C900BE486CE5B717B0FBBFB0DF3` |

The APK and AAB hashes match the completed production build documented above.
`apksigner` verifies APK Signature Scheme v2 against the independently exported
upload certificate; `zipalign -c -P 16 4` passes. The embedded Hermes bundle and
all 25 ARM64 native libraries were individually hash-compared between APK and AAB:
all 26 payloads match. Manifest/package inspection confirms release flags, four
packaged ABIs, and only the two documented permissions; INTERNET is absent.
There was no existing installation or signing conflict. `adb install -r` succeeded.
No Metro listener, ADB reverse mapping, Expo Go, development client or localhost
JS serving was used. About reports version 0.1.0, build 1 and schema 10.

### Physical workflow results

| Check | Result |
| --- | --- |
| Trips / create / open / Trip Detail | PASS: saved and reopened `ARM64ReleaseVerification`, with unknown dates preserved |
| Timeline | PASS: created and reopened `ARM64SyntheticSection`, no dates invented |
| Places / Stops route | PASS: created synthetic `ARM64SyntheticPlace` at test coordinates 30.1, 77.1; saved Stop and route remain readable |
| Trip Map / Global My Map | PASS: native maps report ready, numbered markers render, pan and double-tap zoom visibly move the marker; local list remains available |
| Companions / Chapters / Dreams | PASS: production screens, inputs and empty states open |
| Travel Life | PASS: 1 saved Trip, 1 Place, 1 visit and 2 unique Photos; draft excluded |
| Search | PASS: local ARM64 query returns the test Trip, Place and timeline section |
| Settings | PASS: storage, maintenance, privacy, About and integrity results render |
| Reanimated / Worklets | PASS for existing navigation and interactions: native Worklets load succeeds; no native-runtime or navigation crash observed |
| System photo picker | PASS: selected only synthetic JPEG/PNG from a dedicated device folder; 2 selected, 2 archived, 0 failures |
| Derivatives / viewer | PASS: both thumbnails and oriented JPEG/transparent PNG display images render, including after offline process restarts |
| Reconstruction | PASS: deterministic flow runs on both photos; one pending timestamp-based section, one date-unknown photo; canonical dates and structure unchanged |
| ArchiveMedia integrity | PASS: SQLite/FKs healthy, known schema 10, 2 originals hash-verified, 4 healthy search documents, no interrupted imports |
| Archive export | PASS: native SAF folder selection, export and verification complete; independently verified sizes and SHA-256 for all 20 manifest-listed files |

The synthetic JPEG's EXIF timestamp and UTC offset survive picker import; the
system picker redacts GPS. Export preserves that received representation with
`source_fidelity=picker_representation`, null GPS and null corrections. The JPEG
export hash is `1bac88347e0290c19533c978b7ef8dacc7557c2b979a9e2e57352841daf78480`;
it is not claimed byte-identical to the pre-picker JPEG. The PNG original is
301 bytes and matches the repository fixture hash
`78a142d9b15903ad9ceb777925097f201e0a630d42246b13b9016392336661c8`.
Export reads the durable app-owned originals, not picker references. The separately
created user draft was preserved; no user photo library content was imported.

Export destination on the phone:
`Documents/TMV-ARM64-Verification/Trip-Memory-Vault-2026-10-03-1948fb94`.
The folder date is UTC. Local verification evidence is under ignored `.expo/arm64-*`,
including UI hierarchies/screenshots, process logs, export copy, payload comparison
and regression output. Test content and the export remain available for inspection.

### Offline, restart and crash audit

Four clean cold launches succeeded, including two after disabling Wi-Fi and mobile
data. Android reported `wifi_on=0`, active subscription `mobile_data1=0`, user mobile
data false and **no active default network**. The legacy unsuffixed `mobile_data`
setting stays 1 on this device; subscription state and connectivity establish the
actual offline condition. Trips, photos, timeline, route, search and Settings work
offline; both maps retain bundled overview, markers and lists without detailed
tiles. Both offline restarts reopen the database and pass the integrity audit;
media remains readable and schema 10 is stable. Wi-Fi and mobile data were restored
to enabled after verification.

App-session process logs and the timestamp-bounded crash buffer show no
AndroidRuntime FATAL EXCEPTION, ReactNativeJS fatal error, UnsatisfiedLinkError,
SIGSEGV, native loader failure, or MapLibre/Worklets/Reanimated/ArchiveMedia failure.
Hermes loads from the installed ARM64 APK and React Native runs `main`. Package exit
history contains only the three intentional force-stops, no crash or ANR. Routine
SoLoader/Bridgeless initialization, generated-setter fallback and predictive-back
warnings were not treated as crashes.

Regression: TypeScript, test compilation, all existing Step 1–14 and release tests
pass (**168 passed, zero failures/skips**); `git diff --check` passes. No ARM64-only
blocker was reproduced. API 24–27 behavior was not tested on this API 36 phone, and
minSdk remains 24. Physical 16 KB ARM64 and Play-delivered signing are outside this
device result. Owner key backup, Play enrollment, listing/privacy declarations and
the documented older-Android support disclosure remain separate rollout work.

**PASS — ARM64 RELEASE VERIFIED**
