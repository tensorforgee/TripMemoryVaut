import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrateDatabase, migrations } from '../../.expo/step1-tests/core/database/migrate.js';
import { CompanionRepository } from '../../.expo/step1-tests/features/companions/repository.js';
import { ChapterRepository } from '../../.expo/step1-tests/features/chapters/repository.js';

const repos = f => ({
  companions: new CompanionRepository(f.database, f.vault.id, randomUUID),
  chapters: new ChapterRepository(f.database, f.vault.id, randomUUID),
});

test('migration 8 upgrades an existing Step 7 database and enforces join integrity', async t => {
  const f = await fixture(t, false);
  await migrateDatabase(f.database, f.services, migrations.slice(0, 7));
  const stamp = '2026-09-30T00:00:00.000Z'; const vaultId = randomUUID();
  await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', vaultId, 'Vault', stamp, stamp);
  await migrateDatabase(f.database, f.services);
  const tables = await f.connection.getAllAsync("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('companions','trip_companions','chapters','trip_chapters') ORDER BY name");
  assert.deepEqual(tables.map(row => row.name), ['chapters', 'companions', 'trip_chapters', 'trip_companions']);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version, 10);
  const violations = await f.connection.getAllAsync('PRAGMA foreign_key_check'); assert.deepEqual(violations, []);
});

test('Companion create/read/update allows duplicate trimmed display names and persists after restart', async t => {
  const f = await fixture(t); const { companions } = repos(f);
  const first = await companions.create({ displayName: ' Rahul ', note: ' Hostel friend ' });
  const second = await companions.create({ displayName: 'Rahul' });
  assert.notEqual(first.id, second.id); assert.equal(first.displayName, 'Rahul'); assert.equal(first.note, 'Hostel friend');
  await companions.update(first.id, { displayName: ' Aman from Hostel ', note: null });
  await assert.rejects(companions.create({ displayName: '  ' }), /nonempty/);
  await f.database.close(); const connection = new NodeConnection(f.path);
  try {
    await configureConnection(connection); const reopened = new CompanionRepository(new LocalDatabase(connection), f.vault.id, randomUUID);
    assert.deepEqual((await reopened.list()).map(value => value.displayName), ['Aman from Hostel', 'Rahul']);
    assert.equal((await reopened.get(first.id)).note, null);
  } finally { await connection.closeAsync(); }
});

test('Companion memberships are idempotent, reusable across Trips, detachable and Trip-isolated', async t => {
  const f = await fixture(t); const { companions } = repos(f);
  const a = await f.trips.createTripDraft({ title: 'A' }); const b = await f.trips.createTripDraft({ title: 'B' });
  const rahul = await companions.create({ displayName: 'Rahul' });
  const one = await companions.attachToTrip(a.id, rahul.id); const again = await companions.attachToTrip(a.id, rahul.id);
  assert.equal(one, again); assert.equal((await f.connection.getFirstAsync('SELECT COUNT(*) count FROM trip_companions WHERE deleted_at IS NULL')).count, 1);
  await companions.attachToTrip(b.id, rahul.id);
  assert.deepEqual((await companions.listTrips(rahul.id)).map(t => t.id).sort(), [a.id, b.id].sort());
  assert.deepEqual((await companions.listForTrip(a.id)).map(c => c.id), [rahul.id]);
  await companions.detachFromTrip(b.id, rahul.id); assert.deepEqual((await companions.listTrips(rahul.id)).map(t => t.id), [a.id]);
  await companions.attachToTrip(b.id, rahul.id); assert.equal((await f.connection.getFirstAsync('SELECT COUNT(*) count FROM trip_companions')).count, 2);
});

test('Companion vault isolation, removal and deleted Trip counts preserve Trips and restore valid memberships', async t => {
  const f = await fixture(t); const { companions } = repos(f); const trip = await f.trips.createTripDraft({ title: 'Keep' });
  const mom = await companions.create({ displayName: 'Mom' }); await companions.attachToTrip(trip.id, mom.id);
  const otherVault = randomUUID(); const stamp = '2026-09-30T00:00:00.000Z';
  await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', otherVault, 'Other', stamp, stamp);
  const other = new CompanionRepository(f.database, otherVault, randomUUID);
  await assert.rejects(other.attachToTrip(trip.id, mom.id), /Trip not found/); assert.deepEqual(await other.list(), []);
  await f.trips.trashTrip(trip.id); assert.equal((await companions.list())[0].tripCount, 0);
  await f.trips.restoreTrip(trip.id); assert.equal((await companions.list())[0].tripCount, 1);
  await companions.remove(mom.id); assert.ok(await f.trips.getTripById(trip.id)); assert.deepEqual(await companions.list(), []);
  await companions.restore(mom.id); assert.deepEqual((await companions.listTrips(mom.id)).map(t => t.id), [trip.id]);
});

