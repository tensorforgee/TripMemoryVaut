import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { configureConnection, LocalDatabase } from '../../.expo/step1-tests/core/database/database.js';
import { migrateDatabase, migrations } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { placeFields, parseCoordinates } from '../../.expo/step1-tests/domain/place.js';
import { orderedPosition, stopFields } from '../../.expo/step1-tests/domain/stop.js';
import { placeForm, placeFormPatch, stopForm, stopFormPatch } from '../../.expo/step1-tests/features/route/forms.js';

async function setup(t) {
  const f = await fixture(t);
  return { ...f, routes: new RouteRepository(f.database, f.vault.id, randomUUID), trip: await f.trips.createTripDraft({ title: 'Synthetic route test' }) };
}
const year = value => ({ start: { precision: 'year', value }, end: null, certainty: 'approximate', source: 'user' });

test('version 1 upgrades without changing trip/vault data and is idempotent', async t => {
  const f = await fixture(t, false);
  await migrateDatabase(f.database, f.services, migrations.slice(0, 1));
  const vault = await getOrCreateVault(f.database, randomUUID);
  const trips = new TripRepository(f.database, vault.id, randomUUID);
  const trip = await trips.createTripDraft({ title: 'Before upgrade', dates: year('2022') });
  const ledger = await f.connection.getAllAsync('SELECT * FROM schema_migrations');
  await migrateDatabase(f.database, f.services);
  assert.deepEqual(await trips.getTripById(trip.id), trip);
  assert.equal((await getOrCreateVault(f.database, randomUUID)).id, vault.id);
  assert.deepEqual((await f.connection.getAllAsync('SELECT * FROM schema_migrations ORDER BY version'))[0], ledger[0]);
  assert.deepEqual((await f.connection.getAllAsync("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")).map(r => r.name), ['chapters', 'companions', 'draft_suggestions', 'dream_destinations', 'dream_visits', 'import_batches', 'import_items', 'local_media_files', 'media', 'places', 'schema_migrations', 'stops', 'trip_chapters', 'trip_companions', 'trip_days', 'trip_media', 'trips', 'vaults']);
  assert.equal((await f.connection.getFirstAsync('SELECT order_revision FROM trips')).order_revision, 0);
  await migrateDatabase(f.database, f.services);
  assert.equal(f.backups.length, 2);
  assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'), []);
});

test('failed Places/Stops migration restores version 1 and its committed data', async t => {
  const f = await fixture(t, false);
  await migrateDatabase(f.database, f.services, migrations.slice(0, 1));
  const vault = await getOrCreateVault(f.database, randomUUID);
  const trips = new TripRepository(f.database, vault.id, randomUUID);
  const trip = await trips.createTripDraft({ title: 'Keep before migration' });
  await assert.rejects(migrateDatabase(f.database, f.services, [migrations[0], { version: 2, sql: migrations[1].sql + '\nINVALID SQL;' }]), /snapshot was restored/);
  assert.deepEqual(await trips.getTripById(trip.id), trip);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version, 1);
  assert.equal(await f.connection.getFirstAsync("SELECT name FROM sqlite_schema WHERE name='places'"), null);
  await migrateDatabase(f.database, f.services);
});

test('places create/read/update, preserve provenance, permit duplicate names and literal local lookup', async t => {
  const f = await setup(t);
  const place = await f.routes.createPlace({ name: ' Shimla ', source: 'import', provenance: { note: 'Old archive' }, aliases: ['Simla'] });
  assert.equal(place.name, 'Shimla');
  assert.equal(place.latitude, null);
  assert.equal(place.longitude, null);
  assert.equal(place.coordinatePrecision, 'unknown');
  assert.deepEqual(await f.routes.getPlace(place.id), place);
  const second = await f.routes.createPlace({ name: 'Shimla' });
  assert.notEqual(place.id, second.id);
  assert.equal((await f.routes.listPlaces('shim')).length, 2);
  assert.equal((await f.routes.listPlaces('', 1, 1)).length, 1);
  await f.routes.createPlace({ name: '100%_Local' });
  assert.deepEqual((await f.routes.listPlaces('%_')).map(p => p.name), ['100%_Local']);
  const changed = await f.routes.updatePlace(place.id, placeFormPatch({ ...placeForm(place), name: 'Renamed' }, place));
  assert.equal(changed.name, 'Renamed');
  assert.deepEqual(changed.provenance, place.provenance);
  assert.deepEqual(changed.aliases, place.aliases);
  assert.equal(changed.source, 'import');
  assert.equal(changed.createdAt, place.createdAt);
  await assert.rejects(f.routes.updatePlace(place.id, { id: randomUUID() }), /not supported/);
});

