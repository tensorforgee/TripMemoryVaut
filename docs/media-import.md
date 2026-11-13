# Step 5: durable media import

`architecture.md` remains authoritative. No reconstruction or cloud functionality
is included. Media identifies received bytes; TripMedia is an independently
removable trip placement. Migration 4 adds just Media, TripMedia and the three
operational import/file tables. It uses the existing snapshot/checksummed migration
runner. Migration 5 adds live-parent guards and preserves photo context during
aggregate trip trash. Migration 4 had already been applied by the running
development client, so its original checksum is retained and the correction is
forward-only. Earlier migration SQL and the database ledger are unchanged.

## Format and native boundary

JPEG, still PNG (including transparency), and device-decodable HEIC/HEIF are supported. Content signatures,
PNG animation chunks, decoder success, encoded size (100 MiB) and dimensions
(100 megapixels) are checked. GIF, WebP, AVIF, RAW/DNG and video are rejected
explicitly. See the HEIC extension below for device limits. Motion/Live Photo
archival is not supported.

Android 9/API 28 or newer is currently required for import: ImageDecoder provides
bounded sizing, orientation and sRGB conversion. Older Android versions receive
an explicit error, never a false archival success. iOS TODO: implement the same
interface with ImageIO, scoped selection, durable publishing and equivalent device
tests before enabling iOS. No broad library, camera or location permission is used.

The platform-neutral MediaFiles interface is implemented by a small local Expo
module. It streams 64 KiB buffers for copy/hash off the JS/UI thread, syncs writes,
probes/decodes at bounded size and uses AndroidX ExifInterface. No image base64 or
whole-file JS buffers are used. Expo filesystem resolves app-document paths and
handles safe staging cleanup. The native module must be rebuilt into the development
client; Expo Go is unsupported.

Expo ImagePicker with quality=1, editing/base64/EXIF disabled uses its Android
RawImageExporter. The picker first returns a temporary selected representation;
its internal acquisition may precede our journal. Immediately after the result,
all batch/items are persisted before app-owned staging or processing. Picker
cache is never an archived asset. Fidelity is conservatively
`picker_representation`, not a claim of camera-original access. Source grants/cache
can expire; such items require reselection. The existing completed imports survive.

Parser v1 preserves selected ExifInterface-exposed fields (capture, offset, orientation,
dimensions, camera/color and GPS fields) and normalized capture/GPS when valid.
Invalid fields produce warnings and remain in raw evidence. Missing capture/GPS
stay null; device time/zone and filesystem times are never substituted. IPTC and
unparsed EXIF remain preserved in the immutable original bytes. ExifInterface may
normalize or supply defaults for ancillary fields; this parsed evidence is not a
byte-for-byte EXIF directory dump. The original bytes remain authoritative. SQL rejects
updates of imported evidence; future corrections have separate nullable columns.

## Files and recovery

Paths below are relative to `Paths.document/vaults/<vault UUID>/`:

```
media/originals/<hash prefix>/<sha256>.jpg|png|heic|heif
media/display/v1/<hash prefix>/<sha256>.jpg|png
media/thumbnails/v1/<hash prefix>/<sha256>.jpg|png
staging/<item UUID>.part
```

Originals are durable app-private documents, always pinned. Filenames are metadata
only. Originals are never recompressed, replaced, evicted or garbage-collected by
this step. Previews use 2048/320 pixel maximum long edges, retain aspect ratio,
apply orientation, convert to sRGB, and preserve PNG transparency. Preview rows
record dimensions, checksum and recipe version. They omit source EXIF/GPS.

The state machine is `selected → copying → staged → verified → archived`.
Recoverable errors lead to `failed` or `retry_required`; unsupported content leads
to `unsupported`. SQL constrains state transitions. Every item is independent.

- `copying`: a killed copy may be partial, even if decodable. Reacquire into the
  same staging path. Expired source becomes an actionable reselection request.
- `staged`: revalidate/hash/parse the completed file.
- `verified`: the journal already contains evidence and the deterministic final
  path. Publish by same-volume rename, verifying a pre-existing destination by
  size/hash. Never overwrite conflicting bytes.
