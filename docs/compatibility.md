# Step 0 compatibility record

Detected on Windows, 26 September 2026. `architecture.md` is authoritative.
This step implements only the requested project foundation, SQLite smoke test,
and MapLibre screen. The architecture's broader media feasibility spike is deferred.

**Status: requested Step 0 build, SQLite, and MapLibre emulator checks passed.**
This is an x86_64 development-build smoke proof, not the architecture's broader
physical-device media/HEIC/memory or production offline-map acceptance gate.

## Relocated verification — 27 September 2026

- Project root verified as `C:\dev\tripmemoryvault`, outside OneDrive and not a
  junction. Copied `node_modules` junctions still targeted the old OneDrive tree;
  reinstalling with `pnpm install --frozen-lockfile` corrected them.
- Prior logs confirmed JDK 25 Prefab/CMake failure and JDK 17 generated-output
  deletion denial. All retries here used Temurin JDK **17.0.20.1**. No package
  version, peer override, or lockfile change was needed.
- Fresh builds exposed Ninja 1.10.2's Windows path problem: `build.ninja` remained
  dirty after 100 retries. `ninja -n -d explain` treated existing Prefab config
  files as missing. Screens' config path was 254 characters; shortening package
  directories alone left Reanimated's Worklets config-version path at 255.
