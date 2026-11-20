# Map UI polish

Branch: `feat/ui-polish-map`. Final verification completed 2026-11-21 on Android
device `b0883334` (OnePlus OPD2514). Read alongside `architecture.md`,
`navigation-foundation.md`, and `trip-map-v2.md`.

## Five highest-impact findings

1. The lifetime empty state replaced the geography entirely, and its populated
   map offered only the coarse offline style even with connectivity.
2. The Map tab had no Been/Dreaming layer controls, so wishes could not be
   explored alongside confirmed visits without conflating their meaning.
3. Place selection lacked a clear visual state and a compact, contextual path
   from a marker to its visit history or originating destination.
4. Trip Map repeated title/count information and spread controls and explanatory
   overlays across the basemap, reducing the space available for geography.
5. Road review gave secondary actions too much prominence, used small text,
   and competed with the map and bottom controls on narrow screens at 150% text.

## Changes

- `src/features/map/GlobalMapScreen.tsx`: compact lifetime header, independent
  accessible layer controls, real configured MapTiler basemap, loading/fallback
  states and retry, selected marker treatment, local place list, Fit places,
  contextual navigation, and Back to dismiss selection.
- `src/features/map/lifetime-map.ts`: presentation model that keeps Dream Places
  separate from confirmed visits and excludes fulfilled, archived and deleted
  wishes. Unknown coordinates stay unknown and remain available in the list.
- `src/features/map/TripMapScreen.tsx`: shared theme/actions, compact trip header,
  prominent Generate road route, scrollable Stops/details/review panes, readable
  route semantics, grouped Fit trip/Stops/Photo pins controls, and panel-aware
  Android Back. Empty guidance moves into the Stops pane, leaving the map clear.
- `src/features/map/PhotoMemories.tsx`: compact themed trigger and marker border;
  the photo-pin list always explains how to add another manually placed memory.
- `src/features/road-route/RoadRouteEditor.tsx`: shared controls, generation first,
  explicit session-only status, readable copy and collapsible via-point controls.
- `src/features/dreams/DreamsScreen.tsx`: correct the coordinate hint to explain
  the Dreaming layer without suggesting that a wish confirms a visit.
- `tests/step11/global-map.test.mjs`, `tsconfig.tests.json`: cover lifetime layer
  separation, unknown coordinates, zero coordinates and exclusion rules.
- This verification record.

MapLibre, MapTiler Streets V4, stop symbols, photo-memory placement, ORS transport,
road geometry sources, routing consent, and session ownership remain in place.
The road editor stays mounted when panels switch. New hosted ORS geometry is
never silently saved or exported. Existing confirmed suggestions retain their
rendering path; dashed stop connections remain explicitly approximate. No schema,
dependency, backend, authentication or sync changes.

## Device verification

The signed ARM64 APK was updated in place with `adb install -r`. Installation
reported Success; first installation time remains 2026-11-12 01:09:05.
No uninstall or application-data clearing was performed.

- Lifetime Map: actual street basemap, initial fit, Been/Dreaming individually
  and together, both-off guidance, Dreaming empty state, native star selection,
  visit selection, list equivalents, Dream destination and trip navigation.
- Trip Map: two numbered stops, destination/stay treatment, dashed approximate
  connection, native stop selection, photo thumbnail pin and memory details,
  photo list, pan and Fit trip, Stops/review switching, gallery and timeline
  navigation, header Back and Android Back.
- Road controls: explicit consent shown and cancelled; Routing displayed
  **Not configured**. A temporary synthetic via point survived switching between
  Stops and road review. Back showed the unsaved-edits guard; Keep reviewing
  retained the screen. Discard and leave followed by reopening showed zero via
  points. No routing API request was made and no new road geometry was saved.
- Offline: disabled Wi-Fi and mobile data, verified no active default network,
  force-stopped and cold-launched the app. Lifetime and Trip Map rendered their
  labelled local Natural Earth fallback with stops and photo pins. The stored
  photo memory opened offline. After reconnecting, Retry basemap restored actual
  MapTiler tiles on both maps. Wi-Fi and mobile data were restored to enabled.
