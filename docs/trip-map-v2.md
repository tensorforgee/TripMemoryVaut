# Trip Map V2

Latest road workflow: see **Road route workflow — 19 October 2026** at the end.

Current MapTiler integration is documented in **MapTiler Streets V4 — 12 October
2026**, with the latest physical results under **Successful build retry and Samsung
verification** below. Current road-routing implementation and blockers are documented in the
**Road-following routes — 9 October 2026** section below. Earlier Phase 1 results
are historical evidence; they do not verify generated road geometry.

## Screen and canonical data

Trip Detail → Map has a compact ivory header, trip title, ordered route summary,
summary chips, a large interactive MapLibre viewport and a small expandable panel.
Deep teal sequence strokes, muted green starts, terracotta destinations/selection,
white casings and an amber stay dot form the Trip Memory Vault identity.

Duration is inclusive calendar days only with exact day-precision endpoints.
Otherwise an existing user-entered estimate says “About N days”, or duration is
omitted. There is no recorded-distance field in the current schema: distance is
omitted, never estimated from coordinates. Mapped counts count confirmed canonical
Stop occurrences, including repeated Places. No suggestion, Dream or photo GPS
is a map input; the Step 7 geometry and Step 11 camera helpers remain unchanged.

Photo counts count live TripMedia joined to live Media in this trip/vault. Pending
selections/import jobs do not count. Missing local originals remain archive records,
as in Travel Life; the count is not a file-integrity claim. Stop counts use explicit
stop_id only, never Place identity or proximity. Unassigned photos count in the
trip total and remain unassigned. No schema migration or portable format change.

## Basemap configuration

`EXPO_PUBLIC_MAP_STYLE_URL` is the build-time HTTPS MapLibre style URL boundary.
Expo inlines this public value; rebuild/restart Metro after changing it. Never
put a service secret in it. Restricted public mobile map tokens are extractable
from the application and must be monitored/restricted accordingly.

- MapTiler Streets V4 is the preferred basemap, supplied by the existing local
  Expo environment. There is no hardcoded key and no implicit OpenFreeMap fallback.
- Blank or invalid/non-HTTPS configuration selects the bundled offline overview.
- Any build with the variable absent explicitly reports online mapping is not
  configured and uses the bundled overview. No hardcoded production provider/key.
- Native attribution stays enabled and unobscured. Configured styles must retain
  required source attribution. No bulk tile downloads are enabled.

The local MapTiler HTTPS style configuration passes host and Samsung native resource
checks. The separate public-mobile-key restriction finding is documented below.
Native source attribution remains enabled; a bundled official MapTiler logo and
visible MapTiler/OpenStreetMap copyright links accompany this provider's map.
No geocoding is added.
Online requests disclose the viewed tile area and IP to the provider; archive
photos, notes, trip titles and Stop records are not sent. Style URLs/keys are not
logged by the new application code.

Android release now retains INTERNET for HTTPS basemaps. ACCESS_NETWORK_STATE
remains; unused Wi-Fi/overlay/vibration permissions are still removed. Cleartext,
location, camera, microphone and broad media access remain disabled. The artifact
verifier expects INTERNET. Previously signed artifacts predate this change and
must be rebuilt to exercise online maps; their historical checks are not V2 checks.

## Camera and markers

Header and panel occupy layout space outside the Map. The existing camera helper
receives the measured visible viewport and applies 48-point edge padding. Opening
and Fit trip include every mapped canonical Stop. One/identical points cap at zoom
11; widely separated points and circular antimeridian bounds reuse existing math.
Projection limits never change archive coordinates. No mapped Stops shows a world
overview and an intentional explanation with Route/Stops actions still available.

Native pan, pinch, double-tap zoom and rotation remain unrestricted by trip bounds.
Pitch is disabled. Camera changes animate for 550 ms. Selecting a mapped Stop
recentres the visible viewport; Fit trip clears selection and collapses the panel.
Panning never writes data.

Static markers use GeoJSON circles and native symbol layers, not a React view per
Stop. Eleven bundled digit/plus bitmaps keep numbers independent of online fonts.
A single richer React marker labels the selected Place, including offline. Other
names come from the basemap and accessible Stop list, avoiding duplicate archive
city labels/collisions. Numbers follow full canonical order, including unmapped
Stops. Only the actual first/last Stop receives start/destination treatment; an
unmapped endpoint does not promote another Stop. `kind=stay` alone gets an amber
dot. Selection grows the marker and adds a terracotta halo.

Identical coordinates get a badge such as `2+`, exposing separate visit buttons
in the panel. Each occurrence also remains selectable in Stops. Selecting another
visit changes its displayed number, kind, details and photo count at the unchanged
coordinate. Display grouping retains every Stop ID and never requires unique
Places. Nearby distinct coordinates are not moved or merged.

## Route and panel

**Phase 1 route line is still confirmed Stop sequence visualization.** Teal dashed
strokes with light casing and rounded joins/caps do not claim actual travelled
roads. Unknown/unusable coordinates and unconfirmed Stops break both adjacent
links. A → unknown B → C never becomes A → C. Identical points add no zero-length
links. Antimeridian-crossing links remain omitted with a legend cue, matching
Step 7. Its existing `(0,0)` exclusion is unchanged.

The initial collapsed panel shows trip title, mapped Stop/photo counts and Route,
Timeline, Photos and Stops actions. Tap the handle/title to expand/collapse. Its
scrollable body is capped at 28% of screen height/240 points; no sheet dependency.
Selection expands name, order, kind, assigned section, known DateSpec/custom label,
private note, stored lodging/check-out fields and associated photo count. Unknown
fields are omitted. No new Hotel entity, public reviews, ratings or search.

Route and Edit place reuse the existing editor; Timeline opens the existing trip
timeline; Photos opens the existing trip gallery. Those screens have no Stop
filter/deep link, so photo navigation is explicitly described as trip-wide. Stops
is the full accessible ordered list, including unknown/unconfirmed visits, usable
even if the renderer fails.

## Offline behavior

SQLite loads independently of the basemap. Style errors switch to the existing
bundled Natural Earth overview. An 8-second no-cache style probe makes offline
cold launches explicit even if native tiles are cached; a 12-second render timeout
also covers missing tile resources. A detailed-map ready label explicitly allows
cached tiles and does not promise connectivity/offline coverage.

Fallback identifies the coarse overview and lack of detailed road tiles. Local
numbered markers and disconnected sequence geometry remain available. Retry
basemap or returning from background retries the configured style. Failure of
the local renderer yields Map unavailable, with panel/list/actions retained. A
React error boundary cannot catch a native process crash; device verification
is required. No detailed offline tile pack or network-state dependency is added.

## Limits and later phases

Closely spaced markers
can overlap: zoom or use Stops; exact coincidences expose visit buttons. Only the
selected archive name is overlaid. The panel is tap-expandable, not draggable.
Photo and timeline navigation is trip-wide. No other screen is redesigned.

**Actual road-following route geometry is Phase 2.**
**Arbitrary map photo/memory points are Phase 2.**

No new dependencies, domain meanings, cloud/sync, routing API, road snapping,
navigation, geocoding, live GPS, hotel/business search or export changes.

## Verification — 4 October 2026

TypeScript and all 181 Step 1–14/release tests pass (168 existing + 13 V2 tests).
The original Step 7/11 map tests are unchanged. V2 tests cover header values,
missing/estimated duration, missing distance, mapped occurrences, real SQLite
photo counts/ownership/deletion, marker order/repeated Places/selection/stays,
canonical-only input, gaps, zero/single/identical/wide/dateline cameras, offline
presentation and HTTPS configuration. Release permission assertions now require
INTERNET while preserving all other restrictions. No commits or pushes.

Physical Pixel 9 ARM64: **NOT RUN**. `adb devices -l` lists only
`emulator-5554 / sdk_gphone16k_x86_64`; emulator checks cannot satisfy the physical
gate. This is an Android 17/API 37, x86_64 emulator with 16 KB pages, not an ARM64
Pixel. No V2 signed release/physical-device validation has been performed.

The development build completed with JDK 17 and `:app:assembleDebug`, restricted
to x86_64, one Gradle worker, no parallel execution (497 tasks). The debug APK was
installed with `adb install -r` after checking that its signing certificate matched
the installed APK. No uninstall, vault reset, schema change or dependency change.
Existing Step 7 synthetic fixtures were recreated through their existing developer
verification screen because the old manifest referred to removed records. The old
manifest and a local app-data snapshot were preserved in ignored runtime evidence.

| Requested runtime check | Emulator observation |
| --- | --- |
| Open an existing multi-stop Trip → Trip Map | Passed through Trip Detail; five canonical occurrences, four mapped |
| Online context, roads/place labels at useful zoom | Passed: roads, Jalandhar/Ludhiana/Chandigarh and smaller towns, rivers/water, boundaries |
| Initial complete fit and Fit trip after exploration | Passed; start/intermediate/destination badges fit; panel collapses on Fit |
| Pan and double-tap zoom | Passed with visible camera/context changes |
| Pinch in/out | **Unverified**: both custom two-pointer injection and UI Automator pinch APIs reported successful injection, but screenshots did not demonstrate a zoom change; requires real touch verification/diagnosis |
| Tap numbered mapped Stops | Passed for 1, 2 and 4; selected color/halo and Place label update |
| Repeated Place visit | Passed: `2+` exposes distinct Stop 2 stay and Stop 5 destination; selection changes order/kind without changing archive identity |
| Stay selection | Passed: stored synthetic section, approximate year and private note; stored lodging/check-out fields additionally covered by host tests |
| Unknown-coordinate Stop | Passed: Stop 3 remains in Stops, reports not plotted; canonical gap geometry also asserted in host tests |
| No mapped Stops / one point / identical points / widely separated points | Passed visually: intentional no-coordinate message, bounded one-point zoom, shared occurrence badge, complete wide fit |
| Antimeridian | Host camera/sequence tests passed; no additional device fixture run |
| Route / Timeline / Photos actions | Passed: existing screens open; no Stop-specific filter implied |
| Force-stop, disable Wi-Fi and mobile data, relaunch | Passed: local trip/header/list/selection/stay notes and numbered overlays load with explicit offline overview; dev JavaScript supplied over ADB localhost, not a network basemap |
| Re-enable network and Retry basemap | Passed: detailed basemap returns; original Wi-Fi and mobile-data enabled settings restored |

