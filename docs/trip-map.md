# Step 7 — confirmed Trip Map

Trip Detail → Trip Map reads the existing local route repository: active Trip,
ordered active Stops and their canonical Places. Timeline section labels come
from the existing Timeline query. No suggestion, photo GPS or reconstruction
resolution is a rendering input. Accepted reconstruction appears only through
its canonical rows; subsequent manual Place corrections take precedence.

Only confirmed Stops with finite, complete, in-range coordinate pairs are plotted.
This step explicitly excludes `(0,0)`, including a stored pair. Single-axis zero
coordinates remain valid. Unknown/unusable and unconfirmed Stops remain ordered
in the list, with counts explaining why they are not plotted. Missing coordinates
are not errors. Repository ownership/tombstone checks remain authoritative;
live references already prevent Place deletion. No database migration is added.

Dashed straight lines connect only adjacent mapped Stops. They show sequence,
never travelled roads, distance, or navigation. An unknown/unconfirmed Stop breaks
both adjacent links. The UI lists the displayed link numbers, useful when repeat
visits make different legs overlap. Identical coordinate pairs produce no
zero-length line. Antimeridian-crossing links are explicitly omitted and labeled,
rather than drawing across the world or generating intermediate coordinates.

Every occurrence retains its Stop ID and order, even at the same Place. Coincident
markers show all visit numbers at the unchanged coordinate; selecting one exposes
separate visit buttons. The complete list also selects each Stop independently.
Selection shows kind, optional DateSpec/note and its existing Timeline section.
Edit coordinates opens the existing shared Place editor. Panning never writes data.

The camera fits the viewport with circular longitude bounds, Mercator latitude
projection, padding and a maximum initial zoom of 11. Single/identical points have
a stable close overview. Projection clamping affects only the camera; archived
coordinates are unchanged. With no mapped Stops, no MapLibre view is mounted.

The background is fully bundled Natural Earth v5.1.2 land at 1:110 million scale
([source](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson)).
License/source are retained in `assets/maps/LICENSE.txt`. No online provider,
tiles, fonts, sprites, key, geocoding, routing or offline tile downloads are used.
At close zoom, the coarse background is intentionally plain. Load/render errors
leave a map-unavailable message and the route list accessible.

## Verification — 30 September 2026

- `pnpm typecheck`, `git diff --check`: passed.
- All 108 host tests across Steps 1–7 passed (12 focused map tests). Real SQLite
  coverage includes ownership/deletion and pending/rejected/accepted reconstruction;
  canonical corrections never fall back to suggestion coordinates.
- Pixel 8 emulator, Android 17/API 37, existing Expo development APK: opened Trip
  Detail → Trip Map for the synthetic five-Stop route. Three distinct Places have
  coordinates, one Stop is unknown, and one Place is visited twice. Four mapped
  occurrences, list order, markers, and only links 1→2 and 4→5 verified.
- Selected both visits to the repeated Place; stay date, note, and section label
  verified. Opened its existing Place editor with the correct coordinate pair.
- Single, identical and widely separated coordinate cameras verified visually.
- Force-stopped, disabled Wi-Fi/mobile data, relaunched and opened the route.
  Local background, geometry, ordered list and no-coordinate empty state worked.
  Native persisted-data audit passed after restart. App-process logcat contained
  no fatal native exception or JavaScript error. Network settings restored.
- Development JS was served through local ADB/Metro; this does not certify a
  standalone release cold launch, physical devices, or iOS. Renderer-failure
  injection was not performed; the bundled background needs no network tiles.

The development-only `/trip-map-test` prepares/reopens clearly named synthetic
fixtures and audits them without modifying existing travel data. Evidence is in
ignored `.expo/step7-*` screenshots, XML, test output and app-process logs.
