# Privacy and data-handling inventory — review draft

Scope: merged main `11d4337`, version 0.1.0 (1), 22 October 2026. Implemented
behavior takes precedence over future capabilities mentioned in architecture.
There is no app account, backend, Supabase integration, cloud sync, advertising
SDK or application analytics/crash-reporting integration in the audited source.
Do not interpret local-first as “no data ever leaves the device.”

| Data / purpose | Local handling | Transmission and control |
| --- | --- | --- |
| Selected photos | System picker grants selected items; app-owned received-byte copies, metadata, hashes and previews in private app storage. Picker/cloud-library rendition and redaction can vary. Original evidence and user corrections remain separate. | No app photo upload. An OS/cloud photo picker may download a selected item under its provider's rules. No broad media permission. |
| EXIF, coordinates, dates | Available metadata, manual places, Stops and photo-memory pins are local. No current/background GPS collection. Unknown values remain unknown. | Route coordinates may leave via explicit ORS action; viewed map area is inferable from tile requests. Manual coordinates can be precise even without location permission. |
| Notes, trip titles, captions, companions, chapters, dreams | SQLite and local search index. Companion labels are user-entered, not address-book reads. | Not sent to MapTiler or ORS. Included in user-selected exports. |
| MapTiler basemap | MapLibre renders local overlays and optional remote basemap; native transient cache may exist. Bundled coarse fallback; no bulk offline map promise. | Opening configured Trip Map automatically requests HTTPS style/tiles/resources (including on retry/resume). Provider receives IP, requested tile area/zoom, public API token, request timing and client headers/package User-Agent. Photos/notes/local overlays are not request payloads. No runtime online/offline preference is currently implemented. Offline operation avoids successful network transfer; do not describe maps as opt-in per request. |
| ORS / HeiGIT road suggestion | Result and edited via points live in map-session memory; no live-result save/export UI. Historic saved/imported road rows are supported separately. | After Generate confirmation, POST to `api.heigit.org/openrouteservice/v2/directions/driving-car`: ordered Stop/via coordinate pairs and routing parameters, Authorization key, IP/headers. No title, photo, note or Stop ID in request body. Response retention on provider servers is unknown; session-only app storage does not establish server ephemerality. |
| Personal ORS key | Android Keystore-backed Expo SecureStore, no biometric requirement. Read for each request; UI masks entry by default. | Sent only to routing provider in HTTPS Authorization header. Excluded from SQLite/export; Clear key in Settings → Routing removes it. Vault deletion does **not** clear this device-level credential; clear separately. |
| Portable export/restore | Format v3, schema 12; v1/v2 readable. JSON, original media/metadata, readable journal and geographic content; validated restore into an empty vault. | User-selected document destination can be local or supplied by another provider, including a cloud-backed document service. Exports are unencrypted sensitive copies, potentially including precise EXIF, people labels and old saved route records. No new ORS previews or SecureStore key. Destination provider controls its copies. |
| Backups/deletion | Android `allowBackup=false`, SecureStore backup exclusions. No app-managed automatic cloud backup. Local erase removes vault DB/owned files; originals in phone library and existing exports remain. | User must keep and verify external exports. OS/OEM transfer behavior should not be promised as universal secure erasure. Uninstall/clear app data can lose the only local copy. No forensic flash-erasure guarantee. |
| External links/support | Provider attribution/terms/key signup and user-opened links launch external handling. | Browser/site policies apply. Future support correspondence depends on the owner's actual support channel; no invented retention period. |

Evidence paths: `modules/archive-media/android/src/main/java/expo/modules/archivemedia/ArchiveMediaModule.kt`,
`src/features/map/TripMapScreen.tsx`, `src/features/road-route/provider.ts`,
`src/features/road-route/RoadRouteEditor.tsx`, `src/features/road-route/proposals.ts`,
`src/features/routing-credentials/`, `src/services/archive/portable.ts`,
`src/features/settings/native-reset.ts`, `app.json` and the signed manifest.
MapTiler geocoding/search is an architecture extension, not an implemented network
call in this release. No claim of app-level encrypted vault or E2EE is justified.

## Data safety preparation, not a submitted declaration

Google defines collection to include off-device transmission by SDKs; local-only
processing is excluded. Internal-only apps need not complete the form, but later
tracks do. See [Google's definitions and exceptions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

- Photos, local text and local search are not developer-collected through the
  audited app. User-directed export exceptions require evaluating the actual
  destination/flow; do not simply mark every exported field as app collection.
- Review location categories for exact ORS waypoints and map-tile areas, even
  though the app never requests device location. Optional road generation is for
  app functionality. Map requests are automatic when opening the configured map.
- IP addresses, API/account identifiers and SDK request metadata require provider
  confirmation and correct mapping to Console categories. Do not mark “no data
  collected/shared” merely because there is no developer backend.
- Provider sharing exemptions (service provider or user-initiated transfer),
  ephemerality, retention, deletion and purposes must be established from the
  applicable agreements. An explicit confirmation is not sufficient evidence of
  every exemption. Do not invent provider retention durations.
- App network calls use HTTPS. Exports are not encrypted by the app. There is no
  app account to delete; local erase and ORS account/provider deletion differ.

Owner review: confirm MapTiler plan and restricted mobile token, applicable
[MapTiler privacy policy](https://www.maptiler.com/privacy-policy/) and
[Cloud terms](https://www.maptiler.com/terms/cloud/); confirm HeiGIT API-account
privacy/terms through [the provider account portal](https://account.heigit.org/info/tos).
The portal privacy page could not be retrieved in this audit. Do not substitute
historical forum answers for current contractual retention terms. Obtain explicit
ORS retention/export permission before enabling permanent new-response storage.