- Layout: narrow 1080×1920 at density 420 (about 411 dp), 100% and 150% system
  text, plus native 3392×2400 tablet landscape. The narrow large-text review kept
  its action toolbar, scrollable content and route legend inside the viewport.
  Controls have accessible roles/state, text scales, and places/stops/pins have
  list alternatives to native marker interaction. This was not a full TalkBack
  certification or a device-wide orientation matrix.
- App-specific logcat and Android exit history showed no native/JS crash or ANR
  in the verification runs. Recorded exits were intentional force-stops and
  package updates; the intervening idle period also records an OS background kill,
  without an ANR. A MapLibre cancelled-request warning was not an app exception.
  Display size, text scale and automatic rotation were restored
  after testing.

QA fixtures remain for inspection: `QA Map Polish - synthetic` with `QA Shimla`
and `QA Chitkul` stops, `QA Dream - synthetic`, and one pin using the existing
visibly synthetic imported photo. Dates remain unknown. These are test records,
not a claim about the owner's travel. No personal trip was edited or deleted.

## Screenshots and logs

Evidence is local and ignored under `.expo/map-polish-qa/`.

| View | Before | After |
| --- | --- | --- |
| Lifetime | [Empty baseline](../.expo/map-polish-qa/before-lifetime-narrow.png) | [Both layers](../.expo/map-polish-qa/final-lifetime.png) |
| Trip Map | [Baseline controls](../.expo/map-polish-qa/before-trip-narrow.png) | [Stops and photo pin](../.expo/map-polish-qa/final-trip.png) |
| Road review | [Baseline review](../.expo/map-polish-qa/before-review-narrow.png) | [150% text](../.expo/map-polish-qa/final-review-150.png) |

The initial lifetime baseline had no confirmed mapped visits; populated after
screens use the explicit QA fixtures above. The baseline Trip screenshot uses
the earlier empty QA trip. `before-populated-trip.png` also records the new
two-stop QA trip before installation, during its initial basemap loading; it is
not evidence of a baseline rendering failure or a performance comparison.

Additional evidence: `final-trip-150.png`, `final-lifetime-150.png`,
`dream-only-final.png`, `selected-stay.png`, `final-photo-list.png`,
`final-photo-pin-150.png`, `final-consent-150.png`,
`final-routing-credential.png`, `final-via-session.png`,
`final-unsaved-guard.png`, `offline-lifetime.png`, `offline-trip.png`,
`offline-photo-pin.png`, `recovered-trip.png`, `native-lifetime.png`,
`native-trip.png`, and `native-review.png`.

## Regression results and limitations

- `pnpm typecheck`: pass.
- `pnpm exec tsc -p tsconfig.tests.json`: pass.
- `node --test tests/step7/*.test.mjs tests/step11/*.test.mjs tests/navigation/*.test.mjs tests/routing-credentials/*.test.mjs`:
  77 passed, zero failures. Covers maps, photo pins, road sessions/persistence,
  global archive/Dream Places, navigation and routing credentials.
- Android `:app:assembleRelease :app:lintVitalRelease`, ARM64: pass. Final build
  completed successfully in 2m 11s. Existing Gradle deprecation notices remain.
- `git diff --check`: pass.

Logs: `tests-final.log`, `build-final.log`, `install-final.log`,
`final-app-logcat.txt`, `final-exit-info.txt`.

Remaining credential limitation: no configured ORS key. Fresh live generation
and a newly returned ORS line were not verified on device. The existing geometry
pipeline and session-only behavior were preserved and covered by focused tests;
temporary via editing, consent, configuration navigation and discard behavior
were exercised on device. No claim of live ORS success is made.

Pre-existing untracked Trips-polish files were left untouched. No commit or push.

PASS — MAP UI POLISH VERIFIED

READY FOR NEXT STEP
