import { migrations } from '../../core/database/migrate';
import { APP_VERSION, PORTABLE_FORMAT_VERSION } from '../../services/archive/portable';

export const settingsVersions={appName:'Trip Memory Vault',appVersion:APP_VERSION,schemaVersion:migrations.length,exportFormatVersion:PORTABLE_FORMAT_VERSION} as const;
export const privacyCapabilities={
  archiveStorage:'The archive is stored locally in this app’s private storage on this device.',
  account:'No account is required.',
  cloud:'No cloud backup or sync is enabled.',
  photos:'Selected photos are imported as app-owned copies. The app uses the system photo picker and does not request broad photo-library access.',
  location:'Location is used only when it is explicitly stored or imported with archive content. No current or background location access is requested.',
  dreams:'Dreams are private local archive data.',
  search:'Search runs locally on this device.',
  contacts:'Contacts access is not requested.',
} as const;
