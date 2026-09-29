import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from '../step1/sqlite-harness.mjs';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { CompanionRepository } from '../../.expo/step1-tests/features/companions/repository.js';
import { ChapterRepository } from '../../.expo/step1-tests/features/chapters/repository.js';
import { TravelLifeRepository } from '../../.expo/step1-tests/features/life/repository.js';

const stamp = '2026-09-30T00:00:00.000Z';
const exactYear = year => ({ start: { precision: 'year', value: String(year) }, end: null, certainty: 'exact', source: 'user' });
const approximateYear = year => ({ start: { precision: 'year', value: String(year) }, end: null, certainty: 'approximate', source: 'user' });
const unknownDate = () => ({ start: { precision: 'unknown' }, end: null, certainty: 'unknown', source: 'user' });

function repositories(f, vaultId = f.vault.id) {
  return {
    trips: vaultId === f.vault.id ? f.trips : new TripRepository(f.database, vaultId, randomUUID),
    routes: new RouteRepository(f.database, vaultId, randomUUID),
    companions: new CompanionRepository(f.database, vaultId, randomUUID),
    chapters: new ChapterRepository(f.database, vaultId, randomUUID),
    life: new TravelLifeRepository(f.database, vaultId),
  };
}

async function savedTrip(trips, title, dates = exactYear(2024)) {
  const trip = await trips.createTripDraft({ title, dates });
  return trips.updateBasicTripFields(trip.id, { status: 'saved' });
}

async function placeStop(routes, tripId, name, options = {}) {
  return routes.createPlaceAndAddStop(tripId, { name }, options);
}

