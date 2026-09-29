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

JPEG and still PNG are supported, including PNG transparency. Content signatures,
PNG animation chunks, decoder success, encoded size (100 MiB) and dimensions
(100 megapixels) are checked. Unsupported formats including HEIC/HEIF, GIF, WebP,
AVIF, RAW/DNG and video are rejected explicitly. HEIC has no tested-device matrix
yet. Motion/Live Photo archival is not supported.

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
media/originals/<hash prefix>/<sha256>.jpg|png
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
