const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withAppBuildGradle, withProjectBuildGradle, withDangerousMod } = require('expo/config-plugins');

const signingLine = 'apply from: new File(rootDir, "../scripts/android-release.gradle")';
const nativeLine = 'apply from: new File(rootDir, "../scripts/android-native-paths.gradle")';
function addSigningConfiguration(contents) {
  return contents.includes(signingLine) ? contents : `${contents.trimEnd()}\n\n${signingLine}\n`;
}
function addNativePaths(contents) {
  return contents.includes(nativeLine) ? contents : `${contents.trimEnd()}\n\n${nativeLine}\n`;
}

function annotateRemovedCameraPermission(androidManifest) {
  // Lint 31.12.0's ChromeOsDetector mistakes tools:node="remove" for a request.
  // Suppress only that false positive on the removal marker, never on a grant.
  // Keep CAMERA blocked; verify the merged manifest/AAB independently.
  for (const permission of androidManifest.manifest['uses-permission'] ?? []) {
    const attributes = permission.$;
    if (attributes['android:name'] === 'android.permission.CAMERA' && attributes['tools:node'] === 'remove') {
      const issues = new Set((attributes['tools:ignore'] ?? '').split(',').map(issue => issue.trim()).filter(Boolean));
      issues.add('PermissionImpliesUnsupportedChromeOsHardware');
      attributes['tools:ignore'] = [...issues].join(',');
    }
  }
  return androidManifest;
}

// Release-only overlay. HTTPS basemap tiles now require INTERNET in release.
// ACCESS_NETWORK_STATE remains for the native image/map connectivity monitors.
const releaseManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" tools:node="remove" />
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <uses-permission android:name="android.permission.VIBRATE" tools:node="remove" />
  <application android:usesCleartextTraffic="false" tools:replace="android:usesCleartextTraffic" />
</manifest>
`;

module.exports = function withAndroidRelease(config) {
  config = withAndroidManifest(config, mod => {
    mod.modResults = annotateRemovedCameraPermission(mod.modResults);
    return mod;
  });
  config = withProjectBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Expected the pinned Expo Groovy Android template.');
    mod.modResults.contents = addNativePaths(mod.modResults.contents);
    return mod;
  });
  config = withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Expected the pinned Expo Groovy Android template.');
    mod.modResults.contents = addSigningConfiguration(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', mod => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/release');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'AndroidManifest.xml'), releaseManifest);
    return mod;
  }]);
};
module.exports.addSigningConfiguration = addSigningConfiguration;
module.exports.addNativePaths = addNativePaths;
module.exports.releaseManifest = releaseManifest;
module.exports.annotateRemovedCameraPermission = annotateRemovedCameraPermission;