test('coordinate pairs, ranges, precision and names validate without invented zero coordinates', async t => {
  const f = await setup(t);
  for (const coordinates of [{ latitude: 30 }, { longitude: 70 }, { latitude: NaN, longitude: 70 }, { latitude: 91, longitude: 70 }, { latitude: 30, longitude: -181 }, { latitude: null, longitude: 0 }]) {
    await assert.rejects(f.routes.createPlace({ name: 'Invalid', ...coordinates }));
  }
  await assert.rejects(f.routes.createPlace({ name: '  ' }));
  await assert.rejects(f.routes.createPlace({ name: 'Invalid precision', coordinatePrecision: 'point' }));
  assert.throws(() => placeFields({ name: 'Invalid', coordinatePrecision: 'approximate' }));
  assert.throws(() => parseCoordinates('0', '0'));
  const zero = await f.routes.createPlace({ name: 'Explicit zero fixture', latitude: 0, longitude: 0, coordinatePrecision: 'point' });
  assert.equal(zero.latitude, 0);
  const area = await f.routes.updatePlace(zero.id, { latitude: 31, longitude: 77, coordinatePrecision: 'area' });
  assert.equal(area.coordinatePrecision, 'area');
  await assert.rejects(f.connection.runAsync('UPDATE places SET longitude=NULL WHERE id=?', area.id), /CHECK/);
  const cleared = await f.routes.updatePlace(area.id, { latitude: null, longitude: null, coordinatePrecision: 'unknown' });
  assert.equal(cleared.latitude, null);
});

test('ordered repeated places have distinct stop IDs, reused across trips', async t => {
  const f = await setup(t);
  const a = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'A' });
  const b = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'B' });
  const a2 = await f.routes.addStop(f.trip.id, { placeId: a.placeId });
  assert.notEqual(a.id, a2.id);
  assert.deepEqual((await f.routes.listStops(f.trip.id)).map(s => [s.position, s.place.name]), [[0, 'A'], [1, 'B'], [2, 'A']]);
  const another = await f.trips.createTripDraft({ title: 'Another' });
  await f.routes.addStop(another.id, { placeId: a.placeId });
  assert.equal((await f.routes.listStops(another.id)).length, 1);
  assert.equal((await f.routes.listStops(f.trip.id)).length, 3);
  await f.routes.updatePlace(a.placeId, { name: 'Shared A' });
  assert.equal((await f.routes.getStop(f.trip.id, a2.id)).place.name, 'Shared A');
  assert.equal((await f.routes.listStops(another.id))[0].place.name, 'Shared A');
  assert.equal((await f.routes.getStop(f.trip.id, b.id)).place.name, 'B');
});

test('new place and stop insert is atomic and rolls back invalid stop or failed insert', async t => {
  const f = await setup(t);
  await assert.rejects(f.routes.createPlaceAndAddStop(f.trip.id, { name: 'No orphan' }, { kind: 'hotel' }));
  assert.deepEqual(await f.routes.listPlaces(), []);
  await f.connection.execAsync("CREATE TRIGGER reject_stop BEFORE INSERT ON stops BEGIN SELECT RAISE(ABORT,'Failure fixture'); END;");
  await assert.rejects(f.routes.createPlaceAndAddStop(f.trip.id, { name: 'No orphan' }), /Failure fixture/);
  assert.deepEqual(await f.routes.listPlaces(), []);
  assert.deepEqual(await f.routes.getRoute(f.trip.id), { revision: 0, stops: [] });
});

test('reorder uses disjoint temporary positions; stale, duplicate, omitted and foreign IDs rejected', async t => {
  const f = await setup(t);
  for (const name of ['A', 'B', 'C']) await f.routes.createPlaceAndAddStop(f.trip.id, { name });
  const before = await f.routes.getRoute(f.trip.id);
  const ids = before.stops.map(s => s.id).reverse();
  await f.routes.reorderStops(f.trip.id, ids, before.revision);
  assert.deepEqual((await f.routes.listStops(f.trip.id)).map(s => [s.id, s.position]), ids.map((id, i) => [id, i]));
  await assert.rejects(f.routes.reorderStops(f.trip.id, ids, before.revision), /Route changed/);
  const revision = (await f.routes.getRoute(f.trip.id)).revision;
  for (const invalid of [[ids[0], ids[0], ids[2]], ids.slice(1), [ids[0], ids[1], randomUUID()]]) await assert.rejects(f.routes.reorderStops(f.trip.id, invalid, revision), /every active stop/);
  assert.throws(() => orderedPosition(-1));
  assert.throws(() => orderedPosition(1.5));
  assert.throws(() => orderedPosition(Number.MAX_SAFE_INTEGER + 1));
});