async function addMedia(connection, vaultId, tripId, number, mediaId) {
  const id = mediaId ?? randomUUID();
  if (!mediaId) {
    const hash = number.toString(16).padStart(64, '0');
    await connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,source_fidelity,
      source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    id, vaultId, hash, 100 + number, 'image/jpeg', 'jpg', 'original_confirmed', '{}', 1, stamp, stamp);
  }
  const placement = randomUUID();
  const row = await connection.getFirstAsync('SELECT COALESCE(MAX(position),-1)+1 position FROM trip_media WHERE trip_id=? AND deleted_at IS NULL', tripId);
  await connection.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,position,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`, placement, vaultId, tripId, id, Number(row.position), stamp, stamp);
  return { mediaId: id, placementId: placement };
}

test('active Trip, unique Place and visit aggregates use saved canonical identity semantics', async t => {
  const f = await fixture(t); const { trips, routes, life } = repositories(f);
  const first = await savedTrip(trips, 'Kinnaur'); const second = await savedTrip(trips, 'Return');
  const sangla = await routes.createPlace({ name: 'Sangla' });
  const shimla = await routes.createPlace({ name: 'Shimla' });
  await routes.addStop(first.id, { placeId: shimla.id });
  await routes.addStop(first.id, { placeId: sangla.id });
  await routes.addStop(first.id, { placeId: sangla.id, kind: 'stay' });
  await routes.addStop(second.id, { placeId: sangla.id });
  await routes.createPlaceAndAddStop(first.id, { name: 'Passing point' }, { kind: 'transit' });
  await routes.createPlaceAndAddStop(first.id, { name: 'Unconfirmed' }, { visitConfirmed: false });

  const overview = await life.overview();
  assert.deepEqual({ trips: overview.metrics.trips, places: overview.metrics.places, visits: overview.metrics.visits }, { trips: 2, places: 2, visits: 4 });
  assert.deepEqual(await life.listPlaces(), [
    { id: sangla.id, name: 'Sangla', visitCount: 3, tripCount: 2 },
    { id: shimla.id, name: 'Shimla', visitCount: 1, tripCount: 1 },
  ]);
});

test('Trash exclusion and restoration update every aggregate contribution without deleting reusable records', async t => {
  const f = await fixture(t); const { trips, routes, companions, chapters, life } = repositories(f);
  const trip = await savedTrip(trips, 'Complete archive');
  await placeStop(routes, trip.id, 'Chitkul');
  const photo = await addMedia(f.connection, f.vault.id, trip.id, 1);
  const person = await companions.create({ displayName: 'Rahul' }); await companions.attachToTrip(trip.id, person.id);
  const chapter = await chapters.create({ title: 'College Years' }); await chapters.attachTrip(trip.id, chapter.id);
  assert.deepEqual((await life.overview()).metrics, {
    trips: 1, places: 1, visits: 1, photos: 1, photoPlacements: 1, companions: 1, chapters: 1,
    recordedDistance: { status: 'unavailable', kilometres: null, explanation: 'No canonical Trip distance is stored yet. Stop coordinates are never used to estimate it.' },
  });

  await trips.trashTrip(trip.id);
  const trashed = await life.overview();
  assert.deepEqual([trashed.metrics.trips, trashed.metrics.places, trashed.metrics.visits, trashed.metrics.photos, trashed.metrics.companions, trashed.metrics.chapters], [0, 0, 0, 0, 0, 0]);
  assert.ok(await f.connection.getFirstAsync('SELECT id FROM places WHERE name=? AND deleted_at IS NULL', 'Chitkul'));
  assert.ok(await f.connection.getFirstAsync('SELECT id FROM media WHERE id=? AND deleted_at IS NULL', photo.mediaId));
  assert.ok(await f.connection.getFirstAsync('SELECT id FROM companions WHERE id=? AND deleted_at IS NULL', person.id));
  assert.ok(await f.connection.getFirstAsync('SELECT id FROM chapters WHERE id=? AND deleted_at IS NULL', chapter.id));

  await trips.restoreTrip(trip.id);
  const restored = await life.overview();
  assert.deepEqual([restored.metrics.trips, restored.metrics.places, restored.metrics.visits, restored.metrics.photos, restored.metrics.companions, restored.metrics.chapters], [1, 1, 1, 1, 1, 1]);
});

test('removed Stops are excluded and an active Place is counted again only after Stop restoration', async t => {
  const f = await fixture(t); const { trips, routes, life } = repositories(f);
  const trip = await savedTrip(trips, 'Stop removal'); const stop = await placeStop(routes, trip.id, 'Rakchham');
  await routes.removeStop(trip.id, stop.id);
  assert.deepEqual([(await life.overview()).metrics.places, (await life.overview()).metrics.visits], [0, 0]);
  await routes.restoreStop(trip.id, stop.id);
  assert.deepEqual([(await life.overview()).metrics.places, (await life.overview()).metrics.visits], [1, 1]);
});

test('Photos count unique Media while placement count remains explicit and deleted duplicate placements stay excluded', async t => {
  const f = await fixture(t); const { trips, life } = repositories(f);
  const first = await savedTrip(trips, 'One'); const second = await savedTrip(trips, 'Two');
  const shared = await addMedia(f.connection, f.vault.id, first.id, 2);
  await addMedia(f.connection, f.vault.id, second.id, 2, shared.mediaId);
  const deletedDuplicate = randomUUID();
  await f.connection.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,position,created_at,updated_at,deleted_at)
    VALUES(?,?,?,?,?,?,?,?)`, deletedDuplicate, f.vault.id, first.id, shared.mediaId, 99, stamp, stamp, stamp);
  const metrics = (await life.overview()).metrics;
  assert.equal(metrics.photos, 1); assert.equal(metrics.photoPlacements, 2);
});

test('only confirmed stored distance would be eligible; absent schema data stays unavailable and coordinates are not measured', async t => {
  const f = await fixture(t); const { trips, routes, life } = repositories(f);
  const trip = await savedTrip(trips, 'Coordinate route');
  const a = await routes.createPlace({ name: 'A', latitude: 31.1, longitude: 77.1, coordinatePrecision: 'point' });
  const b = await routes.createPlace({ name: 'B', latitude: 32.2, longitude: 78.2, coordinatePrecision: 'point' });
  await routes.addStop(trip.id, { placeId: a.id }); await routes.addStop(trip.id, { placeId: b.id });
  assert.deepEqual((await life.overview()).metrics.recordedDistance, {
    status: 'unavailable', kilometres: null,
    explanation: 'No canonical Trip distance is stored yet. Stop coordinates are never used to estimate it.',
  });
});

