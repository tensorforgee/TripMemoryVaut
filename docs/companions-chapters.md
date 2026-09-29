# Step 8 — Companions and Life Chapters

Companions are private, reusable labels owned by the local Vault. A Companion is
not an app user, phone contact or social profile. It stores a required trimmed
display name and an optional private note. Equal display names remain separate
records: the app never merges identities automatically.

Life Chapters are user-curated albums owned by the local Vault. Each has a custom
title, optional description and deterministic position. A normalized active title
is unique within the Vault. Chapters are not folders and do not own Trips.

Both relationships are many-to-many. Attaching the same pair is idempotent;
detaching removes only that membership. Search and selection use local records
only. A Trip can be in multiple Chapters and have multiple Companions, while each
Companion or Chapter can be reused across Trips.

Companions, Chapters and both membership tables use UUIDs, audit timestamps and
tombstones. Removing a Companion or Chapter tombstones its live memberships and
never changes or deletes Trip data. Restoring it restores still-valid memberships.
Trip trash temporarily hides its memberships and active counts exclude deleted
Trips; restoring the Trip restores valid memberships. An explicitly detached
membership stays detached through unrelated trash/restore operations. There is no
permanent purge UI in this step.

## Android verification — 30 September 2026

On the Pixel 8 Android 17/API 37 emulator, an existing Trip was opened and local
Companions Rahul and Mom were created and attached. Rahul was reused on a second
Trip; the Companions screen reported Rahul with two Trips and Mom with one. College
Years was attached to both Trips, while Bike Trips was also attached to the first;
the Chapters screen reported counts of two and one respectively.

Mom and Bike Trips were detached from the first Trip. Wi-Fi and mobile data were
disabled, the app was force-stopped, and the Expo development build was relaunched
through the local ADB/Metro connection. The remaining Trip Detail memberships and
counts persisted: Rahul had two Trips, Mom zero, College Years two, and Bike Trips
zero. Removing the linked Rahul and College Years records afterwards left both Trip
cards and their route/timeline data available. App-process logs contained no fatal
native exception or React Native JavaScript error. Network settings were restored.

Host verification uses real SQLite and covers the Step 7→8 migration, validation,
duplicate Companion names, idempotent links, detachments, many-to-many reuse,
Trip/Vault isolation, deleted-Trip counts, non-destructive removal, restoration,
explicit-detach preservation and database restart persistence.
