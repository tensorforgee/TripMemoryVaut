# Step 10 — Dream Places

Dream Places is a local-only private wish list. It records a place the user hopes
to visit; it does not model a future Trip, itinerary, date, budget, reminder,
booking, recommendation, or social list.

## Lifecycle and identity

Creating a Dream creates a user-confirmed private `Place` identity and a
`DreamDestination` that owns the Dream note, optional user-entered context, the
actual added date, and archive history. Title and optional coordinates are Place
fields; coordinates must be a complete valid pair and remain unknown when not
entered. Duplicate titles remain distinct UUID identities and never merge.

Visible status is derived:

- **Dreaming**: no active visit link qualifies.
- **Visited**: at least one active `DreamVisit` links to a confirmed visit/stay
  Stop in a saved, live Trip.
- **Archived**: the user explicitly archives the Dream.

There is no mutable visited flag. Marking a Dream visited is an explicit choice
from existing canonical Stop/Place/Trip records. The Dream's original
`created_at`, added date, note, context, and identity remain unchanged. Removing a
visit link, Stop, or Trip changes only the derived current status; restoring a
parent recovers links affected by that parent and never resurrects a link the
user explicitly removed.

## Matching, statistics, maps, and deletion

Names, coordinates, photos, imports, and reconstruction suggestions never match
or fulfil Dreams automatically. Similar titles are not fuzzy-merged. The app
does not reverse geocode Dream coordinates or add Dream markers to Trip Map.

Travel Life continues to query canonical saved Trips and confirmed visit/stay
Stops only. Unvisited Dreams add nothing, and a visited Dream link adds no second
Trip, Place, Stop, visit, photo, or distance contribution.

Archiving or soft-removing a Dream never deletes or edits its Place, linked
Places, Stops, Trips, media, memories, or Travel Life data. Restoring restores
only the Dream and eligible links that its removal hid.

## Android runtime verification

Use an Expo development build, keep the device offline, and verify:

1. Open Dream Places and add Spiti Valley, Ladakh, Zanskar, Meghalaya, and Japan.
2. Add a note to one, edit another, force-stop, relaunch, and confirm persistence.
3. Open one Dream and explicitly choose a confirmed Place/Trip visit.
4. Confirm it moves from Dreaming to Visited without changing the Dreamed date or note.
5. Confirm Travel Life totals are unchanged by the link.
6. Archive and restore one Dream; confirm canonical Place/Trip/media data remains.
7. Review device logs for JavaScript or native crashes.

This check does not authorize creating synthetic itinerary, booking, cloud, or
automatic matching data.