test('Chapter create/read/update is deterministic, custom and normalized-unique', async t => {
  const f = await fixture(t); const { chapters } = repos(f);
  const college = await chapters.create({ title: ' College Years ', description: ' Old trips ' });
  const bikes = await chapters.create({ title: 'Bike Trips' });
  assert.deepEqual((await chapters.list()).map(c => [c.title, c.position]), [['College Years', 0], ['Bike Trips', 1]]);
  await chapters.update(college.id, { title: 'First Job', description: null });
  assert.equal((await chapters.get(college.id)).title, 'First Job');
  await assert.rejects(chapters.create({ title: '  bike trips  ' }));
  await assert.rejects(chapters.create({ title: '' }), /nonempty/);
});

test('one Trip can use multiple Chapters and one Chapter can hold multiple Trips with idempotent detach/attach', async t => {
  const f = await fixture(t); const { chapters } = repos(f);
  const a = await f.trips.createTripDraft({ title: 'A' }); const b = await f.trips.createTripDraft({ title: 'B' });
  const college = await chapters.create({ title: 'College Years' }); const bikes = await chapters.create({ title: 'Bike Trips' });
  const first = await chapters.attachTrip(a.id, college.id); assert.equal(await chapters.attachTrip(a.id, college.id), first);
  await chapters.attachTrip(b.id, college.id); await chapters.attachTrip(a.id, bikes.id);
  assert.deepEqual((await chapters.listForTrip(a.id)).map(c => c.id), [college.id, bikes.id]);
  assert.deepEqual((await chapters.listTrips(college.id)).map(t => t.id), [a.id, b.id]);
  await chapters.detachTrip(a.id, college.id); assert.deepEqual((await chapters.listForTrip(a.id)).map(c => c.id), [bikes.id]);
  await chapters.detachTrip(a.id, college.id); await chapters.attachTrip(a.id, college.id);
  assert.equal((await f.connection.getFirstAsync('SELECT COUNT(*) count FROM trip_chapters')).count, 3);
});

test('Chapter Trip/vault isolation, removal and deleted Trip counts preserve Trip data', async t => {
  const f = await fixture(t); const { chapters } = repos(f); const trip = await f.trips.createTripDraft({ title: 'Keep chapter trip' });
  const chapter = await chapters.create({ title: 'Himachal' }); await chapters.attachTrip(trip.id, chapter.id);
  const other = new ChapterRepository(f.database, randomUUID(), randomUUID);
  await assert.rejects(other.attachTrip(trip.id, chapter.id), /Trip not found/); assert.deepEqual(await other.list(), []);
  await f.trips.trashTrip(trip.id); assert.equal((await chapters.list())[0].tripCount, 0);
  await f.trips.restoreTrip(trip.id); assert.equal((await chapters.list())[0].tripCount, 1);
  await chapters.remove(chapter.id); assert.equal((await f.trips.getTripById(trip.id)).title, 'Keep chapter trip');
  await chapters.restore(chapter.id); assert.deepEqual((await chapters.listTrips(chapter.id)).map(t => t.id), [trip.id]);
});

test('explicitly detached memberships stay detached across Trip trash/restore and Chapter data persists after restart', async t => {
  const f = await fixture(t); const { companions, chapters } = repos(f); const trip = await f.trips.createTripDraft({ title: 'Detached' });
  const person = await companions.create({ displayName: 'College Gang' }); const chapter = await chapters.create({ title: 'Family Trips' });
  await companions.attachToTrip(trip.id, person.id); await chapters.attachTrip(trip.id, chapter.id);
  await companions.detachFromTrip(trip.id, person.id); await chapters.detachTrip(trip.id, chapter.id);
  await f.trips.trashTrip(trip.id); await f.trips.restoreTrip(trip.id);
  assert.deepEqual(await companions.listForTrip(trip.id), []); assert.deepEqual(await chapters.listForTrip(trip.id), []);
  await f.database.close(); const connection = new NodeConnection(f.path);
  try {
    await configureConnection(connection); const db = new LocalDatabase(connection);
    const reopened = new ChapterRepository(db, f.vault.id, randomUUID); assert.equal((await reopened.get(chapter.id)).title, 'Family Trips');
  } finally { await connection.closeAsync(); }
});
