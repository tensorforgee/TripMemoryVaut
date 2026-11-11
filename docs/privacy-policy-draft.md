# Trip Memory Vault privacy policy — DRAFT FOR OWNER REVIEW

Not ready for public hosting until the owner replaces the bracketed fields and
reviews the provider details. No publication occurred.

Effective date: [OWNER TO SUPPLY]

Developer/operator: [LEGAL NAME OR PUBLISHER IDENTITY]

Privacy contact: [MONITORED EMAIL ADDRESS]

This policy describes Trip Memory Vault for Android, version 0.1.0. It is a local
travel archive. You do not need an app account. The app does not provide cloud
backup or synchronization.

## Your archive on your device

The app stores trips, notes, memories, places, coordinates, companion labels,
dream places and selected photos in its private storage on your device. Search
runs locally. It imports copies of photos you select through the system picker;
it does not request access to your whole photo library, contacts, camera,
microphone, or current/background location.

Received photos may contain filenames, dates and GPS metadata. The app retains
available source evidence separately from corrections you make. The system or
photo provider may supply a rendition or omit metadata. Missing information is
not proof of a date or location. A cloud-backed photo picker may contact its own
service when you select a photo.

Private app storage relies on Android's protections. The app does not separately
encrypt its entire database and media archive and does not offer end-to-end
encryption.

## Online maps and optional road previews

When you open a Trip Map with the configured online basemap, MapTiler receives
network requests for map styles and resources. These expose your IP address,
requested map area and zoom, request timing, public map token and client headers.
The app does not upload your photos, notes or trip titles to MapTiler. Requests
can also occur when retrying or returning to the map. A coarse local map remains
available when the online basemap cannot load. There is currently no in-app
switch that disables all online basemap requests.

If you configure your own openrouteservice/HeiGIT key and confirm a road-generation
request, the app sends the selected Stop coordinates and ordered via-point
coordinates, routing parameters and your key to HeiGIT over HTTPS. The provider
also receives normal network information such as your IP address. No photo,
note or trip title is included. You can decline generation and use remembered
Stops instead.

New road results are temporary previews. They are discarded with the map session
and are not saved or exported. Existing route records restored from archives
can remain in the local archive. Generated routes are suggestions based on the
provider's road network, not evidence of your historical journey. Local preview
discarding does not delete information held by a provider.

Provider processing is governed by their own policies:
[MapTiler privacy policy](https://www.maptiler.com/privacy-policy/) and
[HeiGIT account portal](https://account.heigit.org/). [OWNER: verify and insert
the current direct HeiGIT privacy-policy link and applicable processing details.]
This policy does not promise a provider retention or deletion period that has
not been confirmed. External links you choose to open are handled by the browser
or destination service under its policies.

## Routing key

Your routing key is stored using Android Keystore-backed secure storage and sent
to the routing provider in the Authorization header for approved requests. It is
not included in the archive database or portable exports. Remove it using
Settings → Routing → Clear key. Deleting the local vault does not remove this
separate device-level key. Revoking a provider key or deleting its account is a
separate action with the provider.

## Exports, retention and deletion

You control portable exports and their destination. They can contain original
photos, GPS/EXIF metadata, coordinates, names and written memories. Exports are
not encrypted by the app. A destination offered by another document provider
may synchronize its files externally. Protect these copies and share them only
with intended recipients.

Local content remains until removed through the app or Android app-data removal.
Settings provides a confirmed action to delete all local vault data. That does
not delete source photos in your photo library, copies you exported, or provider
records. Android app backup is disabled; no automatic app-managed cloud backup
is provided. Keep and verify an external export before uninstalling or changing
devices. Deletion cannot guarantee forensic erasure from flash storage.

The audited app has no advertising or application analytics/crash-reporting
integration. Google Play, Android, document providers and mapping services may
process information under their own policies. If you contact the developer,
include only information you intend to share; do not send API keys or full
private archives. [OWNER: document actual support correspondence retention and
handling before publication.]

## Contact and changes

For questions or requests, contact [MONITORED EMAIL ADDRESS]. The developer
cannot retrieve a local archive that you have not supplied. Updates to this
policy will be published at [PUBLIC POLICY URL] with an updated effective date.
