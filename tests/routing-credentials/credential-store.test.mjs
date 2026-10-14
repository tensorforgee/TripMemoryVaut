import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { OrsCredentialStore, ORS_CREDENTIAL_STORAGE_KEY, normalizeOrsApiKey } from '../../.expo/step1-tests/features/routing-credentials/credential-store.js';

const jwtShapedKey = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0cmlwLW1lbW9yeS12YXVsdCJ9.signature_1234567890';

class MemorySecureStorage {
  constructor(values = new Map()) { this.values = values; this.failure = null; }
  async getItemAsync(key) { if (this.failure) throw this.failure; return this.values.get(key) ?? null; }
  async setItemAsync(key, value) { if (this.failure) throw this.failure; this.values.set(key, value); }
  async deleteItemAsync(key) { if (this.failure) throw this.failure; this.values.delete(key); }
}

test('saves an opaque or JWT-shaped key only through secret storage', async () => {
  const storage = new MemorySecureStorage();
  const store = new OrsCredentialStore(storage);
  await store.save(`  ${jwtShapedKey}\r\n`);
  assert.equal(storage.values.get(ORS_CREDENTIAL_STORAGE_KEY), jwtShapedKey);
  assert.equal(await store.isConfigured(), true);
});

test('reads the key after a new store instance simulates an app restart', async () => {
  const persisted = new Map();
  await new OrsCredentialStore(new MemorySecureStorage(persisted)).save(jwtShapedKey);
  const restarted = new OrsCredentialStore(new MemorySecureStorage(persisted));
  assert.equal(await restarted.read(), jwtShapedKey);
});

test('clears the key idempotently', async () => {
  const storage = new MemorySecureStorage();
  const store = new OrsCredentialStore(storage);
  await store.save(jwtShapedKey);
  await store.clear();
  await store.clear();
  assert.equal(await store.read(), null);
  assert.equal(await store.isConfigured(), false);
});

test('rejects empty, short, whitespace-containing and oversized input without rejecting JWT shape', () => {
  assert.throws(() => normalizeOrsApiKey('   '), /Enter an openrouteservice API key/);
  assert.throws(() => normalizeOrsApiKey('too-short'), /too short/);
  assert.throws(() => normalizeOrsApiKey('valid-looking-key with-space'), /spaces or control/);
  assert.throws(() => normalizeOrsApiKey('x'.repeat(8193)), /too long/);
  assert.equal(normalizeOrsApiKey(jwtShapedKey), jwtShapedKey);
  assert.equal(normalizeOrsApiKey('opaque_HEIGIT-key-value-1234567890'), 'opaque_HEIGIT-key-value-1234567890');
});

test('storage failures expose safe errors and never log the credential', async () => {
  const storage = new MemorySecureStorage();
  const store = new OrsCredentialStore(storage);
  const calls = [];
  const methods = ['log', 'warn', 'error', 'info', 'debug'];
  const original = Object.fromEntries(methods.map(name => [name, console[name]]));
  for (const name of methods) console[name] = (...args) => calls.push([name, ...args]);
  try {
    storage.failure = new Error(`native failure containing ${jwtShapedKey}`);
    await assert.rejects(store.save(jwtShapedKey), error => {
      assert.match(error.message, /Could not save/);
      assert.doesNotMatch(error.message, new RegExp(jwtShapedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    });
    await assert.rejects(store.read(), /Could not read/);
    await assert.rejects(store.clear(), /Could not clear/);
    assert.deepEqual(calls, []);
  } finally {
    for (const name of methods) console[name] = original[name];
  }
});

test('credential boundary has no SQLite, archive, environment or logging path', async () => {
  const credentialSource = await readFile('src/features/routing-credentials/credential-store.ts', 'utf8');
  const nativeSource = await readFile('src/features/routing-credentials/native-store.ts', 'utf8');
  const archiveSource = await readFile('src/services/archive/portable.ts', 'utf8');
  assert.doesNotMatch(credentialSource, /sqlite|portable|archive|EXPO_PUBLIC_|console\./i);
  assert.doesNotMatch(nativeSource, /sqlite|portable|archive|EXPO_PUBLIC_|console\./i);
  assert.doesNotMatch(archiveSource, /expo-secure-store|ORS_CREDENTIAL_STORAGE_KEY|routing-credentials/i);
});

test('routing settings keep the input masked and disclose explicit preview-only live routing', async () => {
  const screen = await readFile('src/features/routing-credentials/RoutingCredentialScreen.tsx', 'utf8');
  const provider = await readFile('src/features/road-route/provider.ts', 'utf8');
  const editor = await readFile('src/features/road-route/RoadRouteEditor.tsx', 'utf8');
  assert.match(screen, /secureTextEntry={!visible}/);
  assert.match(screen, /https:\/\/account\.heigit\.org\//);
  assert.match(screen, /Generate Road Route/);
  assert.match(screen, /temporary previews/);
  assert.match(provider, /Authorization: credential/);
  assert.match(provider, /Settings → Routing/);
  assert.doesNotMatch(provider, /[?&](api_?key|token)=/i);
  assert.doesNotMatch(editor, /Confirm suggestion|roadRoutes\.confirm/);
  assert.match(editor, /geometry\.coordinates\.length/);
  assert.match(editor, /not saved or exported/);
});