test('mid-reorder failure rolls back positions, revision and notifications', async t => {
  const f = await setup(t);
  for (const name of ['A', 'B', 'C']) await f.routes.createPlaceAndAddStop(f.trip.id, { name });
  const before = await f.routes.getRoute(f.trip.id);
  let notifications = 0;
  f.routes.subscribe(() => { notifications++; });
  await f.connection.execAsync("CREATE TRIGGER reject_position BEFORE UPDATE OF position ON stops WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'Reorder fixture'); END;");
  await assert.rejects(f.routes.reorderStops(f.trip.id, before.stops.map(s => s.id).reverse(), before.revision), /Reorder fixture/);
  assert.deepEqual(await f.routes.getRoute(f.trip.id), before);
  assert.equal(notifications, 0);
  await f.connection.execAsync('DROP TRIGGER reject_position');
  await f.routes.reorderStops(f.trip.id, before.stops.map(s => s.id).reverse(), before.revision);
  assert.equal(notifications, 1);
});

test('remove tombstones only one occurrence, retains place, compacts order and can undo', async t => {
  const f = await setup(t);
  const a = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'A' });
  const b = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'B' });
  await f.routes.addStop(f.trip.id, { placeId: a.placeId });
  await f.routes.removeStop(f.trip.id, a.id);
  assert.deepEqual((await f.routes.listStops(f.trip.id)).map(s => [s.position, s.place.name]), [[0, 'B'], [1, 'A']]);
  assert.ok(await f.routes.getPlace(a.placeId));
  assert.ok((await f.connection.getFirstAsync('SELECT deleted_at FROM stops WHERE id=?', a.id)).deleted_at);
  await assert.rejects(f.routes.trashPlace(a.placeId), /referenced/);
  await f.routes.restoreStop(f.trip.id, a.id);
  assert.equal((await f.routes.listStops(f.trip.id))[2].id, a.id);
  await f.routes.removeStop(f.trip.id, b.id);
  await f.routes.trashPlace(b.placeId);
  assert.equal(await f.routes.getPlace(b.placeId), null);
  await assert.rejects(f.routes.restoreStop(f.trip.id, b.id), /active trip and place/);
});

test('visit, stay, transit, unconfirmed and approximate details roundtrip without fake dates', async t => {
  const f = await setup(t);
  const stop = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'Stay' }, { kind: 'stay', lodgingLabel: 'Remembered guesthouse',
    dates: year('2022'), checkoutDates: year('2023'), note: 'Uncertain recollection', visitConfirmed: false, detailCertainty: 'approximate' });
  assert.equal(stop.kind, 'stay');
  assert.equal(stop.checkoutDates.certainty, 'approximate');
  assert.equal(stop.visitConfirmed, false);
  const form = { ...stopForm(stop), kind: 'transit' };
  const transit = await f.routes.editStop(f.trip.id, stop.id, stopFormPatch(form, stop));
  assert.equal(transit.kind, 'transit');
  assert.equal(transit.lodgingLabel, null);
  assert.equal(transit.checkoutDates, null);
  const visit = await f.routes.editStop(f.trip.id, stop.id, { kind: 'visit', dates: null, note: null, detailCertainty: 'unknown', visitConfirmed: true });
  assert.equal(visit.dates, null);
  assert.equal(visit.detailCertainty, 'unknown');
  for (const patch of [{ kind: 'hotel' }, { detailCertainty: 'likely' }, { visitConfirmed: 1 }, { position: -1 }, { lodgingLabel: 'Not stay' }]) await assert.rejects(f.routes.editStop(f.trip.id, stop.id, patch));
  assert.throws(() => stopFields({ placeId: stop.placeId, kind: 'stay', dates: year('2024'), checkoutDates: year('2022') }), /precede/);
});