Runtime fixes made during this pass: initialize the native camera only after the
viewport is measured; use fully rendered **frame** callbacks to clear the tile
deadline after camera movement (a full-map callback did not fire for every move);
set the map's hidden header statically in the route layout. The final screen no
longer briefly opens at world bounds for a mapped trip or falls back simply because
a successful camera movement did not produce a new full-map event.

**Native stability remains an open gate.** One startup/deep-link run produced a
SIGSEGV in `facebook::react::MountingCoordinator::pullTransaction`, on `mqt_v_js`
(app PID 21489, 16:33:37 device time). The stack identifies Fabric mounting, not a
proven MapLibre, Worklets or Reanimated root cause. Moving the hidden-header option
out of the screen avoids a startup header mutation, consistent with the existing
native-header workaround. Subsequent online/offline launches, selections and
navigation did not reproduce the crash, but this does **not** establish resolution.
No native upgrade or architectural workaround was introduced speculatively.

Logs also contain MapLibre `Invalid geometry in line layer` warnings without a
source/layer ID; their origin remains unconfirmed. Expected tile fetch failures
occurred with network disabled. No React JavaScript, Worklets or Reanimated runtime
error was found in the subsequent app session. Expo's development launcher logged
a missing optional `SplashScreenManager` while starting but loaded the app. System
UWB service crashes and recycled PIDs in the emulator log were distinguished from
the actual app crash using `dumpsys activity exit-info` and process start times.

Ignored local evidence lives under `.expo/map-v2-*`: final regression/focused logs,
debug build log, initial/selected/offline/single/wide screenshots, UI hierarchies,
current-process logs and the native crash buffer. These are development evidence,
not portable archive content or a physical-device pass.

**Readiness: blocked pending physical ARM64 runtime verification, real pinch zoom
verification and a reproducible diagnosis/resolution of the startup Fabric crash.**
Production style provisioning and a fresh signed-release permission/provider check
also remain before distribution. Repeat the user's complete 20-step online/offline
checklist on the Pixel 9, including each numbered/repeated Stop, and inspect fresh
app-specific native/MapLibre/React/Worklets/Reanimated logs before changing this gate.

## Validation follow-up - 5 October 2026

This section supersedes the physical-device availability assumptions above. It
does not convert the 4 October emulator results into physical-device evidence.

### Physical device and interruption

All device commands in this follow-up target `adb -s RZCY8121TTB` explicitly.
The initial connected-device inspection returned:

| Property | Observed value |
| --- | --- |
| Manufacturer / model | samsung / SM-S921E |
| Android / API | 16 / 36 |
| Primary ABI / supported ABIs | arm64-v8a / arm64-v8a |
| Page size | 4096 bytes |
| Physical-device flag | ro.kernel.qemu=0 |
| Storage | /data: 104G total, 83G used, 21G available |
| Current Android user | 0 |
| Existing target package | Not installed for user 0, including retained uninstalled packages |
| ADB reverse mappings | None |
| Initial Wi-Fi / mobile-data settings | Both enabled (1) |

The device disconnected before the new APK could be installed. Subsequent
serial-scoped commands return `device 'RZCY8121TTB' not found`. Reconnection and
a hands-on touchscreen check were requested. No emulator was substituted.
No app installation, uninstall, vault reset, restore, or network-setting change
was performed. Other profiles were not inspected: Android denied access to
user 150 during an initial unscoped package-list query; the user-0 checks above
were explicit and successful.

A disposable six-trip archive was generated with the existing host SQLite
repositories and portable exporter, validated with `inspectPortableRestore`, and
pushed to `/sdcard/Download/MapV2PhysicalFixture` before disconnection. It contains
eight synthetic Places, repeated Stop occurrences, a gap, single/identical/wide/
dateline/zero-mapped camera cases and one 301-byte synthetic PNG assigned to the
stay Stop. It has **not** been restored into the phone. Test dates and names are
explicitly synthetic; they are not claims about the owner's travel history.
Before using this fixture, re-push the host copy: its PNG dimensions were corrected
from the actual IHDR (64 by 32), and all manifest hashes reverified, after the
phone disconnected. The earlier device copy must not be used as final evidence.

| Physical check on the new standalone build | Result |
| --- | --- |
| Pinch in/out, pan, double tap, rotate, Fit trip | NOT RUN |
| Online roads, geographic context and labels | NOT RUN |
| Route, marker numbering, selected Stop ID and stay treatment | NOT RUN |
| Repeated Place visits and unknown-coordinate gaps | NOT RUN; host coverage passes |
| Zero/single/identical/wide/dateline camera cases | NOT RUN; host coverage passes |
| Bottom sheet, details, Route/Timeline/Photos/Edit navigation | NOT RUN |
| Offline cold launch, local SQLite/overlays and reconnect recovery | NOT RUN |
| Physical safe areas, touch targets and visual hierarchy | NOT RUN |
| Cold-launch/map-open/lifecycle stress | 0 launches, 0 map opens |

### Previous Fabric crash

Inspected `.expo/map-v2-crash.log` and the prior process/runtime logs. The actual
app event is 4 October at 16:33:37, PID 21489, thread `mqt_v_js`: `Fatal signal 11
(SIGSEGV)`, `SEGV_ACCERR`. Frame 1 is
`facebook::react::MountingCoordinator::pullTransaction(bool) const+713` in
`libreactnative.so`; following frames include FabricUIManagerBinding, Scheduler,
ShadowTree and UIManager. This is the prior x86_64 emulator, not the Samsung.
Unrelated system UWB SIGABRT records were excluded from app findings.

The stack establishes a Fabric mounting failure, not a proven MapLibre, Marker,
image, Reanimated or Worklets root cause. No speculative native change was made.
The required physical stress run was prevented by disconnection. Therefore this
event remains **unresolved**, and is **not** classified as non-reproducible after
current stress coverage. Ten clean cold launches, ten Map opens and the requested
navigation/selection/panel/camera/recreation sequence remain required.

### Geometry-warning investigation

Exact prior warning: `MapLibre Native [WARN] [Mbgl] {Worker 1}[General]: Invalid
geometry in line layer` (worker numbers vary). The same native message appears
as `W Mbgl ... Invalid geometry in line layer` in the prior process log.

The pinned Android 13.6.1
[LineBucket implementation](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/src/mln/renderer/buckets/line_bucket.cpp)
emits it when nonempty input has fewer than two coordinates for a non-polygon
feature (three for a polygon). It skips that geometry. Duplicate removal alone
does not emit the warning. Logging is once per native process and contains no
layer/source identifier, so warning absence on subsequent map opens is not proof
that a particular layer is clean.