- Only after publication, one SQLite transaction creates/reuses Media, records
  original availability, creates/reuses TripMedia and marks the item archived.
  There is deliberately **no claim of filesystem/SQLite atomicity**.
- A kill after rename but before commit leaves a journal-owned final file. Retry
  verifies/reuses it without requiring the source URI or duplicating bytes.
- A kill after commit leaves a valid original. Missing/failed derivatives are
  regenerated independently. Completed source URIs are cleared; safe staging
  leftovers can be removed without touching originals.
- The foreground worker resumes pending jobs and unfinished derivatives after
  startup; explicit Retry also retries failures. File existence is checked for
  each visible gallery page (at most 60 assets), avoiding a startup scan of the
  completed archive. Explicit Retry can reconcile all local files. Missing originals get explicit availability and
  retry-required status, never a fabricated success. This is existence reconciliation,
  not a full checksum scrub of every previously archived asset at startup.

One serialized worker bounds decode concurrency and keeps batch selection order.
Exact SHA-256 identity is unique per vault, including trashed assets. Duplicate
imports reuse/restore Media; an active same-trip placement reports “Already added”.
Different trips share the asset. Similar images with different bytes remain distinct.

Removing a placement tombstones TripMedia only. Trip trash marks only its live
placements and restores only those markers. Originals and shared Media survive.
There is no permanent GC. Gallery queries exclude deleted parents, use stable
`(position,id)` ordering and 60-row keyset pages. Grid/viewer use derivatives only.

## Verification

Host: real SQLite and real filesystem integration tests, with an explicitly fake
native decoder boundary, cover migration, validation, JPEG/PNG archival,
metadata preservation, hash/placement deduplication, transitions, copy/rename
interruption, derivative failure, placement deletion, isolation, ordering and
reopen persistence. Run `pnpm test:step5`; Steps 1–4 remain regression gates.

`tests/fixtures/media` contains generated rectangles and deterministic synthetic
EXIF/GPS/PNG metadata. `generate.mjs` regenerates derived fixtures and manifests;
there are no personal photos. The development-only `/media-test` route runs the
actual native decoder/hash/parser against that corpus in a separate synthetic DB.

Build/check results: TypeScript passes; 76 host tests across Steps 1–5 pass,
including forward migration from the already-applied v4 checksum with media,
import jobs and original files preserved.
Expo dependency compatibility and module autolinking pass. The merged Android
manifest has no camera, microphone, location or broad media-library permissions.
The x86_64 Android development APK builds with JDK 17. On this 8 GiB Windows host,
packaging exceeded the default 2 GiB Java heap; the successful build used
`--max-workers=1 -Dorg.gradle.jvmargs="-Xmx4096m -XX:MaxMetaspaceSize=512m"`.
This is a build-process setting, not an app runtime heap change.

Android runtime verification performed on 29 September 2026: Pixel_8 emulator,
Android 17/API 37.2, x86_64, 16 KiB pages. All 17 native harness checks passed:
JPEG/PNG and synthetic capture/GPS, absent metadata, original hashes, six bounded
derivatives, EXIF rotation, explicit APNG/GIF rejection, truncated JPEG failure,
duplicate reuse, post-publish recovery, shared placement removal and DB reopen.

The interactive system picker imported the synthetic JPEG and PNG into an existing
trip. Three archived import items (including a repeated JPEG) produced exactly two
Media assets, two placements and two originals; the UI reported “Already added”.
After force-stop and relaunch with Wi-Fi and mobile data disabled, both thumbnails
and the display-based viewer rendered. This development build fetched its JS via
local ADB/Metro; media and archive data required no network service. This is not a
standalone release-build offline-launch test.

A separate real process-death test stopped after original publication and before
the SQL commit. Inspection of the stopped app's DB/WAL pair confirmed `verified`
with no Media/TripMedia/local-file rows. Normal startup recovered that journal,
reused the one original and generated both previews. Removing the JPEG placement
through the viewer left one live placement, retained both assets/originals, and
kept all six local-file rows consistent with actual file sizes. Both original
SHA-256 values matched the deterministic corpus. SQLite integrity remained `ok`.

