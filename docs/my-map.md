# Step 11 — global My Map

My Map is a local, read-only archive view. Its dedicated query begins with active
saved Trips and active confirmed `visit`/`stay` Stops, then joins each Stop to its
canonical active Place. Draft Trips, reconstruction suggestions, transit or
unconfirmed Stops, removed Stops, Trash, Dreams and DreamVisit rows are not query
inputs. A fulfilled Dream therefore contributes only through its already-counted
canonical Stop and cannot add a second marker.

One marker represents one Place ID. Repeated Stops at that Place remain distinct
visits, including repeats within one Trip. Visit count is the number of qualifying
Stop IDs and Trip count is the number of distinct active saved Trip IDs. Places
with the same name are not merged. The counts consequently use the same qualifying
Place definition as My Travel Life.

Coordinates are optional canonical Place data. A finite, complete, in-range pair
produces a marker under the existing Step 7 coordinate policy; missing, partial,
unusable and `(0,0)` pairs do not. Such Places remain in the archive and in the
explicit "Places without coordinates" list. My Map reports total mapped and
unmapped visited Places separately instead of reducing the Travel Life total.

Visit history uses a Stop DateSpec when present and otherwise the containing Trip
DateSpec. Day precision is displayed as `14 Sep 2026`, month as `Sep 2026`, year as
`2026`, approximate values retain `~`, and fully unknown values say `Date unknown`.
No sort key is displayed as evidence. Repeated Stops remain separate deterministic
history rows, with existing Timeline section labels and Trip navigation.

The camera reuses the Step 7 circular-longitude and Mercator fitting helper for
zero, one, identical, widely separated and antimeridian-adjacent coordinates.
There is no global route overlay in Step 11. The bundled Natural Earth overview is
used with no online tile, geocoder or routing dependency. If MapLibre cannot render,
the local summaries, mapped/unmapped lists, Place details, visit history and Trip
links remain available.

## Runtime verification — 30 September 2026

Pixel 8 emulator, Android 17/API 37, Expo development build:

- Opened the top-level My Map and rendered the bundled Natural Earth overview.
- Synthetic canonical Place aggregated three separate Stops across two saved Trips
  into one marker with a `3 visits · 2 Trips` summary and three history rows.
- Confirmed exact and approximate date labels, Timeline section context, unique Trip
  links, and the explicit list entry for a visited Place without coordinates.
- Linked a coordinate-bearing Dream to one canonical Stop; the runtime audit
  confirmed the Dream Place added neither a marker nor a visit.
- Trashed all active saved fixture Trips to verify the zero-marker empty state,
  restored one contributing Trip to verify the one-marker state, then restored every
  Trip that had been active before staging. The shared marker contribution returned.
- Force-stopped with Wi-Fi/mobile data disabled, relaunched, and reopened My Map.
  Local counts, markers, unmapped summary and bundled map remained usable. App logs
  contained no fatal native exception or JavaScript error. Network radios were
  restored after the check.

JavaScript was served through local ADB/Metro, so this verifies the archive and
renderer offline from external services but is not a standalone release-bundle or
physical-device certification. The development-only `/my-map-test` route creates
clearly named synthetic records, audits their canonical aggregation, and provides a
recoverable zero/one-place staging flow.