test('trip and vault isolation, deleted parents and direct SQL guards', async t => {
  const f = await setup(t);
  const stop = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'Private' });
  const another = await f.trips.createTripDraft({ title: 'Other trip' });
  await assert.rejects(f.routes.editStop(another.id, stop.id, { note: 'Wrong trip' }), /unavailable/);
  await assert.rejects(f.routes.removeStop(another.id, stop.id), /unavailable/);
  const otherVaultId = randomUUID();
  const timestamp = new Date().toISOString();
  await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', otherVaultId, 'Other vault', timestamp, timestamp);
  const otherRepo = new RouteRepository(f.database, otherVaultId, randomUUID);
  const otherTrips = new TripRepository(f.database, otherVaultId, randomUUID);
  const otherTrip = await otherTrips.createTripDraft({ title: 'Other vault trip' });
  assert.equal(await otherRepo.getPlace(stop.placeId), null);
  assert.deepEqual(await otherRepo.listPlaces(), []);
  await assert.rejects(otherRepo.addStop(otherTrip.id, { placeId: stop.placeId }), /unavailable/);
  await assert.rejects(f.connection.runAsync('UPDATE stops SET trip_id=? WHERE id=?', otherTrip.id, stop.id), /active trip and place/);
  await assert.rejects(f.connection.runAsync('UPDATE stops SET position=-1 WHERE id=?', stop.id), /CHECK/);
  await assert.rejects(f.connection.runAsync('DELETE FROM places WHERE id=?', stop.placeId), /FOREIGN KEY/);
  await f.trips.trashTrip(f.trip.id);
  await assert.rejects(f.routes.getRoute(f.trip.id), /unavailable/);
  await assert.rejects(f.routes.addStop(f.trip.id, { placeId: stop.placeId }), /unavailable/);
  await assert.rejects(f.routes.trashPlace(stop.placeId), /referenced/);
});

test('trip trash restores only its own stops, preserves prior removals and shared places across cycles', async t => {
  const f = await setup(t);
  const a = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'Keep' });
  const b = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'Removed separately' });
  await f.routes.removeStop(f.trip.id, b.id);
  for (let cycle = 0; cycle < 2; cycle++) {
    await f.trips.trashTrip(f.trip.id);
    const rows = await f.connection.getAllAsync('SELECT id,deleted_at,deleted_by_trip FROM stops ORDER BY id');
    assert.ok(rows.every(s => s.deleted_at));
    assert.equal(rows.find(s => s.id === a.id).deleted_by_trip, 1);
    assert.equal(rows.find(s => s.id === b.id).deleted_by_trip, 0);
    await f.trips.restoreTrip(f.trip.id);
    assert.deepEqual((await f.routes.listStops(f.trip.id)).map(s => s.id), [a.id]);
    assert.ok(await f.routes.getPlace(b.placeId));
  }
});

test('aggregate delete failure rolls back trip and children', async t => {
  const f = await setup(t);
  await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'Keep' });
  await f.connection.execAsync("CREATE TRIGGER reject_trash BEFORE UPDATE OF deleted_at ON stops BEGIN SELECT RAISE(ABORT,'Trash fixture'); END;");
  await assert.rejects(f.trips.trashTrip(f.trip.id), /Trash fixture/);
  assert.ok(await f.trips.getTripById(f.trip.id));
  assert.equal((await f.routes.listStops(f.trip.id)).length, 1);
});

test('route fields, order, reusable places and tombstones survive database restart', async t => {
  const f = await setup(t);
  const a = await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'A' });
  await f.routes.createPlaceAndAddStop(f.trip.id, { name: 'B', latitude: 31, longitude: 77, coordinatePrecision: 'area' }, { kind: 'stay', lodgingLabel: 'Lodge' });
  await f.routes.addStop(f.trip.id, { placeId: a.placeId, kind: 'transit' });
  const route = await f.routes.getRoute(f.trip.id);
  await f.routes.reorderStops(f.trip.id, route.stops.map(s => s.id).reverse(), route.revision);
  const expected = await f.routes.getRoute(f.trip.id);
  await f.database.close();
  const reopened = new NodeConnection(f.path);
  try {
    await configureConnection(reopened);
    const repo = new RouteRepository(new LocalDatabase(reopened), f.vault.id, randomUUID);
    assert.deepEqual(await repo.getRoute(f.trip.id), expected);
    assert.equal((await repo.listPlaces()).length, 2);
  } finally { await reopened.closeAsync(); }
});
