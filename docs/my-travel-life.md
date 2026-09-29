# My Travel Life (Step 9)

Travel Life is a local read model over canonical archive tables. It does not persist counters and does not read reconstruction proposals.

## Metric definitions

- **Trips:** distinct `saved`, non-trash Trips. Resumable drafts are intentionally excluded because they are unfinished archive work, not confirmed travel history.
- **Places:** distinct canonical Place IDs reached through live, confirmed `visit` or `stay` Stops in saved, non-trash Trips. Names and coordinates are never used for deduplication. Transit and unconfirmed Stops do not qualify.
- **Visits:** qualifying Stop occurrences. Repeating one Place in or across Trips adds visits but not Places.
- **Photos:** distinct live Media IDs with live TripMedia placements in saved, non-trash Trips. The query also exposes placement count internally, but the screen labels unique assets as Photos.
- **Companions:** distinct live Companions linked to saved, non-trash Trips. The summary shows distinct active shared Trip counts.
- **Life Chapters:** distinct live Chapters containing saved, non-trash Trips. Chapter rows follow existing `position`, name, and ID ordering; counts are distinct Trips.
- **Recorded distance:** unavailable in Step 9 because the current canonical Trip schema has no stored distance field. Stop coordinates, map segments, and reconstruction geometry are never converted into distance.
- **Road trips:** omitted because the current canonical Trip schema has no road-trip classification.

## Active and deleted semantics

Every query starts from the current vault's saved Trips with `deleted_at IS NULL`. Live relationship rows and entities must also be nondeleted. Trashing a Trip removes its contributions; restoring it restores only relationships marked as deleted by that Trip operation. Reusable Place, Media, Companion, and Chapter rows remain intact. Explicitly removed Stops and placements stay excluded.

## Dates and uncertainty

Travel history groups saved Trips by the year explicitly present in the Trip DateSpec start value. Exact day, month, and year values keep their supplied precision. Approximate values keep a `~` marker. Trips whose start is unknown stay in a separate **Date unknown** group. No missing year, endpoint, month, or day is inferred.

## Runtime verification

Android verification should open Travel Life, compare Trips/Places/Visits/Photos/Companions/Chapters with existing canonical content, check a repeated Place and an approximate or unknown date, trash and restore one Trip, then force-stop and relaunch offline. Recorded distance must remain unavailable even when Stops have coordinates. Record the device/emulator and outcome in the Step 9 implementation report.
