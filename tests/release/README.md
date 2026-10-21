# Release QA reproduction

Run from the repository root using the JDK 17 environment in
`docs/release-hardening.md`.

```powershell
pnpm typecheck
pnpm exec tsc -p tsconfig.tests.json
node --test 'tests/**/*.test.mjs'
pnpm exec tsc --noEmit -p tests/release/tsconfig.native.json
```

The native audit is deliberately separate from the production app. It creates
only uniquely named synthetic databases and media, exercises migration rollback,
imports a generated PNG, edits/removes pins, and restores v1/v2/v3 archives into
empty disposable databases. It never resets a vault.

```powershell
$env:NODE_ENV = 'production'
$env:EXPO_NO_DOTENV = '1'
./android/gradlew.bat -p android :app:assembleRelease `
  -I "$PWD/tests/release/native-audit.gradle" -PtmvUnsignedRelease=true `
  --no-daemon --no-watch-fs --no-parallel --max-workers=1 --console=plain
```

Preserve production APK/AAB outputs first. Sign a separate test APK with the
public Android debug key; verify with `aapt` that its package is exactly
`com.tripmemoryvault.finalqa` before installing. Do not replace an existing
installation without establishing that it is disposable.

Launch `com.tripmemoryvault.finalqa/com.tripmemoryvault.app.MainActivity`.
Expect `FINAL_QA PASS suite` in app-scoped logcat. After force-stop, use
`am start -a android.intent.action.VIEW` with the same explicit component and
`-d 'tripmemoryvault://finalqa?mode=reopen'`. Expect `FINAL_QA PASS reopen`.
Use both radios disabled for the offline check, restoring their prior states
afterward. Omitting `ACTION_VIEW` runs another suite instead of the reopen audit.

This tests native services; normal UI, system pickers, and live provider checks
require separate device interactions. Add `-PtmvQaUi=true` to the isolated build
to use the normal application UI with the same disposable application ID. Its
default vault is separate from the native audit's uniquely named databases.
Never use a production package for destructive restore preparation.
Rebuild normally afterward so standard
release output directories contain production artifacts, not the disposable APK.

The 20–21 October audit also used this UI variant to create a synthetic trip,
stay and undated section, import two repository JPEG fixtures through Android's
photo picker, and export through the system folder picker. Every manifest file
size and SHA-256 checksum was verified before resetting only the disposable
package. Restore through the folder picker preserved the trip, stay, section and
both photos. Retry preview regenerated the omitted derivatives; a cold launch
with Wi-Fi and mobile data disabled retained the trip and viewable photos.
Both radios were restored and the disposable package removed afterward.
The synthetic export remains in `Download/TMV-Final-QA-Exports` on the phone;
its local copy and UI evidence are under `.expo/final-release-qa/`.