An external warning-producing defect was identified in the fetched
[OpenFreeMap Liberty style](https://tiles.openfreemap.org/styles/liberty):

- Layer `park_outline`: type `line`, source `openmaptiles`, source-layer `park`,
  **no geometry-type filter**.
- Source metadata: `https://tiles.openfreemap.org/planet`; inspected tile version
  `20260927_080001_pt`.
- Tile `7/90/52` has 30 Point and four Polygon park features; `7/91/52` has
  41 Point and 38 Polygon park features. Point geometry has one coordinate and
  passes the unfiltered outline layer, satisfying the native warning condition.
- A closer tile, `11/1460/840`, contains two Point and two Polygon parks, including
  Sukhna Lake WLS. The point records also enter the unfiltered outline layer.
- The [OpenMapTiles schema](https://openmaptiles.org/docs/schema/#park) explicitly
  documents point-only park fields. These points are legitimate source data;
  the style should restrict its outline layer to polygon/line geometry.

This establishes an external style defect independent of Trip GeoJSON. It does
not uniquely attribute every historical unlabelled event: a fresh-process native
isolation comparison with only this external layer, then with it filtered, has
not run because the phone disconnected. That final attribution check remains
open. No blanket logger suppression or provider-specific production-style
rewriting was added.

App-generated geometry audit:

- Sequence FeatureCollections contain only two-coordinate LineStrings in
  `[longitude, latitude]` order, with canonical Stop IDs and sequence provenance.
  Unknown/unconfirmed coordinates break both adjacent links; no gap bridging,
  single-point LineString, identical-endpoint segment or dateline-spanning link.
- Marker FeatureCollections contain finite, in-range Points; shared display
  badges retain all canonical Stop IDs and do not convert visits to Place IDs.
- A supplemental 19-input host audit covers NaN, positive/negative Infinity,
  unknown and out-of-range coordinates, `(0,0)`, single-axis zero,
  duplicates, poles and dateline crossings: eight mapped occurrences, eleven
  excluded, one valid line, three dateline gaps; finite camera result. Passed.
- Bundled fallback: 127 Polygon features, no invalid coordinates or rings shorter
  than four positions. Three consecutive duplicate vertices exist in the source
  asset; they do not establish this warning's cause and were not rewritten.
- All eleven marker PNGs are 32 by 48 pixels. Numbered-marker source references
  match the bundled assets; digits 0-9 and the plus sign were visually inspected
  and match their filenames, with readable glyphs and transparent backgrounds.

Evidence and disposable diagnostic tools are under ignored `.expo/map-v2-*`.
Tile parsing uses isolated diagnostic dependencies under `.expo/`; no application
dependency, package manifest, lockfile, schema or canonical geometry was changed.

### Configuration and host checks

`EXPO_PUBLIC_MAP_STYLE_URL` is public client configuration, not secret storage.
This follow-up explicitly builds with the keyless HTTPS OpenFreeMap Liberty URL
as a **test configuration**. It contains no credential or token. No provider
account, fake credential or signing key was created or rotated. Existing local
upload signing is used through `scripts/android-upload-signing.ps1 -Action Build`.

The production resolver with no variable returns no remote style and the screen
selects the bundled overview labeled `online map not configured`. Development
alone supplies OpenFreeMap by default. Blank/non-HTTPS configuration also selects
the overview. Host tests verify that boundary. Production MapTiler provisioning
(or owner-approved alternative), attribution/licensing, quota and restrictions
on any publishable client token remain **pre-store-rollout configuration**, not
an independent Phase 1 blocker. A test-provider APK is not a store configuration.

The source, release plugin and generated manifest retain INTERNET for HTTPS
styles/tiles; ACCESS_NETWORK_STATE remains for existing monitors. Browsing does
not use location permission. No location/background-location, contacts, camera,
microphone or broad storage permission was introduced. Source/config scans found
no map key/token; the test URL is public. Actual release artifact checks below
confirm the three-permission allowlist and the release flags.

TypeScript and test compilation passed. All **181 tests passed, zero failed,
skipped or cancelled**, including all Step 1-14 tests, the 13 V2 tests and release
configuration/signing checks. `git diff --check` passed. Phase 2 was not started;
there were no application code changes, commits or pushes in this follow-up.

### Fresh signed artifacts

The current-source `bundleRelease` + `assembleRelease` build completed:
**BUILD SUCCESSFUL in 33m 42s**, 879 tasks (829 executed, 50 up-to-date), using
the existing upload key and the explicit public OpenFreeMap test configuration.
No old APK is used as evidence for these changes.

| Check | Verified result |
| --- | --- |
| AAB cryptographic signature | All 1,405 payload entries verified against the independent upload certificate |
| APK signature | apksigner verified; signer matches the same independent certificate |
| Bundle structure / APK ZIP alignment | bundletool passed; zipalign `-c -P 16 4` passed |
| Package / version / SDK | com.tripmemoryvault.app / 0.1.0 (1) / min 24, target 36 |
| Permissions | INTERNET, ACCESS_NETWORK_STATE, package DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION only |
| Release flags | Non-debuggable, non-test-only; backup and cleartext disabled; no dev launcher/menu activities |
| Hermes | 3,276,016-byte bytecode; APK and AAB hashes match; current Map V2 identifiers and public test-style URL present |
| Native payload | All four ABIs; 25 libraries each; React Native, Hermes, MapLibre, Reanimated and Worklets present |
| Alignment | At least 16 KiB ELF LOAD alignment for both 64-bit ABIs; bundle requests PAGE_ALIGNMENT_16K |
| Numbered assets | All eleven APK resource-table entries resolve to present 32 by 48 PNGs |
| APK size / SHA-256 | 155,913,927 bytes / `45291BC47B44E37EB47600CA2910B94192C87ABC1D293F34395CD331FF6423FD` |
| AAB size / SHA-256 | 92,356,845 bytes / `88EE1689E158A3674B01D6F0CA0C0F9A306995CB7E73B8CD09B47669D3500FC2` |

Outputs: `android/app/build/outputs/apk/release/app-release.apk` and
`android/app/build/outputs/bundle/release/app-release.aab`. Build and verification
logs: `.expo/map-v2-physical-release-build.log` and
`.expo/map-v2-physical-artifact-check.log`. The disposable APK checker was adjusted
to resolve Android's shortened PNG filenames through the actual resource table;
this was a checker assumption, not missing application assets.

These are standalone signed **build/artifact** passes, not runtime passes. The
APK was not installed or launched. Hermes/MapLibre/Worklets/Reanimated loading on
this phone, no-Metro cold startup, online/offline behavior, physical gestures and
lifecycle stress remain unverified. A 4 KB phone also cannot establish 16 KB ARM64
runtime behavior; binary alignment alone is not runtime evidence.

Final ADB inspection still reports no connected devices. Resume with the exact
serial `RZCY8121TTB`, refresh the disposable fixture, check package/signing state
again, install without clearing data, and run the physical matrix above. Complete
the external-layer warning isolation in a fresh native process before claiming
the historical warnings conclusively attributed. Provider selection is not the
reason this validation is blocked.

**FAIL - MAP V2 BLOCKED**: physical runtime/touch/offline checks, Fabric stress
classification and the remaining native warning-isolation check are outstanding.

## Road-following routes — 9 October 2026

**Status: implementation foundation complete; live routing is blocked.** No
production routing credential/endpoint was supplied. No public demo server was
called, and no routing HTTP transport is enabled in the app. Opening a map,
restarting, retrying the basemap or going online never generates routes.
`configuredRoutingProvider` fails with a setup explanation. The ORS adapter is
implemented against an injected transport and tested with synthetic responses.
It must not be described as verified road routing in India.

The task explicitly advances architecture section 7's generated-road extension
and requests a solid road stroke. That instruction supersedes the earlier
Phase 1 dashed-only presentation for confirmed generated geometry. Generated
roads remain distinct from recorded tracks and exact historical evidence.
Arbitrary photo/memory points remain deferred.

### Audit and provider decision

`src/features/map/model.ts:buildTripMap` creates each straight segment as
`coordinates: [a.coordinate, b.coordinate]`; identity is the ordered pair of
Stop IDs. `TripMapScreen.tsx` renders `trip-sequence-casing` and
`trip-sequence-line` with `line-dasharray: [2, 1.5]`. These remain exclusively the
explicit **Stops only — exact road unknown** fallback. They disappear when
current road geometry or a road preview is displayed. Unrouted pairs are gaps;
partial road coverage is labeled by segment count.

`features/route/repository.ts` remains the authority for Stop order and canonical
Places. Repeated Place visits retain different Stop IDs. Unknown, unusable,
unconfirmed and `(0,0)` Stops still break both adjacent links. Road candidates
use full canonical order, never a filtered list of mapped points. Original Stop,
Place, photo and metadata fields are not rewritten by routing.

Migration history was schema 10; portable archives were format 1. The archive
exporter's old `routes()` filtered out unconfirmed Stops before assembling lines,
which could bridge an unconfirmed visit. It now preserves those gaps and the
same identical-coordinate/dateline exclusions as the map's sequence fallback.
Map configuration, permissions, basemap attribution, stays, markers, header,
chips, pan/zoom, selected Stop label and existing navigation remain in place.

Provider research was checked against primary documentation on 9 October 2026.
No comparative route-quality benchmark was performed. All three engines can
return detailed road graph geometry; none establishes which road was travelled
years ago. In Himachal/Ladakh, map completeness, access tags, graph freshness,
seasonal closures, disconnected roads and snapping can change or prevent results.
No claim that one has superior mountain coverage is supported without real calls.

| Option | API / via points / geometry | Costs and limits observed | Credentials, retention and decision |
| --- | --- | --- | --- |
| openrouteservice / HeiGIT | HTTPS Directions V2 POST; ordered longitude/latitude coordinates, car profile, explicit GeoJSON LineString; simplification can be disabled. Via coordinates stay within the segment, not additional visited Stops. | Standard: €0, Directions 2,000/day and 40/minute; 50 route waypoints and driving distance limit 6,000 km. This client caps vias at 20 per segment. Limits can change. | Results currently CC-BY-SA 4.0 with ORS/HeiGIT and OSM attribution. Official FAQ permits each user bringing their own key and forbids a shared key in client apps. **Preferred adapter, conditional production choice:** current terms prohibit transmission of personal data; clarify application to private retrospective Stop/via coordinates before enabling. No key was supplied or collected. |
| Valhalla | HTTP route API, `auto` costing, ordered break/through/via locations, detailed shapes (normally polyline6). Configurable costs support routing preferences. | Engine is open source; self-hosted limits, hardware, updates and availability are operator costs. No production hosting subscription/quote was supplied. | OSM data attribution/license and any hosting contract apply. A self-managed engine can avoid third-party result-retention restrictions, but adds a backend and operations outside this task's authorization. A contracted endpoint needs an explicit archival/export grant and mobile credential policy. Public demo explicitly excluded. |
| GraphHopper | Hosted Routing API supports multiple ordered points and unencoded coordinates; flexible routing options depend on plan. | Page displayed Free 500 credits/day and 5 locations; Basic €69/month, 5,000 credits/day, 30 locations; Standard €199/15,000/80; Premium €479/50,000/200. Billing duration/currency/VAT affect price. Free is noncommercial by default; paid plans support commercial use. | API key is client-visible if shipped in the app. Standard hosted terms only expressly permit temporary client caching; permanent portable archives need a separate agreement. GraphHopper attribution required without white-label option; OSM attribution remains. Not selected under standard terms. Self-hosted engine is a separate operations decision. |

Primary sources:

- [ORS Directions and return types](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types),
  [API restrictions](https://openrouteservice.org/restrictions/),
  [current plans](https://account.heigit.org/info/plans),
  [current terms](https://account.heigit.org/info/tos).
  The JS-rendered current plans/terms pages were read in a browser; older forum
  references to CC-BY alone do not supersede current CC-BY-SA terms.
- [ORS credential guidance](https://giscience.github.io/openrouteservice/v9.10.0/frequently-asked-questions)
  documents server-side use or individual user keys. It does not authorize a
  shared Expo public key. [Endpoint migration announcement](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912)
  gives `https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson`;
  the old host is deprecated. The adapter records the new endpoint.
- [Valhalla route API](https://valhalla.github.io/valhalla/api/route/api-reference/),
  [engine repository and demo distinction](https://github.com/valhalla/valhalla),
  [data attribution](https://valhalla.github.io/valhalla/contributing/data/attribution/).
- [GraphHopper API](https://docs.graphhopper.com/openapi),
  [pricing](https://www.graphhopper.com/pricing/),
  [terms, section 5.2](https://www.graphhopper.com/terms/).

Before live transport implementation, the owner must choose an approved provider
setup. Recommended next decision: resolve ORS's personal-data clause with HeiGIT
for this use and choose individual user-supplied credentials, or supply a licensed
production endpoint whose terms cover private coordinates and indefinite saved
geometry/portable export. A proxy or self-hosted engine would require separate
backend authorization. No provider account, contract, payment or correspondence
was created on the owner's behalf.

Expo public variables are bundled and extractable; they cannot store service
secrets. Do not add an `EXPO_PUBLIC_ORS_API_KEY`, reuse someone else's public demo
token, or point the adapter at a demo. A future user-key entry flow must handle
keys privately (session-only or explicitly authorized secure storage), exclude
them from logs, SQLite, exports and screenshots, and use the key only for its
owner. This gated build contains no key entry, credential persistence or live
fetch transport. An environment flag alone is not provider approval.

Retention rationale is based on ORS's published result license, which supports
copying with its conditions; distribution of adapted route data must retain
attribution and applicable share-alike terms. The application stores the license
URL and attribution with geometry and carries them into GeoJSON and the journal.
This does not relicense the user's separate photos or notes. Basemap licensing is
independent; saved geometry does not grant offline tile-download rights.

### Local schema and workflow

Migration **0011-road-routes**, schema **11**, adds `road_route_segments`:

- UUID, vault, trip, ordered from/to Stop IDs; same-vault/same-trip composite FKs
  and one active row per ordered pair. Repeated visits remain distinct segments.
- Row payload version 1; canonical input-coordinate snapshot; ordered via points
  with separate UUIDs; original provider LineString coordinates.
- Versioned generated-source provenance: provider, driving profile, request time,
  supplied engine version and graph date (null when unknown), attribution/license.
- Optional provider distance in metres, explicit `confirmed` status/time,
  persistent stale flag, creation/update timestamps and tombstone envelope.

Only confirmed geometry is persisted. Requests and previews remain temporary;
the UI describes this and asks before leaving with unconfirmed proposals/via
edits. Opening **Generate road route** exposes one editor per adjacent known Stop
pair. Users can add numeric latitude/longitude via points, move them up/down and
remove them. They never create Places, visits, dates or photo-memory points.
Editing vias cancels any in-flight proposal and clears its preview. Generation is
explicit, with a disclosure naming ORS/HeiGIT and Stop/via coordinate transmission;
photos, notes and trip titles are excluded. Generate all is sequential; retry is
per segment. In this build, attempts report setup required without sending data.

With a configured transport, successful proposals appear amber on the existing
map. Users inspect them, then **Confirm suggestion** or **Discard proposal / edits**.
The old saved road stays in SQLite and on the map until replacement confirmation.
Confirmation is transactional, validates current live ownership/adjacency and
coordinates again, and is idempotent for a repeated identical submission. A
concurrent saved-route change is rejected rather than silently overwritten.
Saving one segment does not discard other segments' proposals.

Stop insert/reorder/removal/confirmation/Place-identity changes conservatively
mark the trip's saved segments stale. Shared Place coordinate changes stale all
segments using its Stop occurrences. Renaming or changing a note does not stale
geometry. Triggers share the Stop/Place write transaction; a failed reorder also
rolls back route invalidation. Reordering back does not automatically revive old
geometry. Stale rows stay exportable but are hidden from the current road layer
and explicitly reported. No geometry is silently regenerated.

The provider adapter rejects nonfinite/out-of-range coordinates, invalid or
oversized LineStrings, degenerate paths, segments with vertex jumps over 20 km,
endpoint mismatches, missing ordered via proximity, bad distances and malformed
responses. It allows at most 100,000 vertices per segment. The proposed ORS
request bounds snapping to 1,000 m; returned waypoints must be within 1,500 m.
These are deliberate acceptance limits, not a guarantee of correct road choice.
Coordinates exactly equal at both Stops require a distinct via point to request
a loop; otherwise no road is fabricated. Repeated places with different Stop IDs
remain legitimate. Error/quota/timeout/no-road cases keep prior confirmed geometry;
no straight-line substitution. Cancellation and 30-second timeout reject late
responses, even if the injected transport ignores abort. There are no automatic
API retries. Network/HTTP diagnostics are reduced to credential-free messages.

### Rendering and offline/archive semantics

Confirmed current geometry uses MapLibre `GeoJSONSource` and v11's
`Layer type="line"` API, solid blue/teal with contrasting light casing and rounded
joins/caps. Numbered Stop layers remain above both road and preview layers. Camera
fit includes all saved/preview geometry vertices and mapped Stops, so road detours
are included. Native pan/pinch/rotation and existing Fit trip remain enabled.
Dateline paths split at ±180 for rendering/export display only; the provider's
original coordinates remain unchanged in SQLite. Camera projection never changes
archived coordinates. A large-coordinate fit avoids JS argument-stack overflow.

Saved confirmed geometry reads only SQLite and stays drawable on the bundled
offline overview, independent of provider access and basemap tile availability.
No exact road is claimed for the sequence fallback. No detailed offline road
tiles are added. New routing needs the eventually configured online provider;
already-confirmed geometry never expires or regenerates on restart.

Portable format is now **2**, with `data/road-route-segments.json`, checksummed
manifest counts, schema metadata, readable generated/stale/confirmation/attribution
information, and GeoJSON road features carrying full provenance and vias.
Format 1/schema ≤10 is still accepted with no route rows. Old readers refuse
format 2. Version mismatches, missing route files, malformed geometry, unsupported
provenance, lost license, invalid status, unmarked stale inputs and cross-trip/
vault references fail closed before restore writes. Restore inserts validated
road rows after Stop/Place/tombstone processing, preserving exported stale flags.
The existing 50 MiB limit per portable JSON data file remains. Export now rejects
an oversized data envelope before finalization, so detailed route data cannot
produce an apparently complete package that the reader would reject for size.
Settings integrity checks validate road payloads as well as SQL/FKs. Local reset
deletes route children before their Stop parents; no reset was performed on a
device for this task.

### Validation and remaining gates

Host tests use clearly synthetic curves, never pretend route-engine output for
the requested cities. They exercise parsing, coordinate order, unsimplified
vertices, errors/malformed bodies, timeouts/cancellation, pair identity, gaps,
via add/reorder/remove, confirmation/discard, transactional idempotency, vault
isolation, persisted stale flags, SQLite close/reopen and a fresh host process
with networking forbidden, dateline edges, route-bounds
camera fit, schema upgrade preservation, export inspection and isolated host
restore. Host restore never invokes Expo's native SQLite restore path.

TypeScript and test compilation passed. **124 relevant host tests passed**, zero
failed/skipped/cancelled: Steps 1, 3, 7, 8, 10, 11, 12, 13 and 14. This includes
**21 new road-route tests**. Steps 8/10 were included because their upgrade
assertions needed the current schema version; existing history checksums remain
unchanged. `git diff --check` passed. Evidence is in ignored
`.expo/road-routing-regression.log` and `.expo/road-routing-focused.log`.
After the final request-timestamp and export-size safeguards, TypeScript/test
compilation and the **27 focused routing/archive tests** passed again; evidence
is in `.expo/road-routing-final-focused.log`.
The complete **124-test** selection also passed again against the final code;
see `.expo/road-routing-regression-final.log`.

The final signed release APK/AAB build passed on 9 October 2026. The AAB passed
bundletool validation and verification of all 1,405 signed payload entries
against the existing upload certificate. All four ABIs are included; both 64-bit
ABIs' native libraries have 16 KiB load alignment. The APK passed `apksigner`
verification and `zipalign -c -P 16 4`. Artifact SHA-256 values:

- APK: `C7AAD0682C64788B6EE0B40229B05224FDCD7D105414BFBF6D3D9EA92A982F62`
- AAB: `728481394001760A041C9FF1D2E32A1CDB8ED3C1DF523213B1F0E29FF67929F6`

Build evidence: `.expo/road-routing-build-current.log`. This build used the
OpenFreeMap Liberty style for testing; it does not establish production basemap
approval or native runtime correctness. No signing credentials were changed.

Real-world acceptance remains **NOT RUN / BLOCKED**:

- Disposable **Jalandhar → Shimla → Sangla → Chitkul**: requires an approved live
  provider and key; no road result, distance or failure response is invented.
- **Leh → Khardung La → Diskit** is the proposed Ladakh case, with an optional
  remembered via correction. Coordinates must be explicitly reviewed as sample
  pins, not imported as historical evidence. No provider call has been made.
- Multi-zoom road alignment, native preview/confirmation, via correction and
  physical process-restart/offline persistence require those real results.
- Samsung **SM-S921E / RZCY8121TTB** was connected at the initial ADB inspection;
  its existing package was a non-debuggable release. It disconnected before the
  update/signature comparison and install attempt. No APK was installed, no data
  reset, no network settings changed, and no destructive restore test was run.
- The existing archive-restore **SQLite SIGABRT** remains a separate release
  blocker. Historical Fabric/gesture/warning gates are not resolved by host tests.
- Production basemap provisioning, private-coordinate routing terms/credentials,
  actual mountain-road coverage and complete physical validation remain open.

No backend/auth/cloud sync, navigation instructions, traffic, ETA, GPS tracking,
business search, dependencies, commits or pushes were added.

**FAIL — ROAD ROUTING BLOCKED**

## MapTiler Streets V4 — 12 October 2026

The initial blocked-build results below are historical. The successful retry and
final standalone Samsung verification follow at the end of this section.

### Implementation

The existing direct `process.env.EXPO_PUBLIC_MAP_STYLE_URL` access remains the
Expo build-time boundary. The ignored local configuration was checked in memory:
HTTPS, MapTiler host, Streets V4 style endpoint and nonempty key are present.
No value was printed or copied into source, documentation or diagnostic logs.
Missing, blank, malformed, non-HTTPS or URL-userinfo configuration selects the
bundled overview in both development and production. OpenFreeMap is no longer
an implicit development default. Environment changes require a new native release
bundle; the previously installed APK still contains its old test configuration.

MapLibre and the provider's style layers are retained without rewriting road or
label styling. The compact header, summary chips, large map, Fit trip, ordered
markers, stays, selection and panel are retained. Native gesture props and camera
fitting are unchanged. Current confirmed saved road geometry now uses solid
blue `#1769e0`, width 5, over the existing width-8 light casing. Previews remain
amber; straight Stop sequence lines remain dashed teal with the explicit
unknown-road legend. No route, distance or historical metadata is fabricated.
ORS remains the chosen routing provider; no routing transport was enabled.

Native source attribution remains available. The MapTiler map also displays the
official bundled logo and separate visible, linked MapTiler/OpenStreetMap credits.
The logo covers the Free-plan requirement without assuming the owner's plan.
Fallback still displays Natural Earth attribution. See the official
[attribution guidance](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/).
Final screen placement/readability needs the new APK's visual check.

### Resource and key-restriction checks

`node scripts/verify-maptiler.mjs` loads the existing environment with Expo's
loader in silent mode. It keeps resource URLs/bodies in memory, requests only
HTTPS MapTiler resources without following redirects, and prints only labels,
HTTP statuses, byte counts and attribution-presence booleans. It samples public
Chandigarh tiles rather than reading private archive coordinates. It is a bounded
verification tool, not a tile downloader or native-rendering test.

Host results: Streets V4 style HTTP 200, style version 8, 164 layers; all four
sprite sets' JSON/PNG at 1x and 2x HTTP 200; all nine static font stacks' Latin
glyph ranges HTTP 200; vector TileJSON HTTP 200; sample tiles at zoom 8, 11 and
14 HTTP 200. Both sources contain MapTiler and OpenStreetMap attribution.
These confirm resource availability, not Android support for every expression,
script, symbol or visual label at those zoom levels.

The installed Samsung standalone build's actual MapLibre HTTP request was observed
with a disposable, same-signer instrumentation helper. A single public keyless
request through its installed native HTTP implementation produced this header:

```text
com.tripmemoryvault.app/0.1.0 (1) MapLibre Android/13.6.1 (c7506d6) Android/36 (arm64-v8a)
```

This is a runtime observation of the constructed outgoing request, corroborated
by the pinned library bytecode, not a guessed SDK default. That phone request
failed at the network layer; server receipt was not established. No keys were
passed to the helper, and it captured neither URLs nor response bodies. The helper
was removed after checking; the main app and vault were preserved.

The separate React Native no-cache style probe now explicitly sends
`com.tripmemoryvault.app/basemap-probe`. Otherwise, restricting the key for native
MapLibre could reject the independent probe and incorrectly force local fallback.
Its final on-device header/response still needs verification in the new build.

Use `com.tripmemoryvault.app` as the case-sensitive **Allowed User-Agent** substring
for this Android key. Native apps should have a separate key from browser clients;
combining HTTP-origin and User-Agent rules requires both to match. See MapTiler's
[key guide](https://docs.maptiler.com/guides/credentials/api-key/) and
[restriction semantics](https://docs.maptiler.com/cloud/admin-api/api-keys/).
Host requests with the app probe header **and an unrelated negative-control header
both returned HTTP 200**, without Origin/Referer. The key is valid but these checks
do not demonstrate an app-specific restriction. Account settings were not inspected
or modified; configure the restriction and repeat host/native verification before
distribution. Public mobile keys remain extractable from the application bundle.

### Android and remaining verification

Samsung SM-S921E, serial RZCY8121TTB, Android 16/API 36, ARM64 was connected.
The old standalone APK opened the existing synthetic multi-stop map and retained
its four mapped Stops/one photo. This is baseline evidence only: it is the previous
OpenFreeMap build. No new Trip Memory Vault APK was installed, no restore/reset
was performed and no connectivity settings were changed (initial Wi-Fi off,
mobile data on). ADB reverse had no mappings.

The new signed release build bundled all JavaScript and 44 assets, then Windows
Device Guard blocked the pinned compiler executable:

```text
.pnpm/hermes-compiler@250829098.0.17/node_modules/hermes-compiler/hermesc/win64-bin/hermesc.exe
```

`:app:createBundleReleaseJsAndAssets` exited 4551; Gradle reported BUILD FAILED.
The compiler was not relocated or bypassed, security settings were not changed,
and stale APK/AAB outputs were not presented as new artifacts. Machine-policy
approval of the executable is required before rebuilding. Sanitized evidence:
ignored `.expo/maptiler-build.log`.

| Requested check against new MapTiler standalone build | Result |
| --- | --- |
| Native style/sprites/fonts/tiles load | BLOCKED; host resources pass only |
| Road/highway/city/geographic label readability at normal zoom | NOT RUN |
| Attribution/logo layout and touch targets | NOT RUN |
| Pinch, pan, double tap, selection, stays, Fit trip and panel | NOT RUN; existing controls retained |
| Saved blue road rendering/alignment | NOT RUN on device; confirmed-geometry host tests pass |
| Offline force-stop/restart and online retry/resume recovery | NOT RUN; fallback implementation retained |
| New APK signatures, manifest and native artifact checks | BLOCKED by build failure |

TypeScript and test compilation pass with normal dependency-junction access.
All **61 relevant tests pass**, zero failures/skips: Step 7 map/V2/road-route,
Step 11 map/camera and Android release/configuration/signature tests.
`git diff --check` passes. The sandbox-only TypeScript attempt could not resolve
some installed dependency junctions; the outside-sandbox rerun passed without
source/dependency changes. No commit/push, SDK replacement, schema change,
backend, authentication or cloud synchronization was added in this task.

Remaining blockers: permit Hermes through the machine's security policy, rebuild
and verify/install in place with signer matching, then execute the new-build
physical visual/gesture/online/offline matrix. Key restriction needs configuration
and retesting. The pre-existing archive-restore SQLite SIGABRT remains a separate
release blocker and was not exercised or repaired.

**FAIL — MAPTILER BASEMAP BLOCKED**

### Successful build retry and Samsung verification — 12 October 2026

**This supersedes the blocked-build/native-verification status above.** After the
owner requested a retry, Hermes executed successfully. The first signed retry
completed in 3m 48s. Physical inspection found the default MapLibre wordmark behind
the new credits; `logo={false}` removes that redundant wordmark while retaining
native attribution and the visible MapTiler/OpenStreetMap credits. The final
signed APK/AAB rebuild completed in **2m 40s**.

The final AAB's **1,406 payload entries** pass cryptographic verification against
the existing independently exported upload certificate. Bundletool, release
manifest checks, four-ABI library inspection and 64-bit 16 KiB alignment checks
pass. APK signature and `zipalign -c -P 16 4` pass. Package remains
`com.tripmemoryvault.app`, version 0.1.0 (1), minSdk 24/targetSdk 36, with only
INTERNET, ACCESS_NETWORK_STATE and the package signature-receiver permission.
APK/AAB contain identical **3,328,328-byte Hermes bytecode**, the MapTiler style
configuration and all eleven numbered-marker assets. No environment/key value
was printed by the artifact checks.

| Final artifact | SHA-256 |
| --- | --- |
| APK, 155,972,999 bytes | `4EB9BCCC8B97B64A7BEAB01458C76370590625564E0D61E76EC0177A31132B25` |
| AAB, 92,385,839 bytes | `311F714183528B5458FC6EE8C6547B12D64B4AA42B51247F5452CF777671069A` |

The installed Samsung SM-S921E APK's signer matched before `adb install -r`.
The final standalone build was installed in place, preserving the existing vault
and synthetic fixtures. No Metro or ADB reverse was needed. The existing synthetic
multi-stop trip still has four mapped Stop occurrences, an unknown-location Stop,
a repeated Place/stay and one associated photo.

An ignored, temporary same-signer instrumentation helper observed the actual
MapLibre and React Native HTTP paths in the final standalone app. It recorded
only resource categories, status codes and User-Agent headers, not request URLs,
keys, response bodies or private coordinates. **Native style, TileJSON, sprites,
glyphs and newly requested vector tiles all returned HTTP 200.** The independent
React Native style probe also returned HTTP 200 with
`com.tripmemoryvault.app/basemap-probe`. The native User-Agent exactly matches the
measured value above. Both support the `com.tripmemoryvault.app` restriction
substring. The helper was removed after verification.

| Final-build physical check | Result |
| --- | --- |
| Regional zoom 8 | PASS: Chandigarh, Shimla, Solan, Kasauli, towns, major roads, rivers and terrain/land context are readable |
| City zoom 11 | PASS: street network, Chandigarh sector/locality labels, lake and Purv Marg are readable |
| Street zoom 14 | PASS: Udyog Path, Himalaya Marg, local streets, buildings, parks and POI sprites are readable |
| Attribution | PASS: official logo and linked copyright texts visible; native attribution icon accessible; Fit trip unobscured |
| Selection and panel | PASS: numbered selection, stay marker, lodging, approximate dates, private test note and photo count remain local and accessible |
| Pinch in/out, pan, double tap, Fit trip | PASS: owner explicitly confirmed all four on the final Samsung build; camera/selection and Fit also exercised during automation |
| Offline restart | PASS: Wi-Fi/mobile data disabled, force-stop and standalone relaunch; explicit Natural Earth fallback, local numbered Stops and dashed sequence remain visible |
| Offline Stop/stay access | PASS: existing stay selection, guesthouse, check-in/out uncertainty, test note and associated-photo count available |
| Online recovery | PASS: restored connectivity, Retry basemap returns detailed Streets V4; Fit trip restores overview and collapses selection |

The offline test restored its initial Wi-Fi-off/mobile-data-on settings in
`finally`. Later user activity changed connectivity; subsequent checks leave those
new settings alone. The obsolete UI Automator pinch helper failed on Android 16
with missing `android.test.RepetitiveTest`; its misleading trailing “OK” was not
counted as success. Gesture acceptance is the owner's separate real-touch report.

Native style warnings are understood limitations of the pinned renderer: the
provider's attribution-only vector source has no tiles/URL, and some label layers
use unsupported `text-overlap`/`icon-overlap` properties (mostly `never`, plus an
airport-gate cooperative expression at zoom 18). The actual Planet V4 TileJSON
and tiles load successfully. The zoom 8/11/14 captures demonstrate readable
roads/geographic labels despite these warnings. No logger suppression, SDK
replacement or provider-style rewrite was introduced. Airport-gate behavior at
zoom 18 and every language/world region are not verified by these samples.

A final standalone cold launch reopened the same trip and detailed map. Its
fresh process logs contain no credential, fatal native signal or JavaScript
error; the style warnings above remain. Android exit history identifies the
prior closed sessions as user removal/instrumentation stops and one background
low-memory termination, not a new native crash. This scoped verification does
not resolve the separate historical archive-restore or Fabric investigations.

Confirmed saved geometry retains the solid blue stroke/light casing; host tests
cover current/stale geometry, persistence, camera bounds, gaps and provenance.
This device fixture has **no confirmed road-provider geometry**: its dashed
sequence is deliberately not relabeled as a road route. No live ORS result or
on-device blue-road alignment pass is claimed. That pre-existing routing-provider
acceptance gate remains separate from the now verified basemap.

Final TypeScript and `git diff --check` pass; the 61 relevant map/road-route/global
map/release tests and test compilation passed in this task. Evidence is under
ignored `.expo/maptiler-*` and `.expo/map-v2-physical-maptiler-*`, including
final native HTTP observations, zoom screenshots and offline/recovery captures.
The earlier build-policy blocker is resolved. Key restriction is still an owner
configuration follow-up: the negative-control host request was accepted, and no
account security setting was modified. The archive-restore SQLite SIGABRT and
live ORS acceptance remain separate release gates. No destructive restore,
vault reset, commit or push was performed.

**PASS — MAPTILER BASEMAP VERIFIED**

### User-Agent restriction verification — 13 October 2026

This check targets **Samsung SM-M146B / RZCW3261ZBJ**, Android 15/API 35,
ARM64. It is a different phone from the 12 October SM-S921E. The owner reports
the development key now allows User-Agent substring `com.tripmemoryvault.app`
with HTTP Origins empty. Account settings were not edited during this check.

The package was absent for Android user 0, including retained/uninstalled-package
inspection. The existing final signed Streets V4 APK was verified and installed
using serial-scoped `adb install -r`; no full application rebuild was needed.
APK signature against the exported upload certificate, ZIP alignment, permissions,
Hermes bundle, marker assets and native libraries passed the existing verifier.
The installed device APK's SHA-256 matches both the host artifact and the prior
documented final release:
`4EB9BCCC8B97B64A7BEAB01458C76370590625564E0D61E76EC0177A31132B25`.
Artifact: `android/app/build/outputs/apk/release/app-release.apk`, version 0.1.0 (1).
The bundled style configuration also matches the local environment in memory;
no credential was printed.

The newly installed app showed an empty vault. One explicitly synthetic trip,
`TEST-MapTiler-UA-Verification`, was created through the app UI with unknown dates,
no Stops and no photos. It remains on the phone. No real travel history, routes,
locations or media metadata were created or changed. Camera-only public Chandigarh
viewports were used for map inspection; they were not saved as Places or visits.

A disposable same-signer instrumentation helper observed the installed native
HTTP implementation's outgoing User-Agent and response/cache metadata. It did not
rewrite the User-Agent or log URLs, keys, response bodies or archive coordinates.
The actual header on this phone is:

```text
com.tripmemoryvault.app/0.1.0 (1) MapLibre Android/13.6.1 (c7506d6) Android/35 (arm64-v8a)
```

| Request | Observed result |
| --- | --- |
| Native Streets V4 style | HTTP 200; network=true, cache=false |
| Native TileJSON | HTTP 200; network=true, cache=false |
| Native sprites | HTTP 200; network=true, cache=false |
| Native glyphs | HTTP 200; network=true, cache=false |
| Native vector tiles | HTTP 200; network=true, cache=false |
| React Native style probe | HTTP 200; `com.tripmemoryvault.app/basemap-probe` |
| Host app-probe positive control | HTTP 200; no Origin/Referer |
| Host unrelated-User-Agent negative control | HTTP 403; no Origin/Referer |

These are new network responses on this Samsung, not the prior phone's results
or a cache-only visual pass. The host controls use the same configured key as the
installed bundle. They demonstrate restriction enforcement in addition to native
compatibility. No device API-key denial was observed during the connected capture.

Regional/city/street zooms 8/11/14 show roads, geographic labels, buildings and POI
symbols, with visible MapTiler/OpenStreetMap credits. Examples include Shimla,
Ambala, Chandigarh localities/sectors, Purv Marg, Jan Marg and Udyog Path.
The intentional no-Stops explanation overlays the centre of this empty test trip.
Native injected pan changed the camera centre; double tap changed zoom 14 to 15.
Synthetic two-pointer pinch injection left zoom at 14 in both directions, so
**pinch is not verified on this phone**. This is not converted into a gesture pass.

Offline force-stop/relaunch preserved the named local trip and displayed the
explicit Natural Earth overview. The first recovery attempt preceded a working
network, and a later attempt coincided with another network loss: Android reported
no active default network and could not resolve `api.maptiler.com`. These failed
retries are not evidence of key rejection. Both Wi-Fi and mobile-data settings
were restored to enabled in `finally`; the temporary helper was uninstalled, and
the main package/data remained installed. After the owner established a stable
connection, bringing the standalone app back to the foreground restored the
**Detailed basemap** automatically, with the same local test trip preserved.
**Online recovery on app resume: PASS.** Earlier retries while connectivity was
unavailable are retained as failed attempts, not misreported as successful retry
button checks. A final capture taken while Android Settings was foreground was
discarded as an invalid app-state observation before the successful app-resume check.

Current-process logs contain no credential, fatal native signal or matching
JavaScript error in the inspected sessions. The previously documented provider
style compatibility warnings remain (`source must have tiles`, unsupported
`text-overlap`/`icon-overlap`). This check does not resolve the separate archive
restore SQLite SIGABRT, historical Fabric investigation or live ORS acceptance.
No destructive restore, reset, main-app uninstall, commit or push was performed.

Sanitized evidence: ignored `.expo/maptiler-restriction-native-connected.log`,
`.expo/maptiler-restriction-host.log`, `.expo/maptiler-restriction-gestures.log`,
`.expo/maptiler-restriction-runtime.log`, `.expo/maptiler-restriction-z*.png`,
and `.expo/map-v2-physical-restriction-*.xml/png`.
Final standalone recovery evidence is in
`.expo/maptiler-restriction-recovery-final.log` and
`.expo/map-v2-physical-restriction-resume.xml` /
`.expo/map-v2-physical-restriction-online-recovery-final.png`.

**PASS — MAPTILER KEY RESTRICTION VERIFIED**

No key-restriction blocker remains for this Android build/device. Real-touch
pinch verification and the separate historical release gates above remain outside
this scoped pass. No application source change or full rebuild was required;
`git diff --check` passes. **READY FOR NEXT STEP** for the key-restriction check.

## OpenRouteService credential setup — Step 1 — 13 October 2026

This step adds secure, owner-supplied credential setup only. It does **not** add
an HTTP routing transport, enable live route generation, change the existing road
route UI, or send any Stop/via coordinates. `configuredRoutingProvider` remains
the setup-required provider. The separate MapTiler Streets V4 key configuration
and restriction are unchanged.

### Device-owner setup

1. Create or sign in to an account at <https://account.heigit.org/> and obtain an
   OpenRouteService API key. Trip Memory Vault does not distribute or share a key.
2. Open **Settings → Routing** in Trip Memory Vault.
3. Paste the complete key into the masked **API key** field. **Show/Hide** affects
   only the current editing buffer.
4. Tap **Save key**. A successful write clears the editing field and displays
   **Connected**. This state means only that a valid-looking key is stored; this
   step does not contact HeiGIT or verify the key over the network.
5. Use **Clear key** to remove the credential from secure device storage. Existing
   locally saved road geometry is not removed.

Input is trimmed at its outer edges. Empty, shorter-than-16-character,
longer-than-8,192-character, whitespace-containing, and control-character values
are rejected. The validator deliberately does not require a particular token
encoding, so current opaque keys and JWT-shaped HeiGIT keys are accepted.

### Storage and leak boundary

The compatible Expo SDK 57 module `expo-secure-store` 57.0.4 stores the credential
under `tripmemoryvault.routing.openrouteservice.api-key.v1`, using the dedicated
Android Keystore alias `tripmemoryvault.routing.openrouteservice.v1`. On Android,
SecureStore encrypts the value with a key held by Android Keystore; only encrypted
application-private preference data is persisted. User authentication is not
required for each read so a future explicitly initiated request can access the key
after a normal process restart.

`android.allowBackup` and the native manifest's `android:allowBackup` remain
`false`. The SecureStore config plugin also retains its Android backup exclusion
configuration for any future regenerated native project. Restoring encrypted
preferences without their non-exportable Keystore key is therefore not part of
the supported backup path.

The credential store has no database or archive dependency. The key is not written
to SQLite, portable JSON, GeoJSON, the readable journal, exports, an
`EXPO_PUBLIC_*` variable, logs, crash reports, source, or telemetry. It is not
embedded in the APK. Only the non-secret storage item name and Keystore alias are
part of application code. Errors are reduced to credential-free messages; native
error text is not surfaced. The routing settings screen never reads the saved key
back into the visible editing field.

### Limitations and next gate

**Connected is local storage state, not provider authentication.** Key validity,
quota, network reachability, Indian road coverage, routing accuracy, and provider
terms are not tested in this step. Saving a key performs no network request.

Future live routing must remain an explicit user action. Before each request, the
existing disclosure/confirmation flow must name OpenRouteService / HeiGIT and say
that the selected Stop coordinates and ordered via-point coordinates will leave
the device. It must not send photos, notes, trip titles, unrelated Stops, or other
archive data, and it must never run on map open, app launch, connectivity recovery,
or key save. Provider personal-data terms remain an owner/product acceptance gate.

The pre-existing archive-restore SQLite SIGABRT remains a separate release blocker.
No destructive restore or vault reset is part of this credential step.

### Step 1 verification

TypeScript and 27 focused credential/archive/Settings/release tests pass. Coverage
includes save, a new store instance reading after simulated restart, idempotent
clear, empty/malformed/JWT-shaped validation, redacted storage failures, absence
of application logging, and a real portable export plus every SQLite table being
free of the synthetic credential. `git diff --check` passes.

The final signed APK/AAB build completed in 2m 37s after explicitly removing
SecureStore's unused `USE_BIOMETRIC` and `USE_FINGERPRINT` declarations. The final
manifest still has only INTERNET, ACCESS_NETWORK_STATE and the package signature
receiver permission. Bundletool, all 1,419 signed AAB payloads, four ABI sets,
64-bit 16 KiB alignment, APK signature/ZIP alignment, and equality with the
already-installed package signer pass.

| Final artifact | SHA-256 |
| --- | --- |
| APK, 156,146,175 bytes | `7127A01415C4582C2A01D5FBE69F090837D9A1DAB06ECD34C27B244429D03E0D` |
| AAB, 92,487,648 bytes | `9CF5B66D1ED7A19C1650D1E29111E030AEA9BCB28B71ACA0FDB10AA51052246E` |

The APK was installed with `adb install -r` on Samsung SM-M146B,
`RZCW3261ZBJ`, Android 15. No uninstall, data clear, reset, or archive restore was
performed. The existing `TEST-MapTiler-UA-Verification` trip remained visible.
The installed Routing screen passed Not configured, masked-input, Show/Hide,
account-link, disclosure, synthetic Save → Connected, cold-restart persistence,
Clear, and second-restart Not configured checks. The synthetic key was removed.
It did not appear in the app process log; Android's ADB daemon recorded the test
runner's own `input text` command, which is test infrastructure rather than an
application log path. The release Hermes/source scan contains no ORS public
environment variable or synthetic credential.

**PASS — ROUTING CREDENTIAL SETUP READY**

## Live ORS road preview — 14 October 2026

The routing editor now reads the owner-supplied OpenRouteService credential from
SecureStore at request time and sends an explicit, user-confirmed `POST` to
`https://api.heigit.org/openrouteservice/v2/directions/driving-car`. Authentication
uses only the `Authorization` header. The key is not placed in a URL, query
parameter, source file, application log, SQLite, archive, or export.

The standard ORS JSON response is accepted. Its encoded route polyline is decoded
to GeoJSON `[longitude, latitude]` coordinates and passed through the existing
geometry, endpoint, ordering, and distance validation before it can be rendered.
Invalid credentials, rate limits, network failures, no-route responses, malformed
JSON, and malformed geometry produce credential-free user messages. A missing
credential directs the owner to **Settings → Routing**.

Generated ORS geometry remains a temporary in-memory proposal. The road-review UI
has no action that can confirm or persist newly generated geometry in this
milestone. Closing the review or process discards it, and portable exports remain
unchanged. Existing confirmed road rows are read and preserved; they are not
overwritten. The disclosure shown immediately before generation names
OpenRouteService / HeiGIT, identifies the selected Stop and via-point coordinates
that leave the device, and states that photos, notes, and trip titles stay local.

### Live public-sample results

The final release APK was installed in place with `adb install -r` on Samsung
SM-M146B (`RZCW3261ZBJ`), Android 15. The existing vault and SecureStore item
survived the update; **Settings → Routing** reported **Connected**. The app was
force-stopped and launched from its installed launcher activity without Metro.
No uninstall, data clear, vault reset, or archive restore was performed.

Only the explicitly approved public samples below were sent. No private saved
Trip coordinates were used.

| Public sample | HTTP/result | Decoded coordinates | Provider distance |
| --- | --- | ---: | ---: |
| Heidelberg example | 2xx success, valid preview | 26 | 1.4 km |
| Jalandhar → Shimla | 2xx success, valid preview | 4,650 | 257.8 km |
| Shimla → Sangla | 2xx success, valid preview | 5,578 | 217.0 km |
| Sangla → Chitkul | 2xx success, valid preview | 696 | 23.9 km |

The app deliberately does not log response bodies, headers, or credentials; the
exact 2xx status code is therefore not retained. Each preview can exist only after
the transport has accepted a successful HTTP status and the response parser and
geometry validators have completed.

On MapTiler Streets V4, the Jalandhar–Shimla preview visibly followed the winding
mapped road corridor rather than the dashed stop-to-stop fallback. Both mountain
segments were supported by the provider and rendered as solid amber road-following
geometry. Fit Trip included all preview geometry, and selecting the Jalandhar
marker above the preview changed its marker state and focused the camera without
removing the route. Pan, zoom, header, stays/stops, and the bottom sheet remained
operational. No native crash or credential-related log output was observed.

Provider retention, reuse, and personal-data terms still require product-owner
confirmation before generated geometry may be persisted, archived, or exported.
The separate archive-restore SQLite SIGABRT remains unresolved and no destructive
restore test was run.

**PASS — LIVE ORS PREVIEW VERIFIED**

**READY FOR NEXT STEP**

## Arbitrary photo memory pins — 18 October 2026

This section supersedes the earlier deferral of arbitrary photo/memory points.
Long-press any map coordinate to open **Add photo memory here** with latitude and
longitude. Choose from existing imported vault media (60-row keyset pages), add
an optional note and explicitly save. Selection never invokes the system importer,
copies an original, creates TripMedia, or alters source evidence/corrections.
Coordinates are manual associations, not confirmed visits or capture locations.
No Stop, Place, route geometry, GPS permission or location inference is involved.

Migration **12**, `photo_memory_pins`, stores stable vault/trip/media ownership,
coordinates, note and audit/tombstone timestamps. Composite foreign keys, live
parent guards and coordinate/note constraints protect writes. Trip trash hides
pins through the parent without changing their independent deletion state.
Deleting a pin retains Media and every other placement. Live pins protect Media
from trash, and references prevent physical deletion. The existing explicit vault
reset deletion order includes pins; no reset was used during device testing.

Local thumbnail markers render above the existing MapTiler/route layers and are
included in Fit trip. Native `Marker.onPress` opens the thumbnail, note and display
photo viewer. Edit can change the photo/note; Reposition returns to the map for a
second deliberate long-press and Save. Cancel/navigation protects unsaved edits.
The Photo memories list also exposes overlapping pins and works if rendering fails.
Identical coordinates are allowed. Photos remain separate from numbered Stops,
visited-place statistics and route generation. Native view markers are used for
photo thumbnails; very large pin collections have not been performance-qualified.

Offline cold launch reads SQLite and app-owned derivatives, retaining markers,
notes and viewer on the bundled overview. Detailed offline streets are not
promised. Missing previews use placeholders and the existing repair worker.
Portable **v3** exports pin records, manual Point features and readable journal
entries. Shared media is exported once; v1/v2 restores create no invented pins.
Hosted ORS preview behavior and the prohibition on saving new hosted ORS geometry
are unchanged. No new dependencies or permissions were added.

### Verification

- TypeScript and **128 relevant host tests** pass: database/migrations, media,
  Trip Map/road routes, global map, archives, maintenance and routing privacy.
  Tests include zero/pole/dateline coordinates, invalid values, ownership,
  deleted parents, duplicate coordinates, stale editors, pagination, reopen,
  immutable evidence, media retention, v1/v2 compatibility and v3 round trips.
- Signed release APK/AAB build passed (879 Gradle tasks; final build 3m 24s).
  The existing artifact verifier passed with the locally installed bundletool:
  signatures, manifest restrictions, four ABI sets and 16 KiB 64-bit alignment.
  The initial wrapper lacked `TMV_BUNDLETOOL_JAR`; running its verifier with
  `.expo/bundletool-all-1.18.1.jar` completed those checks successfully.
- Samsung **SM-M146B / RZCW3261ZBJ / Android 15**: matching-signer `adb install -r`,
  long-press coordinate, empty-vault photo chooser, imported-photo selection,
  explicit save, thumbnail marker, marker tap, note, viewer, edit/reposition,
  accessible list, cold offline relaunch and pin removal all passed. Native
  `Marker.onPress` fixed the nested Pressable tap failure found on the first build;
  the corrected build was installed and retested.
- The test used an imported screenshot of this session's synthetic
  `TEST-MapTiler-UA-Verification` map. Android's picker selected that screenshot
  rather than the separately staged rectangle fixture; no personal imagery was
  selected. The test pin was removed afterward, and the photo still opened from
  the existing gallery. The four mapped Stops remained unchanged.
- Wi-Fi and mobile data were disabled for the release cold-launch check, then
  restored to their original enabled states. No Metro was required. Local
  thumbnail, moved coordinate, edited note and full display image reopened offline.
- Android exported and verified a v3 package through the system folder picker.
  That exact package was inspected and restored into **isolated host SQLite**:
  pin ID, coordinate, note, Media reference and original checksum matched;
  SQLite integrity and foreign keys passed. A native restore into the phone's
  populated vault was not attempted. Existing vault data was never cleared.
- Inspected app-process logs contained no fatal exception, native fatal signal
  or React Native JavaScript error. `git diff --check` passes. No commit or push.

Ignored evidence is under `.expo/photo-memory-*`, including host logs, build and
artifact logs, Samsung screenshots/UI dumps and the device-produced archive.
The phone retains the imported test screenshot and the verification export in
`TMV-Pin-Verification-18Oct`; its test pin is tombstoned. Existing content is intact.

### Files changed

| Area | Files |
| --- | --- |
| Map interaction, picker, markers and viewer | `src/features/map/TripMapScreen.tsx`, `src/features/map/PhotoMemories.tsx`, `src/features/map/useTripMap.ts` |
| Pin validation and SQLite repository | `src/features/map/photo-memory-model.ts`, `src/features/map/photo-memory-repository.ts` |
| Forward migration and repository wiring | `src/core/database/migrations/0012-photo-memory-pins.ts`, `src/core/database/migrate.ts`, `src/core/database/open.ts` |
| Reference-safe explicit reset order | `src/features/settings/reset-database.ts` |
| Portable v3 writer, validator, journal, GeoJSON and restore | `src/services/archive/portable.ts` |
| Focused tests and current-version expectations | `tests/step7/photo-memory-pins.test.mjs`, `tests/step7/road-routes.test.mjs`, `tests/step12/archive.test.mjs`, `tests/step1/database.test.mjs`, `tsconfig.tests.json` |
| Architecture and compatibility documentation | `docs/architecture.md`, `docs/portable-vault.md`, `docs/trip-map-v2.md` |

No remaining blocker was found for this scoped feature. Limits: pin collection
scale and native restore of a pin-bearing package on the Samsung were not tested;
the actual Samsung export was restored with real SQLite/files on the host instead.

**PASS — MAP MEMORY PINS VERIFIED**

**READY FOR NEXT STEP**

## Road route workflow — 19 October 2026

### Cause and scoped fix

The ORS transport and SecureStore credential were already wired to the road
editor. Normal map entry intentionally made no routing request, and the earlier
live checks produced temporary proposals, not saved road rows. The primary
**Route** action opened the Stop editor; road generation was a separate secondary
action. More importantly, road proposals belonged to a conditionally mounted
`RoadRouteEditor`: closing review explicitly cleared parent previews, then editor
cleanup discarded every session and published an empty preview. The legend also
selected “Stops only” from saved rows alone even while preview geometry existed.
Any successful segment suppressed all approximate links, hiding failed legs.

**Generate road route** is now a primary action above the main map. It opens the
existing review editor. **Generate all segments** still requires the explicit
ORS/HeiGIT coordinate disclosure and confirmation, then requests adjacent Stop
pairs sequentially in canonical order using the existing provider/SecureStore
boundary. Cancel sends nothing. Unknown/unconfirmed Stops remain gaps; photo pins
are never routing inputs. **Edit Stops** separately names the former Route action.

The editor stays mounted while hidden. Hide/reopen review, numbered Stop selection,
the Stops panel, sheet expansion/collapse, Fit trip and photo-memory modals retain
the in-memory session. Changed Stop inputs replace the editor session and stale
previews are filtered before display. Discard is a separate explicit editor action;
leaving the map/process discards temporary geometry. No new persistence, route
auto-generation, migration, dependency, credential handling or export path is added.

Both saved suggestions and temporary previews use solid blue MapLibre lines with
light contrasting casing below numbered Stop layers and native photo markers.
Preview geometry replaces only the corresponding saved segment in the display.
Uncovered segments retain dashed lines labeled **approximate Stop connections**.
The legend counts covered road segments and explicitly identifies temporary,
unsaved previews and unverified historical roads. Full provider vertices still
participate in Fit trip. Existing migration 12, portable v3 and photo rendering
remain intact. Provider storage permissions remain unresolved: new ORS geometry
cannot be saved, archived or exported.

### Verification evidence

- TypeScript passes. **150 relevant host tests pass** across database/migrations,
  Stop routing, media, Trip Map/road routing/photo pins, global map, archives,
  search, credential privacy and release checks. Added cases exercise ordered
  full-trip generation, partial failures, per-leg fallback, retry, saved/preview
  precedence, stale coordinates and absence of preview rows in SQLite/export.
  The Step 3 table-list expectation was missing the existing migration-12 table;
  it now includes `photo_memory_pins`. No production schema change was needed.
- The release JDK test initially failed inside the filesystem sandbox while
  creating its disposable JAR. The release suite and final combined run pass with
  the required filesystem access. No failing test was skipped.
- Signed APK/AAB build passed (879 tasks, 3m 53s). Bundletool, expected signer,
  all 1,419 signed payloads, four ABIs, 16 KiB alignment for 64-bit native libraries,
  APK ZIP alignment and restricted manifest permissions passed. The installed APK
  was copied aside and its signer matched before `adb install -r`.
- Samsung **SM-M146B / RZCW3261ZBJ / Android 15**, installed standalone release,
  existing **TEST-MapTiler-UA-Verification** trip, four unchanged Stops and one
  existing imported synthetic screenshot. No Metro, uninstall, data clear,
  vault reset or native archive restore was used.
- Main-map entry shows labeled dashed approximation and the primary generation
  action. Cancelling the ORS disclosure leaves 0/3 previews. Explicit confirmation
  produced the following real provider results through the current SecureStore key:

| Ordered segment | Geometry points | Provider distance |
| --- | ---: | ---: |
| Jalandhar → Shimla | 4,650 | 257.8 km |
| Shimla → Sangla | 5,578 | 217.0 km |
| Sangla → Chitkul | 696 | 23.9 km |

These are successful validated provider responses, not fixture lines. The exact
HTTP success code is not retained; no credential, response body or geometry file
is logged. The map renders the full route in blue with a contrasting casing.
Hide/reopen review, Stops, native Jalandhar marker selection, bottom-sheet
expansion/collapse, photo-memory sheet and Fit trip retained **3/3** geometry.
The point counts and distances were read from the existing review UI.

A disposable **TEST-Road-Workflow-19Oct** photo pin reused the existing screenshot.
Its local thumbnail rendered above the route; native marker selection opened its
note and photo viewer, and closing the modal retained the route. Disabling both
radios and resuming the app showed **Offline overview** with all three in-memory
road segments and the thumbnail intact. Explicitly regenerating just Sangla →
Chitkul offline produced a credential-free network error and Retry segment;
the other two road segments remained blue and only the failed leg reverted to
the labeled dashed approximation. A subsequent offline force-stop/cold launch
showed the dashed Stop sequence and the saved photo pin, confirming that new road
geometry was not persisted or automatically regenerated.

The saved pin's full photo also opened after the offline cold launch. Wi-Fi and
mobile data were restored to their original enabled states in `finally`. The
disposable pin was removed through its normal confirmation UI; the original photo
and four Stops remain. Online basemap recovery and a fresh explicitly confirmed
3/3 generation passed. Sangla selection retained the complete preview, and the
phone was left on the main map with Fit trip and the complete blue route visible.
Current-process logs contain no matching native fatal signal, fatal exception or
React Native JavaScript error; process-exit history shows only the planned package
update and force-stop in this run. These scoped checks do not resolve the separate
historical native archive-restore blocker, and no populated-vault restore was run.

| Final artifact | SHA-256 |
| --- | --- |
| APK | `8B591E305D3BC2C8ABF7B404C6FFA334CAA5C9CDD972DD25B6C3A80592AF5047` |
| AAB | `450D6D6A3BA36B8CA214F31C2AEC5ED3D001E169823D4A8307C4C124BD2E0EAB` |

Changed files: `src/features/map/TripMapScreen.tsx`,
`src/features/road-route/RoadRouteEditor.tsx`,
`src/features/road-route/model.ts`, `tests/step7/road-routes.test.mjs`,
`tests/step3/route.test.mjs`, and this document.

Ignored evidence is under `.expo/road-workflow-*`: `final.png/xml`,
`fit-retained.png`, `consent.png/xml`, `segment1.xml` through `segment3.xml`,
`marker-selected.png/xml`, `sangla-selected.png/xml`, `pin-saved.png/xml`,
`offline-retained.png/xml`, `offline-error.png/xml`, `offline-cold.png/xml`,
`offline-photo.png`, `regression-final.log`, `build.log`, `runtime.log` and
`exit-info-final.log`. `git diff --check` passes. No commit or push.

**PASS — ROAD ROUTE WORKFLOW VERIFIED**

**READY FOR NEXT STEP**
