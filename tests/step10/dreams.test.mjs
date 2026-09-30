import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrateDatabase, migrations } from '../../.expo/step1-tests/core/database/migrate.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { DreamRepository } from '../../.expo/step1-tests/features/dreams/repository.js';
import { TravelLifeRepository } from '../../.expo/step1-tests/features/life/repository.js';

const stamp = '2026-09-30T12:00:00.000Z';
const exactYear = year => ({ start: { precision: 'year', value: String(year) }, end: null, certainty: 'exact', source: 'user' });

function repositories(f, vaultId = f.vault.id, now = () => stamp) {
  return {
    trips: vaultId === f.vault.id ? f.trips : new TripRepository(f.database, vaultId, randomUUID, now),
    routes: new RouteRepository(f.database, vaultId, randomUUID, now),
    dreams: new DreamRepository(f.database, vaultId, randomUUID, now),
    life: new TravelLifeRepository(f.database, vaultId),
  };
}

async function savedTrip(repos, title = 'Spiti Road Trip', dates = exactYear(2028)) {
  const trip = await repos.trips.createTripDraft({ title, dates });
  return repos.trips.updateBasicTripFields(trip.id, { status: 'saved' });
}

test('migration 9 upgrades Step 8 and installs only Dream destination/visit domain tables', async t => {
  const f = await fixture(t, false);
  await migrateDatabase(f.database, f.services, migrations.slice(0, 8));
  await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', randomUUID(), 'Existing vault', stamp, stamp);
  await migrateDatabase(f.database, f.services);
  const tables = await f.connection.getAllAsync("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'dream_%' ORDER BY name");
  assert.deepEqual(tables.map(row => row.name), ['dream_destinations', 'dream_visits']);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version, 9);
  assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'), []);
});

test('Dream CRUD trims text, accepts unknown geography and coordinate pairs, rejects partial pairs, and allows duplicate titles', async t => {
  const f = await fixture(t); const { dreams, routes } = repositories(f);
  const existing = await routes.createPlace({ name: 'Japan' });
  const first = await dreams.create({ title: ' Japan ', note: ' Cherry blossoms ', locationText: ' East Asia ' });
  const second = await dreams.create({ title: 'Japan', latitude: 35.6762, longitude: 139.6503 });
  assert.notEqual(first.id, second.id); assert.notEqual(first.placeId, second.placeId); assert.notEqual(first.placeId, existing.id);
  assert.deepEqual([first.title, first.note, first.locationText, first.latitude], ['Japan', 'Cherry blossoms', 'East Asia', null]);
  assert.deepEqual([second.latitude, second.longitude], [35.6762, 139.6503]);
  await assert.rejects(dreams.create({ title: 'Partial', latitude: 12, longitude: null }), /enter both latitude/);
  await assert.rejects(dreams.create({ title: '  ' }), /nonempty/);
  const createdAt = first.createdAt;
  const edited = await dreams.update(first.id, { title: ' Kyoto ', note: null, locationText: ' Kansai ', latitude: 35.0116, longitude: 135.7681 });
  assert.equal(edited.title, 'Kyoto'); assert.equal(edited.createdAt, createdAt); assert.equal(edited.note, null);
  const place = await routes.getPlace(first.placeId); assert.deepEqual([place.name, place.latitude, place.longitude], ['Kyoto', 35.0116, 135.7681]);
});

test('active ordering is deterministic and no matching Place name or Stop auto-fulfils a Dream', async t => {
  const f = await fixture(t); const repos = repositories(f);
  const trip = await savedTrip(repos, 'Japan memories');
  await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Japan' });
  const zanskar = await repos.dreams.create({ title: 'Zanskar' });
  const japan = await repos.dreams.create({ title: 'Japan' });
  const ladakh = await repos.dreams.create({ title: 'Ladakh' });
  assert.deepEqual((await repos.dreams.listActive()).map(dream => dream.title), ['Japan', 'Ladakh', 'Zanskar']);
  assert.equal((await repos.dreams.get(japan.id)).status, 'dreaming');
  assert.equal((await repos.dreams.get(japan.id)).visits.length, 0);
  assert.ok(zanskar.id && ladakh.id);
});

test('mark visited explicitly links the existing canonical Place and Trip while preserving original Dream history', async t => {
  const f = await fixture(t); const repos = repositories(f);
  const dream = await repos.dreams.create({ title: 'Spiti Valley', note: 'One day, slowly.', locationText: 'Himachal Pradesh' });
  const createdAt = dream.createdAt; const addedDates = dream.addedDates;
  const trip = await savedTrip(repos); const stop = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Kaza' }, { dates: exactYear(2028) });
  const options = await repos.dreams.listVisitOptions(dream.id);
  assert.deepEqual(options.map(value => [value.stopId, value.placeId, value.tripId]), [[stop.id, stop.place.id, trip.id]]);
  const visit = await repos.dreams.linkVisit(dream.id, stop.id);
  const fulfilled = await repos.dreams.get(dream.id);
  assert.equal(fulfilled.status, 'visited'); assert.equal(fulfilled.createdAt, createdAt); assert.deepEqual(fulfilled.addedDates, addedDates);
  assert.equal(fulfilled.note, 'One day, slowly.'); assert.equal(visit.placeId, stop.place.id); assert.equal(visit.tripId, trip.id);
  assert.deepEqual((await repos.dreams.listActive()).map(value => value.id), [dream.id]);
  await repos.dreams.unlinkVisit(dream.id, visit.id); assert.equal((await repos.dreams.get(dream.id)).status, 'dreaming');
  await repos.dreams.linkVisit(dream.id, stop.id); assert.equal((await f.connection.getFirstAsync('SELECT COUNT(*) count FROM dream_visits')).count, 1);
});

