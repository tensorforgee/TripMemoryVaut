# Google Play internal testing preparation — 22 October 2026

**PASS — PLAY INTERNAL RELEASE PREPARATION READY**

This verdict covers the audit and review package, not authorization to distribute
or proof of Play acceptance. Nothing was uploaded, published, committed or pushed.
Owner-operated distribution gates below remain open.

## Audited baseline

Read AGENTS.md, the authoritative architecture, release hardening, final release
QA, Android distribution compatibility, portable archive and routing documentation.
GitHub's commit API independently confirmed remote `main` at
`11d4337017268f48dc3ae86fa546543606c60812`, matching HEAD, local main and origin/main.
Work remains on `chore/play-internal-release`. Shell remote lookup failed DNS;
the connector supplied the fresh remote check. An existing unrelated untracked
file was left untouched. This change adds documentation only.

| Check | Result / remaining requirement |
| --- | --- |
| Identity | `com.tripmemoryvault.app`; app name Trip Memory Vault. Owner must confirm permanent package ownership in Console before first upload. |
| Version | `0.1.0`, code `1` in config and signed AAB. Console code availability is unknown; each subsequent upload needs an unused higher code. |
| SDK | Actual AAB min 24 / target 36; compile 36 in existing build evidence. No SDK change made. |
| Signing | AAB payload signature reverified against the independent local public upload certificate: 1,419 signed payload entries. No debug fallback. |
| Key custody | Ignored `.local-signing/upload.jks`, Windows CurrentUser DPAPI credentials and public certificate exist. Wrapper uses process environment and clears inputs. DPAPI is machine/account-bound protection, not a portable key backup. Owner must verify encrypted independent backup and recovery access. No key rotation or credential decryption performed. |
| Permissions | Exactly INTERNET, ACCESS_NETWORK_STATE, and `com.tripmemoryvault.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (signature protection). No broad photos, location, camera, microphone or contacts permission. |
| Release flags | No debug/test-only or dev launcher activity; cleartext and Android app backup disabled. SecureStore backup exclusions configured. |
| Native | Four ABIs, 25 libraries each; 64-bit LOAD alignment at least 16 KB; bundle requests PAGE_ALIGNMENT_16K. |

Signed candidate: `android/app/build/outputs/bundle/release/app-release.aab`

SHA-256: `ACA662AA29EFEE93369DAC18535F9AD6ADB02E44DF34A249E07691A953759CCE`

Companion APK SHA-256:
`C63B14633694F4DE69C0164D0DF1C79924FFC09BCE73117492A570A9D0879B3E`.
These match the prior distribution audit. The only change from that audit's
`1b91198` baseline to current main is compatibility documentation, so no full
packaging rebuild was warranted. Rebuild/reverify if executable configuration,
code, bundled environment, SDK baseline or version changes.

## minSdk 24 versus 28

**Recommend API 28 / Android 9 as the eventual supported Play baseline.**
The native `ArchiveMediaModule.kt` explicitly requires API 28 for ImageDecoder.
Import and preview regeneration therefore fail on API 24–27; restored archives
can also need regenerated previews. Supporting installation while denying the
central photo workflow is poor UX. API 28 removes this known mismatch, although
HEIC behavior and memory limits still require device testing.

API 24 preserves installation on Android 7–8.1 for manual/local workflows, but
those versions are unverified and cannot offer full photo functionality. ORS is
an explicit HTTPS coordinate request; it has no demonstrated API-28-specific
requirement. Raising the floor does not fix provider quotas, connectivity or
route accuracy. There is no measured user-device population here from which to
invent a compatibility percentage or performance benefit.

Keep current minSdk 24 unchanged for this bounded preparation, consistent with
the merged compatibility decision. Invite only Android 9+ testers and explicitly
disclose the limitation; this is a tester constraint, not an enforced manifest
restriction. Before broader distribution, adopt 28 in a scoped build change
(including the verifier's SDK assertion), then test API 28 import/restore and a
current Android device. Alternatively implement and validate a decoder fallback
before promising API 24–27 support. Do not silently ship an SDK change under this
already verified artifact hash.

## Focused verification

- TypeScript application and test compilation passed.
- Release config, signature, credential, settings and road-route suites: 48
  tests passed together in the final focused run (`.expo/play-focused-tests.log`). Initial JAR-fixture creation failed with
  default Java temp access; the same signature suite passed with workspace-local
  `java.io.tmpdir`. No production workaround or test suppression added.
- Existing signed AAB reverified: bundletool validation, trusted signer, identity,
  exact permissions, release flags, Hermes (3,377,320 bytes), all ABI libraries
  and 16 KB alignment passed.
- Bounded scan: 240 tracked files; only two deliberately fake JWT fixtures matched
  token patterns. Decompressed all 1,422 AAB and 1,365 APK ZIP entries: zero
  private-key/JWT/common cloud-key pattern hits, secret-file entries, or embedded
  copies of the actual upload-keystore bytes. MapTiler's public mobile token is
  expected to be extractable; restrict/monitor it in the provider dashboard.
  This is not an exhaustive proof against every possible secret encoding or a
  full Git-history audit. No credentials were printed or rotated.
- Live ORS editor has no repository confirmation/save path; proposals are in
  RouteProposalSession memory, discarded on teardown. Tests verify preview
  generation writes no road rows and cancellation rejects late results. Existing
  saved/imported routes remain supported by the archive; that does not enable
  persistence of new live responses. Do not reconnect confirmation until provider
  retention/export terms are clarified.
- Prior evidence, not newly repeated: Android 15 ARM64/4 KB physical runtime;
  Android 17 API 37 x86_64/16 KB emulator import, restore and offline tests;
  full K1 release lint 0 errors / 27 warnings. Android 16 itself, API 28 hardware,
  physical ARM64/16 KB and Play-delivered splits remain untested.

Reproduce without rebuilding (JDK 17 and normal pnpm setup):

```powershell
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.gradle/jdks/eclipse_adoptium-17-amd64-windows.2'
$env:Path = "$env:JAVA_HOME/bin;$env:Path"
$env:JAVA_TOOL_OPTIONS = '-Djava.io.tmpdir=C:/dev/tripmemoryvault/.expo'
pnpm typecheck
pnpm exec tsc -p tsconfig.tests.json
node --test tests/release/config.test.mjs tests/release/artifact.test.mjs tests/routing-credentials/*.test.mjs tests/step14/*.test.mjs tests/step7/road-routes.test.mjs
$cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path .local-signing/upload-certificate.cer))
./scripts/verify-android-bundle.ps1 -Bundletool .expo/bundletool-all-1.18.1.jar -ExpectedCertificateSha256 $cert.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256)
```

The local bounded scanner is retained at ignored `.expo/play-secret-audit.mjs`,
with results in `.expo/play-secret-audit.jsonl`;
it prints only categories, counts, filenames and hashes. It reads the local
keystore bytes for equality detection without opening/decrypting the key.

## Owner-operated Console runbook — do not execute during this task

1. Verify developer identity/account setup, authorized Console role, recovery
   access and any device-verification prompts. Record account type. New personal
   accounts may have separate closed-test requirements before production;
   internal testing does not satisfy those by itself.
2. In Play Console, select the existing app for the package, or **Create app**.
   Choose the approved name, default language, App, and intended free/paid status;
   accept applicable declarations. Confirm package identity before uploading.
3. Review [listing draft](play-store-listing-draft.md),
   [data inventory](play-data-inventory.md) and
   [privacy draft](privacy-policy-draft.md). Supply actual developer identity,
   support/privacy email, policy URL and effective date. Host the reviewed policy
   publicly over HTTPS; add an accessible in-app policy link in a follow-up.
   Do not publish placeholders. Approve branding and synthetic screenshots.
4. Open **Test and release → Testing → Internal testing → Testers**. Create/select
   an email list or Google Group, add up to 100 intended testers, set the feedback
   email/URL and save. Use Google accounts and communicate Android 9+ constraints.
5. Under **Internal testing → Releases**, choose **Create new release**. Set up
   Play App Signing when prompted, normally with a Google-managed app signing
   key distinct from the upload key. Compare the upload certificate to the trusted
   local public certificate. Record both certificate fingerprints privately.
6. Only after separate authorization to upload: recheck candidate SHA-256, then
   select the signed AAB above. Confirm code 1 is unused. If rejected as already
   used, increment configuration in a scoped change, rebuild/sign and reverify;
   never relabel the existing artifact or use an unsigned/test-harness APK.
7. Inspect App Bundle Explorer/release checks: package, version, target SDK,
   supported devices, permissions, 64-bit/16 KB status and app-signing setup.
   Resolve errors; document any accepted warning. Enter the draft release notes.
8. Complete applicable Dashboard/App content prompts truthfully: app access (no
   app account; personal ORS key only for optional routing), ads (none implemented),
   content rating, target audience, privacy and any other Console declarations.
   Do not guess audience/rating or account-specific requirements. Internal-only
   apps are exempt from the Data safety form; retain the inventory and complete
   the form before closed/open/production distribution as applicable.
9. Review the track and recipients, then **Save/Review release → Start rollout to
   internal testing** only when authorized. This distributes the app; it is not
   part of this preparation. Never choose production rollout or Internal app
   sharing as a substitute. Console labels may vary; confirm track at each step.
10. Copy the opt-in link from Testers and send it only when authorized. Testers
    opt in with the listed account, then install through Google Play. Record the
    delivered version/signing identity. A locally upload-signed install may not
    update with Play's app signing key: use a spare profile/device and verified
    export, never uninstall a valuable vault merely to bypass signature mismatch.
11. Test Play-delivered cold launch without Metro, selected-photo import, unknown
    metadata, manual stops/pins, offline reopen, export/checksum/restore, MapTiler
    fallback, ORS consent/key clearing and session-only previews after restart.
    Use synthetic content. Check available pre-launch reports/crashes and tester
    feedback; test an update before expanding distribution.

## Remaining manual gates

Console account/package ownership, unused code, signing enrollment and key-backup
recovery; provider plan/token restrictions and applicable terms; approved policy
identity/contact/hosting/in-app access; branding/screenshots, audience/rating and
Console declarations; tester list/feedback channel; Play upload acceptance and
delivered-device tests. These are explicitly unverified, not claimed completed.
ORS permanent retention/export remains disabled pending clarification. Existing
API-24 manifest must not be advertised as full Android-7 photo support.

Official guidance checked 22 October 2026:
[internal testing](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en),
[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en),
[API targeting](https://developer.android.com/google/play/requirements/target-sdk),
[16 KB compatibility](https://developer.android.com/guide/practices/page-sizes),
[app signing](https://developer.android.com/studio/publish/app-signing).
Target API 36 meets the current new-app requirement; an artifact check cannot
guarantee Console acceptance.

READY FOR NEXT STEP
