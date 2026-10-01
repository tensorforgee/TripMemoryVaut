import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fixture } from '../step1/sqlite-harness.mjs';
import { migrations, migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { SearchRepository } from '../../.expo/step1-tests/features/search/repository.js';
import { createPortableExport, restorePortableArchive } from '../../.expo/step1-tests/services/archive/portable.js';

const stamp = '2026-10-01T08:30:00.000Z';
const unknown = JSON.stringify({ start: { precision: 'unknown' }, end: null, certainty: 'unknown', source: 'user' });
const exact = JSON.stringify({ start: { precision: 'month', value: '2026-09' }, end: null, certainty: 'exact', source: 'user' });

async function trip(c, vault, title, status = 'saved', summary = null, dates = exact) {
  const id = randomUUID();
  await c.runAsync(`INSERT INTO trips(id,vault_id,title,status,dates_json,sort_date,sort_precision,summary,created_at,updated_at)
    VALUES(?,?,?,?,?,'2026-09-01','month',?,?,?)`, id, vault, title, status, dates, summary, stamp, stamp);
  return id;
}
async function place(c, vault, name, aliases = []) {
  const id = randomUUID();
  await c.runAsync(`INSERT INTO places(id,vault_id,name,coordinate_precision,source,provenance_json,aliases_json,created_at,updated_at)
    VALUES(?,?,?,'unknown','user','{}',?,?,?)`, id, vault, name, JSON.stringify(aliases), stamp, stamp);
  return id;
}

async function seed(f) {
  const c = f.connection, vault = f.vault.id;
  const mainTrip = await trip(c, vault, 'Chitkul Road Trip', 'saved', 'Shimla bike memories');
  const draftTrip = await trip(c, vault, 'Japan outline', 'draft', 'unfinished sakura idea', unknown);
  const sangla1 = await place(c, vault, 'Sangla', ['Baspa valley']);
  const sangla2 = await place(c, vault, 'Sangla');
  const canonicalPlace = await place(c, vault, 'Canonical Ridge');
  const dreamPlace = await place(c, vault, 'Japan');
  const day = randomUUID();
  await c.runAsync(`INSERT INTO trip_days(id,vault_id,trip_id,position,label,created_at,updated_at) VALUES(?,?,?,0,'Mountain morning',?,?)`, day, vault, mainTrip, stamp, stamp);
  const stop = randomUUID();
  await c.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,day_id,position,kind,visit_confirmed,detail_certainty,source,note,lodging_label,created_at,updated_at)
    VALUES(?,?,?,?,?,0,'stay',1,'exact','user','Apple orchard evening','River Lodge',?,?)`, stop, vault, mainTrip, sangla1, day, stamp, stamp);
  const rejectedStop = randomUUID();
  await c.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,position,kind,visit_confirmed,detail_certainty,source,note,created_at,updated_at)
    VALUES(?,?,?,?,1,'visit',0,'unknown','photo_suggestion','unconfirmedclusterword',?,?)`, rejectedStop, vault, mainTrip, sangla2, stamp, stamp);
  const acceptedStop = randomUUID();
  await c.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,position,kind,visit_confirmed,detail_certainty,source,note,created_at,updated_at)
    VALUES(?,?,?,?,2,'visit',1,'approximate','photo_suggestion','acceptedclusterword',?,?)`, acceptedStop, vault, mainTrip, canonicalPlace, stamp, stamp);
  const rahul1 = randomUUID(), rahul2 = randomUUID();
  await c.runAsync(`INSERT INTO companions(id,vault_id,label,note,created_at,updated_at) VALUES(?,?,?,'College friend',?,?)`, rahul1, vault, 'Rahul', stamp, stamp);
  await c.runAsync(`INSERT INTO companions(id,vault_id,label,note,created_at,updated_at) VALUES(?,?,?,'Cycling friend',?,?)`, rahul2, vault, 'Rahul', stamp, stamp);
  await c.runAsync(`INSERT INTO trip_companions(id,vault_id,trip_id,companion_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`, randomUUID(), vault, mainTrip, rahul1, stamp, stamp);
  const chapter = randomUUID();
  await c.runAsync(`INSERT INTO chapters(id,vault_id,name,normalized_name,description,position,created_at,updated_at) VALUES(?,?,?,'college years','Bike friends',0,?,?)`, chapter, vault, 'College Years', stamp, stamp);
  await c.runAsync(`INSERT INTO trip_chapters(id,vault_id,trip_id,chapter_id,position,created_at,updated_at) VALUES(?,?,?,?,0,?,?)`, randomUUID(), vault, mainTrip, chapter, stamp, stamp);
  const dream = randomUUID();
  await c.runAsync(`INSERT INTO dream_destinations(id,vault_id,place_id,added_dates_json,note,location_text,created_at,updated_at)
    VALUES(?,?,?,?,?,'East Asia',?,?)`, dream, vault, dreamPlace, exact, 'Slow train someday', stamp, stamp);
  const media = randomUUID(), placement = randomUUID();
  await c.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,source_fidelity,source_metadata_json,parser_version,created_at,updated_at)
    VALUES(?,?,?,1,'image/jpeg','jpg',1,1,'original_confirmed','{}',1,?,?)`, media, vault, 'a'.repeat(64), stamp, stamp);
  await c.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,day_id,stop_id,position,caption,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,'Sunrise ridge portrait',?,?)`, placement, vault, mainTrip, media, day, stop, stamp, stamp);
  const run = randomUUID();
  await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,kind,payload_json,evidence_json,algorithm_version,state,created_at,updated_at)
    VALUES(?,?,?,'run','{}','{}',1,'pending',?,?)`, run, vault, mainTrip, stamp, stamp);
  await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,run_id,kind,payload_json,evidence_json,algorithm_version,state,resolution_json,created_at,updated_at)
    VALUES(?,?,?,?,'location',?,'{}',1,'rejected','{}',?,?)`, randomUUID(), vault, mainTrip, run, JSON.stringify({ label: 'phantomsuggestionword' }), stamp, stamp);
  const otherVault = randomUUID();
  await c.runAsync(`INSERT INTO vaults(id,name,format_version,created_at,updated_at) VALUES(?,'Other vault',1,?,?)`, otherVault, stamp, stamp);
  await trip(c, otherVault, 'Isolation Only Secret');
  return { mainTrip, draftTrip, sangla1, sangla2, stop, acceptedStop, rejectedStop, rahul1, rahul2, chapter, dream, placement };
}

test('FTS5 migration backfills existing rows deterministically and is idempotent', async t => {
  const f = await fixture(t, false);
  await migrateDatabase(f.database, f.services, migrations.slice(0, 9));
  const vault = await getOrCreateVault(f.database, randomUUID);
  await trip(f.connection, vault.id, 'Before Search Migration', 'saved', 'backfilltoken');
  assert.equal(await f.connection.getFirstAsync("SELECT name FROM sqlite_schema WHERE name='search_fts'"), null);
  await migrateDatabase(f.database, f.services);
  const search = new SearchRepository(f.database, vault.id);
  assert.equal((await search.search('backfill')).at(0)?.primaryTitle, 'Before Search Migration');
  assert.equal(await search.indexVersion(), SearchRepository.indexVersion);
  const before = await f.connection.getFirstAsync('SELECT count(*) count FROM search_documents');
  await migrateDatabase(f.database, f.services); await search.rebuild(); await search.rebuild();
  assert.deepEqual(await f.connection.getFirstAsync('SELECT count(*) count FROM search_documents'), before);
  await f.connection.execAsync("INSERT INTO search_fts(search_fts) VALUES('integrity-check')");
});

test('all canonical search sources, safe matching, ranking, identities, vaults and drafts behave correctly', async t => {
  const f = await fixture(t); const ids = await seed(f); const search = new SearchRepository(f.database, f.vault.id);
  assert.equal((await search.search('chitkul'))[0].entityId, ids.mainTrip);
  assert.ok((await search.search('shimla bike')).some(row => row.entityId === ids.mainTrip));
  assert.equal((await search.search('sang')).filter(row => row.entityType === 'place').length, 2);
  assert.ok((await search.search('orchard')).some(row => row.entityType === 'stop' && row.tripId === ids.mainTrip));
  assert.ok((await search.search('mountain morn')).some(row => row.entityType === 'tripDay'));
  assert.equal((await search.search('RAHUL')).filter(row => row.entityType === 'companion').length, 2);
  assert.ok((await search.search('rahul')).some(row => row.entityType === 'trip' && row.entityId === ids.mainTrip));
  assert.ok((await search.search('college years')).some(row => row.entityType === 'chapter'));
  assert.ok((await search.search('slow train')).some(row => row.entityType === 'dream'));
  assert.ok((await search.search('sunrise rid')).some(row => row.entityType === 'mediaCaption'));
  assert.equal((await search.search('Japan outline'))[0].contextLabel, 'Draft');
  assert.deepEqual(await search.search('Isolation Only Secret'), []);
  assert.deepEqual(await search.search('phantomsuggestionword'), []);
  assert.deepEqual(await search.search('unconfirmedclusterword'), []);
  assert.ok((await search.search('acceptedclusterword')).some(row => row.entityId === ids.acceptedStop));
  assert.deepEqual(await search.search('1999'), []);
  assert.deepEqual(await search.search('" ) OR * : NEAR('), []);
  const exactRank = await search.search('Chitkul Road Trip');
  assert.equal(exactRank[0].entityType, 'trip'); assert.equal(exactRank[0].entityId, ids.mainTrip);
  assert.deepEqual(
    (await search.search('Chitkul Road Trip')).map(row => `${row.entityType}:${row.entityId}`),
    exactRank.map(row => `${row.entityType}:${row.entityId}`),
  );
});

test('edits, removals, trash/restore and archive/restore synchronously change results', async t => {
  const f = await fixture(t); const ids = await seed(f); const search = new SearchRepository(f.database, f.vault.id);
  await f.connection.runAsync(`UPDATE trips SET title='Kinnaur Journey',updated_at=? WHERE id=?`, stamp, ids.mainTrip);
  assert.deepEqual(await search.search('Chitkul'), []); assert.equal((await search.search('Kinnaur'))[0].entityId, ids.mainTrip);
  await f.connection.runAsync(`UPDATE stops SET deleted_at=?,updated_at=? WHERE id=?`, stamp, stamp, ids.stop);
  assert.deepEqual(await search.search('orchard'), []);
  await f.connection.runAsync(`UPDATE stops SET deleted_at=NULL,updated_at=? WHERE id=?`, stamp, ids.stop);
  assert.ok((await search.search('orchard')).some(row => row.entityId === ids.stop));
  await f.connection.runAsync(`UPDATE trip_media SET caption='Evening alpenglow',updated_at=? WHERE id=?`, stamp, ids.placement);
  assert.deepEqual(await search.search('sunrise'), []); assert.ok((await search.search('alpenglow')).some(row => row.entityId === ids.placement));
  await f.connection.runAsync(`UPDATE trip_media SET deleted_at=?,updated_at=? WHERE id=?`, stamp, stamp, ids.placement);
  assert.deepEqual(await search.search('alpenglow'), []);
  await f.connection.runAsync(`UPDATE trip_media SET deleted_at=NULL,updated_at=? WHERE id=?`, stamp, ids.placement);
  assert.ok((await search.search('alpenglow')).some(row => row.entityId === ids.placement));
  await f.trips.trashTrip(ids.mainTrip);
  for (const query of ['Kinnaur', 'orchard', 'mountain', 'alpenglow']) assert.deepEqual(await search.search(query), []);
  await f.trips.restoreTrip(ids.mainTrip);
  assert.ok((await search.search('Kinnaur')).some(row => row.entityId === ids.mainTrip));
  await f.connection.runAsync('UPDATE companions SET deleted_at=?,updated_at=? WHERE id=?', stamp, stamp, ids.rahul1);
  assert.equal((await search.search('Rahul')).filter(row => row.entityType === 'companion').length, 1);
  await f.connection.runAsync('UPDATE companions SET deleted_at=NULL,updated_at=? WHERE id=?', stamp, ids.rahul1);
  assert.equal((await search.search('Rahul')).filter(row => row.entityType === 'companion').length, 2);
  await f.connection.runAsync('UPDATE chapters SET deleted_at=?,updated_at=? WHERE id=?', stamp, stamp, ids.chapter);
  assert.deepEqual((await search.search('College Years')).filter(row => row.entityType === 'chapter'), []);
  await f.connection.runAsync('UPDATE chapters SET deleted_at=NULL,updated_at=? WHERE id=?', stamp, ids.chapter);
  assert.equal((await search.search('College Years')).filter(row => row.entityType === 'chapter').length, 1);
  await f.connection.runAsync('UPDATE dream_destinations SET is_archived=1,updated_at=? WHERE id=?', stamp, ids.dream);
  assert.deepEqual((await search.search('Slow train')).filter(row => row.entityType === 'dream'), []);
  await f.connection.runAsync('UPDATE dream_destinations SET is_archived=0,updated_at=? WHERE id=?', stamp, ids.dream);
  assert.equal((await search.search('Slow train')).filter(row => row.entityType === 'dream').length, 1);
});

class NodeIO {
  async createRoot(root) { await mkdir(root); }
  async removeRoot(root) { await rm(root, { recursive: true, force: true }); }
  async writeText(root, path, value) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); }
  async readText(root, path) { return readFile(join(root, path), 'utf8'); }
  async copyFromUri(source, root, path) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await cp(source, target); }
  async copyTree(source, destination) { await cp(source, destination, { recursive: true }); }
  async exists(root, path) { try { return (await stat(join(root, path))).isFile(); } catch { return false; } }
  async size(root, path) { return (await stat(join(root, path))).size; }
  fileUri(root, path) { return join(root, path); }
  async sha256Text(value) { return createHash('sha256').update(value).digest('hex'); }
  async verifyFile(root, path, hash, bytes) { const value = await readFile(join(root, path)); return value.length === bytes && createHash('sha256').update(value).digest('hex') === hash; }
}
const noMedia = { uri: value => value, verify: async () => false, exists: async () => false, copy: async () => {}, publish: async () => {}, removeStaging: async () => {} };

test('portable format omits FTS internals and restore rebuilds the derived index', async t => {
  const source = await fixture(t); await trip(source.connection, source.vault.id, 'Restored Searchable Trip', 'saved', 'portablebackfill');
  const io = new NodeIO(); const root = join(dirname(source.path), 'portable-search');
  const exported = await createPortableExport({ database: source.database, vaultId: source.vault.id, io, mediaFiles: noMedia, stagingRoot: root, now: () => stamp });
  assert.ok(exported.manifest.files.every(file => !file.path.includes('search')));
  const fresh = await fixture(t);
  const restored = await restorePortableArchive({ database: fresh.database, currentVaultId: fresh.vault.id, io, archiveRoot: root,
    destinationMedia: noMedia, newStagingId: randomUUID });
  const search = new SearchRepository(fresh.database, restored.vaultId);
  assert.equal((await search.search('portableback')).at(0)?.primaryTitle, 'Restored Searchable Trip');
  assert.equal(await search.indexVersion(), SearchRepository.indexVersion);
});

test('bounded search remains responsive over the architecture trip scale', async t => {
  const f = await fixture(t); const search = new SearchRepository(f.database, f.vault.id);
  for (let index = 0; index < 100; index++) await trip(f.connection, f.vault.id, `Scale Trip ${index}`, 'saved', `sharedscale token${index}`);
  const started = performance.now(); const results = await search.search('sharedscale'); const elapsed = performance.now() - started;
  assert.equal(results.length, 30); assert.ok(elapsed < 1000, `search took ${elapsed.toFixed(1)}ms on the host harness`);
});
