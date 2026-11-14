# V1 navigation foundation — 14 November 2026

Branch: `feat/navigation-polish`. Architecture sections 12–13 define the product
structure and accessibility guidance; no separate navigation/product-design
specification exists in this checkout.

## Audit and resulting navigation

Previously every destination lived in one root stack. Trips Home placed a long
menu above the actual trips, including Map, Dreams, My Travel Life, organization,
archive, Trash, and development checks. Settings was at the end of My Travel Life.
There was no tab history or explicit home anchor for cold deep links.

The existing feature screens now occupy the documented four tabs:

| Tab | Existing screen / public path | Further destinations |
| --- | --- | --- |
| Trips | TripsScreen, `/` | Create/resume Trip, Trip Details, Search |
| Map | GlobalMapScreen, `/map` | Local visited-place list/history, associated Trips |
| Dreams | DreamsScreen, `/dreams` | Existing wish form/list, Dream detail, linked Trips |
| My Life | TravelLifeScreen, `/life` | Chapters, Companions, Places, Trips, Settings in header |

Trip Details still connects to Route/Stops, Trip Map, written Travel Memories,
timeline, photos, reconstruction, organization, tags, editing and removal.
Search retains direct result navigation and all-selected-tag filtering. Settings
connects to Routing, Trash, export/restore and existing maintenance tools.
Development verification routes remain development-only and directly addressable.

Only four route entry points moved into `(tabs)`; their public URLs did not
change. Every other route remains in the root stack. Editors cover the tab bar,
preserving removal protection, modal behavior and the caller's navigation state.
Tab Back uses visit history; repeated tab selection does not add a history entry.
The root initial route inserts the shell behind cold deep links. Cold process
launches do not promise restoration of transient tab selection or unsaved Dreams
form input; existing durable Trip and Memory drafts retain their own behavior.

## Scoped visual work

Shared blue/neutral tokens, card borders/radii, typography colors, primary and
secondary actions, pressed feedback, and labeled loading indicators. Trips Home
now puts trips ahead of the old menu. Map has one clear empty state; Dreams has an
empty-state explanation. Headers retain the React implementation required by the
documented Screens 4.26.2 Android native-header crash workaround.

The tab bar accounts for the bottom inset and text scaling, hides for the
keyboard, and exposes named accessible tabs. Tab screens do not duplicate its
bottom inset. Trip detail/editor receive explicit side/bottom safe areas. Search
and Dreams support keyboard dismissal while scrolling; Settings preserves handled
taps. My Life's repeated “View all” controls have distinct accessibility labels.
No animation package, dependency, backend, authentication or schema change.

## Verification

- TypeScript and test compilation passed. Four navigation tests exercise the
  installed Expo Router's actual file discovery, route config, tab-history and
  stack reducers. All existing production destinations resolve once.
- 251 relevant checks covered navigation, migrations, Trips, Stops, timeline,
  media/HEIC, map/photo pins/roads, organization, My Life, Dreams, search/tags,
  Travel Memories, archive v1–v5, Settings and secure credentials. Initial run:
  250/251. An old Step 3 table inventory still described schema 12; its six
  missing Memory/Tag tables were added to the expectation. All 14 Step 3 tests
  then passed. No migration or production data logic was changed to fix the test.
- JDK 17 signed ARM64 Android release build and release lint gate passed; final
  build took 2m 45s. Certificate matched the installed app before `adb install -r`.
  Installation's original first-install timestamp was retained. Final installed
  build includes all visual refinements; no Metro/network is required to launch.
- Device `b0883334`, OPD2514, Android 17: all four tabs; tab history Back;
  retained unfinished Dreams input across tab switches; create/publish/edit of
  `QA Navigation Foundation Edited` with unknown dates; invalid-date Back dialog,
  keep-editing and discard-unsaved; Search → existing tagged Memory → Back with
  query retained; single/all-tag filters; Memory editor Back; Settings/Routing,
  Trash and archive screens; Chapters/Companions/Places; cold nested Memory link
  → Back to shell; Trip Map → Routing → Back retaining road-review panel;
  Route/Stops, timeline, photos, photo-memory panel and reconstruction access.
- 150% system text size: all tab labels and header actions remained readable.
  Screenshots inspected. The original 100% preference was restored.
- Standalone offline force-stop/relaunch reported `Active default network: none`.
  All tabs, saved edited Trip, local search, existing written Memory, existing
  synthetic photo and Trip Map fallback remained usable. Wi-Fi and mobile-data
  preferences were restored. Current-process JS/native error capture was empty.

Live ORS generation was not rerun: Routing reports **Not configured**. Preview
controls, disclosure and the credentials destination were verified; no key was
added and no routing request was sent. The current vault has no confirmed mapped
visits, so global-map device coverage exercised its empty state; populated
geography is covered by repository/model regressions. HEIC reimport and archive
restore into the populated phone were not performed in this navigation scope.

Ignored evidence: `.expo/navigation-qa/` (build/test logs, UI snapshots and
screenshots). The synthetic QA Trip remains for inspection. No uninstall, data
clear, reset, commit or push. SQLite migrations 1–15, FTS index 3, archive v1–v5,
media metadata, ORS preview-only rules and credential storage are unchanged.

## Files and remaining work

Routes: `app/_layout.tsx`, new `app/(tabs)/{_layout,index,map,dreams,life}.tsx`,
replacing `app/index.tsx`, `app/map.tsx`, `app/dreams/index.tsx`, `app/life/index.tsx`.
UI: `src/shared/ui/{theme,NavigationHeader}`, Trips shared UI/Home/Detail/Editor,
Dreams, TravelLife, GlobalMap, Search and Settings screens. Checks:
`tests/navigation/navigation.test.mjs`, the Step 3 inventory and `package.json`.
Docs: architecture and this report.

Remaining UX: richer trip covers, screen-specific editor/gallery polish, denser
tablet layouts, and a broader TalkBack/device matrix. This foundation does not
redesign every feature screen or introduce a global written-memory screen.

PASS — NAVIGATION FOUNDATION VERIFIED

READY FOR NEXT STEP