The development client initially refused an edited applied migration; the
forward-only v5 repair above resolved it without resetting data. The test route
uses the existing custom header after a Fabric mounting crash with its default
native header; subsequent navigation, viewer and restart checks passed. Emulator
System UI ANRs and a 4 GiB enforced emulator allocation on the 8 GiB host required
a cold boot and temporarily reduced resolution. No application dependency version
was changed to work around those environmental issues. Physical devices, iOS and
HEIC remain unverified.

Implementation references: [Expo picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/),
[Android ImageDecoder](https://developer.android.com/reference/android/graphics/ImageDecoder),
[AndroidX ExifInterface](https://developer.android.com/reference/androidx/exifinterface/media/ExifInterface).

## HEIC/HEIF extension — 12 November 2026

The audit found format gates in the native signature reader, Media validation,
SQLite migration 4, media path validation, maintenance file classification and
portable restore. Existing Expo ImagePicker 57.0.20 uses RawImageExporter at
quality=1 with editing disabled. The platform photo picker filters image media;
the additional “Add photos from files” action uses existing Expo FileSystem's
ACTION_OPEN_DOCUMENT path, image/* filter and scoped grants. Display names come
from OpenableColumns, not content URI identifiers. No dependency added.

The native reader bounds ISO-BMFF box sizes, checks still HEVC/HEIF brands and
requires metadata/data boxes, then validates a bounded ImageDecoder decode.
Sequences and AVIF remain unsupported. A filename, extension or provider MIME
alone cannot admit a file. HEVC-branded bytes get canonical .heic storage;
generic mif1 files that decode get .heif. The received filename remains separate.
Both .heic and .heif input names work regardless of capitalization.

Originals are streamed and SHA-256 checked as before, never converted. The only
conversion is a derived sRGB JPEG at 2048/320 maximum edges. Existing viewers,
gallery, memory attachments and pins already read these two shared derivatives.
Successful registered previews are reused. Failed previews retain the original
and remain retryable. No extra per-attachment image copy is made.

ExifInterface 1.4.1 parses the original HEIF bytes through the same immutable
metadata contract: available dates, offsets, GPS, orientation and raw supported
fields; absent values stay null. Unparsed metadata remains in original bytes.
Corrections and reconstruction are unchanged; GPS does not confirm any visit.
Source fidelity remains picker_representation because providers may redact or
supply representations before our copy. No camera-original guarantee is added.

Migration 14 rebuilds only Media's format constraint, preserving all indexes,
guards, rows and references. The serialized migration runner takes its usual
snapshot, disables foreign keys outside BEGIN for this rebuild, checks integrity
and all foreign keys before commit, and restores enforcement in finally. Applied
migration SQL/checksums 1–13 are unchanged. Host tests verify populated references,
triggers, evidence, rollback and enforcement.

Platform decoder support is required for initial import. If ImageDecoder cannot
decode a profile, importing fails explicitly; no available dependency can generate
a local preview without decoding the HEIC first. There is no remote conversion
or bundled software codec fallback. HDR/10-/12-bit, auxiliary images, HEIF alpha,
Live Photo motion and iOS are not promised. The primary still is previewed; all
received container bytes are preserved. See [Android format support](https://developer.android.com/media/platform/supported-formats).

Portable writer stays v4; schema 14 extends allowed MIME/extension pairs only.
Original .original package entries still use application/octet-stream and exact
checksums. Readers accept v1/v2/v3 and v4 schema 13/14. Older app versions reject
schema 14 rather than silently dropping the format. Derivatives regenerate after
restore. No archive layout or format migration is required.

Reproducible Android harness: tests/heic/audit.gradle and entry.tsx build a separate
com.tripmemoryvault.heicaudit package. Verify that package ID before installing.
The native suite uses unique disposable databases and never opens vault.sqlite.
Put the pillow-heif tests/images/heif_other/pug.heic fixture in files/heic-corpus/example.heic
using run-as. Source: https://github.com/bigcat88/pillow_heif/blob/master/tests/images/heif_other/pug.heic
SHA-256: 1ddce96766efbfa0f6bdf634bdab26bdeff831393df8d67f4cdc7b7a7afebc67.
The fixture is downloaded only into ignored .expo/heic-audit; it is not a JPEG
renamed as HEIC. Build with the documented JDK 17, EXPO_NO_DOTENV=1,
NODE_ENV=production, :app:assembleRelease -I tests/heic/audit.gradle
-PtmvUnsignedRelease=true -PreactNativeArchitectures=arm64-v8a. Sign a separate
copy using the public development key. Do not uninstall or clear the real app.

Additional compatibility probe: pillow-heif
[tests/images/heif_other/L_exif_xmp_iptc.heic](https://github.com/bigcat88/pillow_heif/blob/master/tests/images/heif_other/L_exif_xmp_iptc.heic),
downloaded into ignored .expo/heic-audit/metadata.heic and installed as
files/heic-corpus/metadata.heic. SHA-256:
0083645511ffdee8acf04973237272678d3eb2554d77bde2adeeca102c220d51.
This grayscale HEIC failed Android decoding with `getPixels ... invalid input`;
it is not part of the successful-device matrix. Native IO decode failures now
map to HEIC_DECODE_FAILED, keeping the error explicit. Metadata verification uses
the supported iPhone 13 Pro pug fixture instead: EXIF 2023:02:21 14:33:08, +03:00,
orientation 1 and present GPS. These are fixture facts, not user photo guesses.
The earlier libheif example.heic probe advertises the hevc sequence brand and is
rejected by the deliberately conservative still-only brand gate.

### HEIC verification results — 12–13 November 2026

Device b0883334 (OPD2514, Android 17, ARM64), isolated package
com.tripmemoryvault.heicaudit. The normal com.tripmemoryvault.app version/install
and update times were unchanged. No app was uninstalled or cleared; archive
restores used new empty test databases only.

The actual iPhone 13 Pro HEIC fixture imported with .heic and .HEIF names, reused
one SHA-256 original and two JPEG previews, retained original date/offset/GPS/
orientation, and rendered thumbnail/full preview through expo-image. Native
checks covered trip gallery queries, shared Travel Memories and manual pin
attachments, no automatically confirmed reconstruction Stops, malformed input
rejection, v4 export/restore checksum equality, regenerated previews and FKs.

Interactive system Photo Picker and ACTION_OPEN_DOCUMENT imports both retained
HEIC format, then passed the same import/preview/integration/restore checks.
**Provider fidelity limitation:** on this device, BOTH pickers supplied a
GPS-redacted representation, even when navigating directly to device storage.
The source fixture SHA-256 is 1ddce967…febc67; the supplied representation is
3963a4057efb7c638cfe41f4702c9465c33cc6baf5bfea79679fed52907b8aca.
Native verification compares the selected source URI against the archived bytes;
those match exactly, as do exported/restored bytes. Dates/offset/orientation are
retained; GPS remains null for the provider representation. Direct app-owned
fixture import retains full original bytes and GPS. The UI explains provider
redaction; fidelity remains picker_representation. No permission expansion,
metadata guessing, JPEG substitution or claim of guaranteed camera-original
access is made. File selection is not advertised as a redaction bypass.

Host: 149 focused tests passed (database/migration, media, reconstruction, maps/
routes, archives and Travel Memories), including old v1/v2/v3/v4-schema13 restore,
HEIC/HEIF byte roundtrips, populated migration preservation and rollback.
TypeScript passes. The isolated Android ARM64 APK builds successfully.
Evidence is local under ignored .expo/heic-audit/: host-final.log,
final-native-all.txt (three successful suites: fixture + document + photo picker),
document-picker-pass.txt, final-rendered.png and build-document-picker.log.
The earlier hash failures intentionally compared provider data against the
unredacted fixture; they exposed the redaction above. They are not claimed as
byte-identical camera-original picker imports. Earlier sequence/grayscale probes
are excluded from the supported profile matrix and documented above.

The regular ARM64 Expo development APK also passed `:app:assembleDebug` without
the audit init script (build-development.log; 497 tasks). It was built, not
installed over the populated production app. The audit APK SHA-256 is
E144BB3284298D892A96ACB8EEB59A1814440ADE0C415E81ADBCAE49F66A6562.
The populated migration rollback test was strengthened and rerun: all 21 media
tests pass (media-final.log), retaining the overall 149-test passing coverage.
Final `git diff --check` passes. No dependencies, MapTiler/ORS behavior, existing
applied migrations, commits or pushes were changed/performed.
