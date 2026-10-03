import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('secret files are ignored at the root and in nested directories', () => {
  const files = ['upload.jks', 'private/upload.keystore', 'private/upload.p12', 'upload.pfx',
    '.env.production', 'private/.env.signing', 'private/keystore.properties', 'signing.properties',
    '.local-signing/upload.jks', '.local-signing/credentials.dpapi'];
  const ignored = execFileSync('git', ['check-ignore', '--stdin'], { input: files.join('\n'), encoding: 'utf8' });
  assert.deepEqual(ignored.trim().split(/\r?\n/), files);
});

// No keys generated: reuse only Expo's public template debug key for a negative test.
// Run with JDK 17 after Android prebuild, like the release build itself.
test('cryptographic verifier rejects unsigned and debug-signed payloads with bounded diagnostics', () => {
  const directory = fs.mkdtempSync(path.resolve('.expo/signature-test-'));
  const javaTool = name => process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? `${name}.exe` : name) : name;
  const run = (name, args) => spawnSync(javaTool(name), args, { encoding: 'utf8' });
  const artifact = path.join(directory, 'fixture.jar');
  fs.writeFileSync(path.join(directory, 'payload.txt'), 'Disposable release verifier fixture.');
  assert.equal(run('jar', ['--create', '--file', artifact, '-C', directory, 'payload.txt']).status, 0);
  const verify = expected => run('java', ['scripts/VerifyAndroidBundle.java', artifact, expected]);
  for (const expected of ['invalid', '00'.repeat(32)]) {
    const result = verify(expected);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /signature verification FAILED/);
  }
  const debugStore = path.resolve('android/app/debug.keystore');
  assert.ok(fs.existsSync(debugStore), 'Android prebuild supplies the public debug test key');
  const certificate = run('keytool', ['-exportcert', '-keystore', debugStore, '-storepass', 'android',
    '-alias', 'androiddebugkey', '-rfc']);
  assert.equal(certificate.status, 0);
  // A matching fingerprint must still reject the publicly known debug certificate.
  return import('node:crypto').then(({ X509Certificate }) => {
    const fingerprint = new X509Certificate(certificate.stdout).fingerprint256;
    const signed = run('jarsigner', ['-keystore', debugStore, '-storepass', 'android', '-keypass', 'android', artifact, 'androiddebugkey']);
    assert.equal(signed.status, 0);
    const result = verify(fingerprint);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /signature verification FAILED/);
    assert.doesNotMatch(result.stderr, /androiddebugkey|CN=|\.keystore|Exception/);
  });
});
