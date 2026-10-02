import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { addSigningConfiguration, addNativePaths, releaseManifest } = require('../../plugins/withAndroidRelease');
const read = name => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

test('Settings does not label standalone releases as development when native build metadata is absent', () => {
  const screen = read('src/features/settings/SettingsScreen.tsx');
  assert.match(screen, /Constants\.nativeBuildVersion\?\?Constants\.expoConfig\?\.android\?\.versionCode\?\.toString\(\)/);
  assert.doesNotMatch(screen, /Development build/);
  assert.match(screen, /build\?\?'Unavailable'/);
});

test('native staging injection is idempotent, Windows-only and does not change ABIs or versions', () => {
  const once = addNativePaths('allprojects {}\n');
  assert.equal(addNativePaths(once), once);
  const policy = read('scripts/android-native-paths.gradle');
  assert.match(policy, /contains\('windows'\)/);
  assert.match(policy, /buildStagingDirectory/);
  assert.doesNotMatch(policy, /abiFilters|ndkVersion|cmakeVersion/);
});

test('prebuild signing injection is idempotent and uses the tracked signing policy', () => {
  const once = addSigningConfiguration('android {}\n');
  assert.equal(addSigningConfiguration(once), once);
  assert.match(once, /scripts\/android-release.gradle/);
  const policy = read('scripts/android-release.gradle');
  assert.match(policy, /android\.buildTypes\.release\.signingConfig = null/);
  assert.doesNotMatch(policy, /signingConfigs\.debug/);
  for (const field of ['STORE_FILE', 'KEY_ALIAS', 'STORE_PASSWORD', 'KEY_PASSWORD']) {
    assert.match(policy, new RegExp(`TMV_UPLOAD_${field}`));
  }
  assert.match(policy, /!hasUploadSigning && !unsignedRelease/);
  assert.match(policy, /partialUploadSigning/);
});

test('all verification routes are production-inaccessible at the navigation boundary', () => {
  const layout = read('app/_layout.tsx');
  const protectedRoutes = layout.match(/<Stack\.Protected guard=\{__DEV__\}>([\s\S]*?)<\/Stack\.Protected>/)?.[1];
  assert.ok(protectedRoutes);
  for (const name of fs.readdirSync(new URL('../../app', import.meta.url)).filter(n => n.endsWith('-test.tsx'))) {
    assert.ok(protectedRoutes.includes(`name="${name.replace('.tsx', '')}"`), name);
  }
  const config = JSON.parse(read('app.json')).expo;
  assert.equal(config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-router')[1].sitemap, false);
  assert.equal(config.android.package, 'com.tripmemoryvault.app');
  assert.equal(config.android.versionCode, 1);
  assert.equal(config.android.allowBackup, false);
});

test('release overlay removes unused network/overlay/haptic permissions and disallows cleartext', () => {
  for (const permission of ['INTERNET', 'ACCESS_WIFI_STATE', 'SYSTEM_ALERT_WINDOW', 'VIBRATE']) {
    assert.ok(releaseManifest.includes(`android.permission.${permission}" tools:node="remove"`));
  }
  assert.match(releaseManifest, /usesCleartextTraffic="false"/);
  const permissions = JSON.parse(read('app.json')).expo.android.blockedPermissions;
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
    'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO']) {
    assert.ok(permissions.includes(`android.permission.${permission}`));
  }
});