test('visited linkage requires an eligible saved confirmed visit/stay and enforces vault isolation', async t => {
  const f = await fixture(t); const repos = repositories(f); const dream = await repos.dreams.create({ title: 'Eligible only' });
  const draft = await repos.trips.createTripDraft({ title: 'Draft' });
  const draftStop = await repos.routes.createPlaceAndAddStop(draft.id, { name: 'Draft place' });
  await assert.rejects(repos.dreams.linkVisit(dream.id, draftStop.id), /confirmed visit or stay/);
  const trip = await savedTrip(repos); const transit = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Pass through' }, { kind: 'transit' });
  const unconfirmed = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Suggestion' }, { visitConfirmed: false });
  await assert.rejects(repos.dreams.linkVisit(dream.id, transit.id), /confirmed visit or stay/);
  await assert.rejects(repos.dreams.linkVisit(dream.id, unconfirmed.id), /confirmed visit or stay/);
  const otherVault = randomUUID(); await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', otherVault, 'Other', stamp, stamp);
  const other = repositories(f, otherVault);
  assert.deepEqual(await other.dreams.listActive(), []); assert.equal(await other.dreams.get(dream.id), null);
  const otherDream = await other.dreams.create({ title: 'Private other vault' });
  await assert.rejects(other.dreams.linkVisit(otherDream.id, transit.id), /confirmed visit or stay/);
});

test('archive/unarchive and tombstone remove/restore affect only the Dream and preserve linked canonical records', async t => {
  const f = await fixture(t); const repos = repositories(f); const dream = await repos.dreams.create({ title: 'Meghalaya' });
  const trip = await savedTrip(repos, 'Northeast'); const stop = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Shillong' });
  await repos.dreams.linkVisit(dream.id, stop.id);
  await repos.dreams.archive(dream.id); assert.deepEqual(await repos.dreams.listActive(), []);
  assert.deepEqual((await repos.dreams.listArchived()).map(value => value.id), [dream.id]);
  await repos.dreams.unarchive(dream.id); assert.equal((await repos.dreams.get(dream.id)).status, 'visited');
  await repos.dreams.remove(dream.id); assert.equal(await repos.dreams.get(dream.id), null); assert.equal((await repos.dreams.getRemoved(dream.id)).title, 'Meghalaya');
  assert.equal((await repos.trips.getTripById(trip.id)).title, 'Northeast'); assert.equal((await repos.routes.getPlace(stop.place.id)).name, 'Shillong');
  assert.equal((await repos.routes.getPlace(dream.placeId)).name, 'Meghalaya');
  await repos.dreams.restore(dream.id); assert.equal((await repos.dreams.get(dream.id)).status, 'visited');
});

test('Stop and Trip removal revise derived visited state safely and restoration recovers only the explicit link', async t => {
  const f = await fixture(t); const repos = repositories(f); const dream = await repos.dreams.create({ title: 'Ladakh' });
  const trip = await savedTrip(repos, 'Ladakh ride'); const stop = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Leh' });
  const visit = await repos.dreams.linkVisit(dream.id, stop.id);
  await repos.routes.removeStop(trip.id, stop.id); assert.equal((await repos.dreams.get(dream.id)).status, 'dreaming');
  await repos.routes.restoreStop(trip.id, stop.id); assert.equal((await repos.dreams.get(dream.id)).status, 'visited');
  await repos.dreams.unlinkVisit(dream.id, visit.id); await repos.trips.trashTrip(trip.id); await repos.trips.restoreTrip(trip.id);
  assert.equal((await repos.dreams.get(dream.id)).status, 'dreaming');
});

test('Dreams never change or double-count Travel Life statistics', async t => {
  const f = await fixture(t); const repos = repositories(f); const trip = await savedTrip(repos, 'Canonical trip');
  const stop = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Canonical place' });
  const baseline = (await repos.life.overview()).metrics;
  const dream = await repos.dreams.create({ title: 'Canonical place' });
  assert.deepEqual((await repos.life.overview()).metrics, baseline);
  await repos.dreams.linkVisit(dream.id, stop.id); assert.deepEqual((await repos.life.overview()).metrics, baseline);
  await repos.dreams.remove(dream.id); assert.deepEqual((await repos.life.overview()).metrics, baseline);
  assert.deepEqual({ trips: baseline.trips, places: baseline.places, visits: baseline.visits }, { trips: 1, places: 1, visits: 1 });
});

test('Dreams persist after database restart with deterministic history and links', async t => {
  const f = await fixture(t); const repos = repositories(f); const dream = await repos.dreams.create({ title: 'Zanskar', note: 'Offline dream' });
  const trip = await savedTrip(repos, 'Zanskar Road Trip'); const stop = await repos.routes.createPlaceAndAddStop(trip.id, { name: 'Padum' });
  await repos.dreams.linkVisit(dream.id, stop.id); await f.database.close();
  const connection = new NodeConnection(f.path);
  try {
    await configureConnection(connection); const database = new LocalDatabase(connection);
    const reopened = new DreamRepository(database, f.vault.id, randomUUID, () => stamp);
    const value = await reopened.get(dream.id);
    assert.equal(value.title, 'Zanskar'); assert.equal(value.note, 'Offline dream'); assert.equal(value.status, 'visited');
    assert.deepEqual(value.visits.map(visit => [visit.placeName, visit.tripTitle]), [['Padum', 'Zanskar Road Trip']]);
  } finally { await connection.closeAsync(); }
});
