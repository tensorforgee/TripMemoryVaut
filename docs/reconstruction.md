# Step 6: reconstruction suggestions

`architecture.md` is authoritative. Suggestions are persisted interpretations,
not canonical trip history. No AI, geocoding, network requests or inferred place
names are used. Original bytes and source metadata are never updated.

## Model and inputs

Migration 6 adds only `draft_suggestions`. Run rows contain immutable photo input
snapshots, exclusion decisions and the complete versioned parameter set. Child
section/location rows contain immutable evidence plus editable labels/membership,
state and accepted canonical IDs. Composite FKs enforce trip/vault/run ownership.
Resolved rows remain historical records. Trip trash hides them via parent checks;
no permanent cleanup is implemented.

Migration 7 repairs the initial reconstruction Place provenance shape to the
existing `{note}` contract, retaining the full original provenance inside the
note. It targets only matching accepted version 1 suggestions; Media evidence
is untouched. New Places use the valid contract from creation.

Inputs are active imported TripMedia placements, source capture/GPS, parser
version and explicit Media corrections. Clear overrides stay clear. Import and
filesystem timestamps are not capture evidence. All active imported photos in
the trip are the initial selection; review can exclude individual members from a
suggestion. Snapshot IDs and original evidence remain available after exclusion.

## Version 2 rules

- Validate calendar capture values, offsets within ±14 hours, and years 1800–2100.
  Invalid/missing dates stay in the Date unknown list.
- Separate each explicit UTC offset and the floating-time bucket. Compare known
  instants within offset buckets; floating times compare wall clocks only and
  are flagged tentative. Never use the phone's timezone. Floating clocks can
  disagree; no device identity or timezone is inferred.
- Within each bucket, stable timestamp/placement-ID order forms sections with
  at most six hours between adjacent captures. Sections can cross midnight;
  multi-day gaps remain gaps. Date labels are photo bounds, not travel dates.
- GPS clusters are chronological and contiguous, at most 250 metres between any
  pair, with at most two hours between captures. Missing GPS breaks continuity.
  A→B→A creates separate visit candidates. Representatives are actual source
  points nearest the coordinate-wise median. Untimed GPS points remain individual
  candidates with no inferred route order. Missing GPS never becomes `(0,0)`;
  an actual zero-coordinate point is flagged for review.
- An intervening capture with a different known UTC offset splits a GPS cluster,
  including when that intervening photo has no GPS. Version 1 runs and decisions
  remain stored; version 2 never rewrites them.
- Known-instant GPS jumps over 100 km at over 300 km/h (including same-time jumps)
  receive a clock/location warning. No transport mode or route is fabricated.
- Supported means relevant valid evidence; tentative means floating time, single
  point, untimed GPS, zero coordinate, parser warning or discontinuity. Wording is
  explainable evidence, never a probability or proof of physical travel.

## Review and acceptance

Review shows runs, included photos/thumbnails, unknown dates, missing GPS, time
bounds, coordinate candidates and explanations. Rename suggestions or exclude
members, save edits, then explicitly accept or reject. Group merging/splitting
and clock correction tools are deferred; canonical editors remain available.
Existing sections, Places (local search), and Stops can be explicitly selected.
Names never automatically merge objects.

One acceptance transaction creates/reuses canonical records, associates the
selected placements and records resolution. New sections have approximate photo
bounds; trip dates are untouched. New Stops require explicit Place confirmation
and confirmation to append at the end of the route. Existing canonical fields
and order remain unchanged. Conflicting assignments, stale evidence or removed
photos roll back the entire transaction. Canonical edits after acceptance stay
user-controlled; repeated acceptance returns the stored resolution.

Identical input/rule/decision snapshots reuse the run. Changed input creates a new
run and excludes members already accepted/rejected for that suggestion kind.
Older runs remain visible. Overlapping older pending suggestions cannot duplicate
accepted structure. Deleting accepted canonical objects never silently recreates
them on rerun. Resolution IDs are historical references, not deletion ownership.

## Verification

Host tests use real SQLite and synthetic evidence. They cover temporal/spatial
rules, ambiguity, missing data, repeat visits, migration constraints, immutable
snapshots, edits, rejection, transactional acceptance, explicit reuse, conflicts,
reruns, restart and isolation. Run `pnpm test:step6`; Steps 1–5 remain regression
gates. No dependencies changed. Native media decoding remains Step 5's boundary.

The synthetic runtime corpus is generated by
`tests/fixtures/reconstruction/generate.mjs` from Step 5's rectangle JPEG.
The development-only `/reconstruction-test` route imports it through the real
native pipeline and audits source evidence and rerun invariants after UI review.
Host verification: 96 tests passed across Steps 1–6, including 20 reconstruction
tests; TypeScript passed. No dependency versions changed.

Android verification used the Pixel 8 emulator (Android 17/API 37.2) and the
existing development APK. All five synthetic photos were archived through the
native pipeline: timestamp/GPS photos, a timestamp-only photo, and one with
neither. From Trip Detail, review showed the expected groups and unknown bucket.
The section was renamed Morning, the location Meadow, a section and Place/Stop
were explicitly accepted, and another location was rejected. After force-stop
and relaunch with Wi-Fi/mobile data disabled, decisions and canonical structure
persisted. The native audit verified unchanged source metadata, hashes and
overrides, and repeated reconstruction retained exactly one TripDay and one
Stop without changing their rows or photo associations.
The audit also passed with algorithm version 2 against the accepted version 1
decisions, confirming that the algorithm change did not duplicate canonical data.

The development JavaScript bundle was served over local ADB/Metro during the
offline check; standalone release cold-launch, physical devices and iOS were
not tested. Reconstruction itself uses only local evidence and SQLite.