test('Companion and Chapter summaries count distinct active saved Trips in archive-defined order', async t => {
  const f = await fixture(t); const { trips, companions, chapters, life } = repositories(f);
  const a = await savedTrip(trips, 'A'); const b = await savedTrip(trips, 'B'); const draft = await trips.createTripDraft({ title: 'Draft' });
  const rahul = await companions.create({ displayName: 'Rahul' }); const aman = await companions.create({ displayName: 'Aman' });
  await companions.attachToTrip(a.id, rahul.id); await companions.attachToTrip(b.id, rahul.id); await companions.attachToTrip(a.id, aman.id); await companions.attachToTrip(draft.id, aman.id);
  const college = await chapters.create({ title: 'College Years' }); const bikes = await chapters.create({ title: 'Bike Trips' });
  await chapters.attachTrip(a.id, college.id); await chapters.attachTrip(b.id, college.id); await chapters.attachTrip(a.id, bikes.id); await chapters.attachTrip(draft.id, bikes.id);
  const overview = await life.overview();
  assert.deepEqual(overview.companions.map(value => [value.displayName, value.tripCount]), [['Rahul', 2], ['Aman', 1]]);
  assert.deepEqual(overview.chapters.map(value => [value.title, value.tripCount]), [['College Years', 2], ['Bike Trips', 1]]);
  assert.equal(overview.metrics.companions, 2); assert.equal(overview.metrics.chapters, 2);
});

test('history groups exact and approximate dates by supplied year and leaves unknown dates separate', async t => {
  const f = await fixture(t); const { trips, life } = repositories(f);
  await savedTrip(trips, 'Exact day', { start: { precision: 'day', value: '2025-02-03' }, end: null, certainty: 'exact', source: 'user' });
  await savedTrip(trips, 'Approximate year', approximateYear(2024));
  await savedTrip(trips, 'Unknown journey', unknownDate());
  const history = (await life.overview()).history;
  assert.deepEqual(history.map(group => group.title), ['2025', '2024', 'Date unknown']);
  assert.equal(history[0].trips[0].dateLabel, '2025-02-03');
  assert.equal(history[1].trips[0].dateLabel, '~2024');
  assert.equal(history[2].trips[0].dateLabel, 'Date unknown');
});

test('draft Trips and reconstruction suggestions never enter Travel Life until canonical saved data exists', async t => {
  const f = await fixture(t); const { trips, routes, life } = repositories(f);
  const draft = await trips.createTripDraft({ title: 'Reconstruction draft' });
  await placeStop(routes, draft.id, 'Suggested place'); await addMedia(f.connection, f.vault.id, draft.id, 3);
  await f.connection.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,kind,payload_json,evidence_json,algorithm_version,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, randomUUID(), f.vault.id, draft.id, 'run', '{"suggestedStops":99}', '{}', 1, 'pending', stamp, stamp);
  let overview = await life.overview();
  assert.deepEqual([overview.metrics.trips, overview.metrics.places, overview.metrics.visits, overview.metrics.photos], [0, 0, 0, 0]);
  await trips.updateBasicTripFields(draft.id, { status: 'saved' });
  overview = await life.overview();
  assert.deepEqual([overview.metrics.trips, overview.metrics.places, overview.metrics.visits, overview.metrics.photos], [1, 1, 1, 1]);
});

test('vault isolation and deterministic reads hold across all summaries', async t => {
  const f = await fixture(t); const primary = repositories(f);
  await savedTrip(primary.trips, 'Primary');
  const otherVault = randomUUID();
  await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', otherVault, 'Other', stamp, stamp);
  const other = repositories(f, otherVault); const otherTrip = await savedTrip(other.trips, 'Other trip');
  await placeStop(other.routes, otherTrip.id, 'Other place');
  const first = await primary.life.overview(); const second = await primary.life.overview();
  assert.deepEqual(first, second); assert.equal(first.metrics.trips, 1); assert.equal(first.metrics.places, 0);
  assert.equal((await other.life.overview()).metrics.places, 1);
});