- `pnpm-workspace.yaml` now uses `virtualStoreDir: .pnpm` and
  `virtualStoreDirMaxLength: 32`; `.pnpm/` is ignored. Both settings were needed
  to shorten native paths sufficiently. See [pnpm virtual-store settings](https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-10.x/settings.md#virtualstoredir).
- Stopped build processes and moved generated Android build/Gradle/CMake outputs
  and replaced dependency trees into ignored `.expo/step0-*` directories before
  regenerating them. Source, architecture, agent instructions, and intentional
  native configuration were preserved. Old diagnostic logs remain available.
- **Android build: PASS.** `:app:assembleDebug` completed in 12m 26s, with 477
  tasks executed. APK: `android/app/build/outputs/apk/debug/app-debug.apk`
  (104,230,233 bytes). This attempt targeted x86_64 only.
- **Android runtime: PASS.** Installed and cold-launched on `Pixel_8`,
  `emulator-5554`, Android 17/API 37, x86_64, 16 KiB pages. The existing emulator
  initially had a frozen guest clock/system-process failure and returned package
  service `Broken pipe`; cold-starting the same AVD without loading a snapshot
  restored installation. No AVD data was wiped.
- Metro's localhost mode bound to IPv6 while advertising IPv4. The working
  session uses `--lan`, `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1`, and
  `adb reverse tcp:8081 tcp:8081`. Bundle fetch returned HTTP 200.
- **SQLite runtime: PASS.** Home displayed `SQLite passed: database opened,
  SELECT 1 returned 1.` Repeated successfully after force-stop/cold launch with
  emulator Wi-Fi and mobile data disabled. Metro remained reachable through adb.
- **MapLibre runtime: PASS.** The original demo URL timed out from both host and
  emulator. The disposable screen now uses a local style with a synthetic
  triangle, explicitly labeled as test geometry, with no remote resources.
  `onDidFinishRenderingMapFully` fired, the triangle was visibly rendered, and
  pan/double-tap zoom changed its position/size. It rendered again with Wi-Fi and
  mobile data disabled. Returned Home successfully; networking was restored.
- Final app-process logs showed no fatal exception, JavaScript error, native
  linking error, or map-style failure. `pnpm run typecheck` passed after the
  smoke-screen change. Expo's automatic tsconfig rewrite was restored exactly.
- Evidence is local/ignored: `.expo/step0-android-root-store-jdk17.log`,
  `.expo/step0-runtime-final.log`, `.expo/step0-runtime-offline.log`, and
  `.expo/step0-{home,map,map-pan-zoom,offline-home,offline-map}*.{png,xml}`.
- No blockers remain for the requested smoke-verification scope. Online demo
  tiles, other ABIs, physical-device media tests, and production map behavior
  are not certified by these results. No Step 1 work, commit, or push was done.

Reproduce the successful native build from the project root:

```powershell
$env:JAVA_HOME = 'C:\Users\rohit\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:NODE_ENV = 'development'
pnpm install --frozen-lockfile
.\android\gradlew.bat -p android :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-watch-fs --parallel --max-workers=4 --stacktrace --console=plain
```

For the tested Metro connection, run `adb reverse tcp:8081 tcp:8081`, set
`REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1` and `EXPO_NO_TYPESCRIPT_SETUP=1`, then
run `pnpm exec expo start --dev-client --lan --port 8081 --max-workers 2`.
The TypeScript flag avoids Expo rewriting the existing include configuration;
it does not replace the explicit typecheck above.

## Earlier verification retry — 27 September 2026

- Detected Android Studio JBR/JDK 25.0.3 and the Android SDK via the Windows user
  environment (the existing terminal environment had not inherited them).
- Gradle downloaded Temurin JDK 17.0.20.1, NDK 27.1.12297006, and SDK Platform 36.
  Build Tools 36.0.0 was already installed.
- Pixel_8 became available as `emulator-5554`; boot completed, Android 17/API 37,
  x86_64, 16,384-byte memory pages. Metro started successfully on localhost:8081.
- `pnpm run typecheck` and `pnpm exec expo install --check` passed.
- `:app:assembleDebug` under JDK 25 failed in Screens/Worklets CMake configuration:
  Prefab emitted `WARNING: A restricted method in java.lang.System has been called`.
- Retried with JDK 17 and `-PreactNativeArchitectures=x86_64`. Gradle failed cleaning
  generated plugin outputs with `java.nio.file.AccessDeniedException`. The affected
  directory ACL includes `Everyone Deny DeleteSubdirectoriesAndFiles`. Stopping the
  previous daemon and retrying with filesystem watching disabled did not resolve it.
  Security permissions were not changed.
- No debug APK was produced. App launch, SQLite execution, and MapLibre rendering
  remain **unverified**, despite the emulator being available. No application-code
  defects were established or fixed. Step 1 has not been started.

Use JDK 17 for the next attempt, and resolve the filesystem delete-denial on generated
build outputs before retrying. JDK selection guidance:
[Android build JDK documentation](https://developer.android.com/build/jdks).
Detailed attempt logs are local ignored files in `.expo/step0-android-*.log`.
The earlier environment notes below describe the initial verification, not the
now-detected tooling.

## Pinned versions

| Component | Detected version |
| --- | --- |
| Node | 24.19.0 |
| Package manager | pnpm 11.19.0 |
| Expo SDK / package | 57 / 57.0.25 |
| React Native | 0.86.3 |
| React | 19.2.3 |
| TypeScript / React types | 6.0.3 / 19.2.4 |
| Expo Router | 57.0.23 |
| Expo development client | 57.0.19 |
| Expo SQLite | 57.0.3 |
| MapLibre React Native | 11.4.0 |
| MapLibre Native Android | 13.6.1, default OpenGL variant |
| Safe area context / screens | 5.7.0 / 4.26.2 |
| Expo constants / linking / status bar | 57.0.19 / 57.0.11 / 57.0.1 |

Direct dependencies are exact versions in `package.json`; `pnpm-lock.yaml` pins
the resolved dependency tree. Expo's installed `bundledNativeModules.json` supplied
the SDK-compatible versions. The app was initialized directly in this directory,
which initially contained only `AGENTS.md` and `docs/architecture.md`.

pnpm automatically installed Router's transitive peers. Initial resolution chose
newer native peers outside this SDK's supported versions. `pnpm-workspace.yaml`
pins Gesture Handler 2.32.0, Reanimated 4.5.1, Worklets 0.10.1, React Native Metro
config 0.86.3, and React DOM 19.2.3. These support the dependency tree; the app adds
no animation framework usage, web target, state store, or UI library of its own.
`pnpm peers check` reports no issues after these pins.

## App and native configuration

- `expo-router/entry`; a stack with Home and MapLibre test routes.
- TypeScript `strict: true`, extending Expo's base configuration.
- Android-only target; application ID `com.tripmemoryvault.app`, scheme
  `tripmemoryvault`. Local development builds use `expo-dev-client`; no Expo Go.
- Config plugins: development client, Router, status bar, SQLite, and MapLibre.
- Expo prebuild generates `android/`; generated native/build output is ignored.
  Change native configuration in `app.json`, then rebuild. No custom native files.
- Generated Gradle settings enable New Architecture, Hermes, AndroidX, and
  edge-to-edge. MapLibre v11 requires New Architecture.
- OS application backup is disabled. Location and broad external-storage
  permissions are blocked; prebuild emits their manifest removal directives.
  Internet access is used for the demo map and development server.
- No EAS account, remote build, backend, credentials, or cloud sync is configured.

Native versions below were read from generated files and installed version
catalogs; Gradle could not run to resolve/compile them:

| Android setting | Configured value |
| --- | --- |
| Minimum SDK | 24 (Android 7) |
| Compile / target SDK | 36 / 36 |
| Build Tools | 36.0.0 |
| NDK | 27.1.12297006 |
| Kotlin | 2.1.20 |
| Android Gradle Plugin (RN catalog) | 8.12.0 |
| Gradle wrapper | 9.3.1 |

Expo's Gradle plugin reads the React Native version catalog. MapLibre's own
fallback properties specify minimum SDK 24 and Native Android 13.6.1; application
SDK settings take precedence. Do not override native versions without rebuilding
and testing. iOS has not been configured or tested.

## Smoke tests

- Home opens a fresh in-memory SQLite database, executes `SELECT 1 AS value`,
  verifies the result is exactly 1, and closes the connection in `finally`.
  Success is shown only after the operation completes. No persistent schema,
  migrations, or vault data are created.
- MapLibre uses an inline style and synthetic triangle with no remote tiles,
  glyphs, sprites, or keys. Native full-rendering and load-failure events update
  the status; attribution controls retain their defaults. It is a disposable
  renderer test, not the production offline map or travel-history data.

## Earlier validation performed

| Command / check | Result |
| --- | --- |
| `pnpm install` | Passed |
| `pnpm exec expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar expo-dev-client expo-sqlite @maplibre/maplibre-react-native --pnpm` | Passed; versions subsequently pinned |
| `pnpm add --save-dev --save-exact @types/react@19.2.4` | Corrected Doctor's React-types mismatch |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm run typecheck` | Passed |
| `pnpm exec expo config --type public` | Passed |
| `pnpm exec expo install --check` | Dependencies up to date |
| `pnpm peers check` | No peer issues |
| `pnpm --package=npm@12.1.0 --package=expo-doctor@1.20.4 dlx expo-doctor` | 21/21 passed |
| `pnpm exec expo prebuild --platform android --no-install` | Passed, including permission configuration |
| `pnpm exec expo-modules-autolinking react-native-config --platform android` | MapLibre Android package and Fabric components discovered |
| `pnpm exec expo-modules-autolinking resolve --platform android --json` | SQLite and development client discovered |
| `pnpm exec expo export --platform android` | Passed: 1,344 modules, Hermes bundle generated in ignored `dist/` |
| `./android/gradlew.bat -p android :app:assembleDebug` | Blocked: `JAVA_HOME` unset and no `java` on PATH |
| SQLite / MapLibre on Android | Not run; no runtime success claimed |

The initial plain `pnpm dlx expo-doctor` could not execute its npm-based checks
because npm is absent from PATH. The successful command above supplies npm only
inside a temporary tool environment, without adding it to the project or changing
the system installation. Installation also reported deprecated transitive
`uuid@7.0.3`; it did not prevent validation.

No JDK, Android Studio, Android SDK, adb, or emulator was detected in PATH or the
standard installation locations; `JAVA_HOME`, `ANDROID_HOME`, and
`ANDROID_SDK_ROOT` were unset. No device could be enumerated without adb. Configure
a compatible JDK and the Android SDK/build tools before attempting the native
build. Node and pnpm here come from the Codex runtime; an ordinary terminal also
needs those tools on PATH.

## General development commands

From the project root, with Android tooling available and an emulator running or
a physical Android device connected with USB debugging:

```powershell
pnpm install --frozen-lockfile
pnpm android
```

`pnpm android` runs `expo run:android`: builds and installs the debug development
client and starts Metro. For subsequent JavaScript-only sessions with that client
already installed:

```powershell
pnpm start
```

Home displays the SQLite success result; the MapLibre test renders the synthetic
triangle and supports pan/zoom, then navigation returns Home. Both checks passed
with emulator internet disabled as recorded above. Physical-device and broader
media feasibility tests remain separate. This directory had no Git repository
at inspection.

References: [Expo Router installation](https://docs.expo.dev/router/installation/),
[MapLibre Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/),
[MapLibre requirements and demo style](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/).
