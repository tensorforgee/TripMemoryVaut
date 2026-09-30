import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from '../step1/sqlite-harness.mjs';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { TimelineRepository } from '../../.expo/step1-tests/features/timeline/repository.js';
import { DreamRepository } from '../../.expo/step1-tests/features/dreams/repository.js';
import { TravelLifeRepository } from '../../.expo/step1-tests/features/life/repository.js';
import { GlobalMapRepository, visitDateLabel } from '../../.expo/step1-tests/features/map/repository.js';
import { fitTripCamera } from '../../.expo/step1-tests/features/map/model.js';

const stamp = '2026-09-30T12:00:00.000Z';
const exactDay = value => ({ start: { precision: 'day', value }, end: null, certainty: 'exact', source: 'user' });
const exactMonth = value => ({ start: { precision: 'month', value }, end: null, certainty: 'exact', source: 'user' });
const exactYear = value => ({ start: { precision: 'year', value: String(value) }, end: null, certainty: 'exact', source: 'user' });
const approximateYear = value => ({ start: { precision: 'year', value: String(value) }, end: null, certainty: 'approximate', source: 'user' });
const unknown = () => ({ start: { precision: 'unknown' }, end: null, certainty: 'unknown', source: 'user' });

function repositories(f, vaultId = f.vault.id) {
  return {
    trips: vaultId === f.vault.id ? f.trips : new TripRepository(f.database, vaultId, randomUUID, () => stamp),
    routes: new RouteRepository(f.database, vaultId, randomUUID, () => stamp),
    timeline: new TimelineRepository(f.database, vaultId, randomUUID, () => stamp),
    dreams: new DreamRepository(f.database, vaultId, randomUUID, () => stamp),
    life: new TravelLifeRepository(f.database, vaultId),
    map: new GlobalMapRepository(f.database, vaultId),
  };
}

async function savedTrip(repos, title, dates = exactYear(2026)) {
  const trip = await repos.trips.createTripDraft({ title, dates });
  return repos.trips.updateBasicTripFields(trip.id, { status: 'saved' });
}

test('canonical Place aggregation preserves repeated Stops, distinct Trips and distinct same-name Place IDs', async t => {
  const f = await fixture(t); const r = repositories(f);
  const a = await savedTrip(r, 'First Shimla', exactDay('2026-09-14'));
  const b = await savedTrip(r, 'Return to Shimla', exactMonth('2027-09'));
  const shimla = await r.routes.createPlace({ name: 'Shimla', latitude: 31.1048, longitude: 77.1734, coordinatePrecision: 'point' });
  const otherShimla = await r.routes.createPlace({ name: 'Shimla', latitude: 31.2, longitude: 77.2, coordinatePrecision: 'point' });
  await r.routes.addStop(a.id, { placeId: shimla.id });
  await r.routes.addStop(a.id, { placeId: shimla.id, kind: 'stay' });
  await r.routes.addStop(b.id, { placeId: shimla.id, dates: approximateYear(2028) });
  await r.routes.addStop(b.id, { placeId: otherShimla.id });

  const archive = await r.map.archive();
  assert.equal(archive.totalPlaceCount, 2);
  const place = archive.places.find(value => value.id === shimla.id);
  assert.deepEqual([place.visitCount, place.tripCount], [3, 2]);
  assert.equal(new Set(place.visits.map(visit => visit.stopId)).size, 3);
  assert.deepEqual(place.trips.map(trip => trip.title), ['First Shimla', 'Return to Shimla']);
  assert.equal(place.firstKnownVisit, '14 Sep 2026');
  assert.equal(place.mostRecentKnownVisit, '~2028');
  assert.equal(archive.places.filter(value => value.name === 'Shimla').length, 2);
});

test('mapped and unmapped counts align with all qualifying Places and expose section/date history honestly', async t => {
  const f = await fixture(t); const r = repositories(f);
  const trip = await savedTrip(r, 'Mixed geography', unknown());
  const section = await r.timeline.createTripDay(trip.id, { label: 'Early in the trip' });
  const mapped = await r.routes.createPlace({ name: 'Mapped', latitude: 30, longitude: 75, coordinatePrecision: 'area' });
  const unmapped = await r.routes.createPlace({ name: 'Unknown location' });
  const visit = await r.routes.addStop(trip.id, { placeId: mapped.id, dates: exactMonth('2025-02') });
  await r.timeline.assignStop(trip.id, visit.id, section.id);
  await r.routes.addStop(trip.id, { placeId: unmapped.id });
  const archive = await r.map.archive();
  assert.deepEqual([archive.totalPlaceCount, archive.mappedPlaceCount, archive.unmappedPlaceCount], [2, 1, 1]);
  assert.equal((await r.life.overview()).metrics.places, archive.totalPlaceCount);
  assert.deepEqual(archive.mappedPlaces[0].coordinate, [75, 30]);
  assert.equal(archive.unmappedPlaces[0].name, 'Unknown location');
  assert.equal(archive.mappedPlaces[0].visits[0].dateLabel, 'Feb 2025');
  assert.equal(archive.mappedPlaces[0].visits[0].timelineSectionLabel, 'Early in the trip');
  assert.equal(archive.unmappedPlaces[0].firstKnownVisit, null);
  assert.equal(archive.unmappedPlaces[0].visits[0].dateLabel, 'Date unknown');
});

test('Trash, restore and Stop removal update contribution without deleting reusable Places', async t => {
  const f = await fixture(t); const r = repositories(f);
  const a = await savedTrip(r, 'A'); const b = await savedTrip(r, 'B');
  const place = await r.routes.createPlace({ name: 'Shared', latitude: 20, longitude: 70, coordinatePrecision: 'point' });
  const stopA = await r.routes.addStop(a.id, { placeId: place.id });
  await r.routes.addStop(b.id, { placeId: place.id });
  assert.deepEqual([(await r.map.archive()).places[0].visitCount, (await r.map.archive()).places[0].tripCount], [2, 2]);
  await r.trips.trashTrip(a.id);
  assert.deepEqual([(await r.map.archive()).places[0].visitCount, (await r.map.archive()).places[0].tripCount], [1, 1]);
  await r.trips.trashTrip(b.id); assert.equal((await r.map.archive()).totalPlaceCount, 0);
  await r.trips.restoreTrip(a.id); assert.deepEqual([(await r.map.archive()).places[0].visitCount, (await r.map.archive()).places[0].tripCount], [1, 1]);
  await r.routes.removeStop(a.id, stopA.id); assert.equal((await r.map.archive()).totalPlaceCount, 0);
  assert.equal((await r.routes.getPlace(place.id)).name, 'Shared');
  await r.routes.restoreStop(a.id, stopA.id); assert.equal((await r.map.archive()).totalPlaceCount, 1);
});

test('drafts, unconfirmed/transit Stops and pending or rejected reconstruction never enter My Map', async t => {
  const f = await fixture(t); const r = repositories(f);
  const saved = await savedTrip(r, 'Saved'); const draft = await r.trips.createTripDraft({ title: 'Draft' });
  await r.routes.createPlaceAndAddStop(saved.id, { name: 'Transit', latitude: 1, longitude: 1, coordinatePrecision: 'point' }, { kind: 'transit' });
  await r.routes.createPlaceAndAddStop(saved.id, { name: 'Unconfirmed', latitude: 2, longitude: 2, coordinatePrecision: 'point' }, { visitConfirmed: false });
  await r.routes.createPlaceAndAddStop(draft.id, { name: 'Draft canonical stop', latitude: 3, longitude: 3, coordinatePrecision: 'point' });
  for (const state of ['pending', 'rejected']) await f.connection.runAsync(`INSERT INTO draft_suggestions
    (id,vault_id,trip_id,kind,payload_json,evidence_json,algorithm_version,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, randomUUID(), f.vault.id, saved.id, 'run', '{"latitude":40,"longitude":80}', '{}', 1, state, stamp, stamp);
  assert.equal((await r.map.archive()).totalPlaceCount, 0);
});

test('Dream coordinates are excluded and a visited Dream adds no duplicate marker or visit', async t => {
  const f = await fixture(t); const r = repositories(f);
  const dream = await r.dreams.create({ title: 'Dream pin', latitude: 40, longitude: 80 });
  assert.equal((await r.map.archive()).totalPlaceCount, 0);
  const trip = await savedTrip(r, 'Fulfilled');
  const stop = await r.routes.createPlaceAndAddStop(trip.id, { name: 'Visited pin', latitude: 30, longitude: 70, coordinatePrecision: 'point' });
  const baseline = await r.map.archive();
  await r.dreams.linkVisit(dream.id, stop.id);
  const linked = await r.map.archive();
  assert.deepEqual([linked.totalPlaceCount, linked.places[0].visitCount, linked.places[0].tripCount], [1, 1, 1]);
  assert.deepEqual(linked, baseline);
  await r.dreams.archive(dream.id); assert.deepEqual(await r.map.archive(), baseline);
});

test('date uncertainty formatting retains exact precision, approximation and unknown state', () => {
  assert.equal(visitDateLabel(exactDay('2026-09-14')), '14 Sep 2026');
  assert.equal(visitDateLabel(exactMonth('2026-09')), 'Sep 2026');
  assert.equal(visitDateLabel(exactYear(2026)), '2026');
  assert.equal(visitDateLabel(approximateYear(2026)), '~2026');
  assert.equal(visitDateLabel(unknown()), 'Date unknown');
});

test('vault isolation and deterministic ordering hold for Places, Trips and visit history', async t => {
  const f = await fixture(t); const primary = repositories(f);
  const trip = await savedTrip(primary, 'Z trip', exactYear(2024));
  await primary.routes.createPlaceAndAddStop(trip.id, { name: 'B place', latitude: 1, longitude: 2, coordinatePrecision: 'point' });
  await primary.routes.createPlaceAndAddStop(trip.id, { name: 'A place', latitude: 3, longitude: 4, coordinatePrecision: 'point' });
  const otherVault = randomUUID();
  await f.connection.runAsync('INSERT INTO vaults(id,name,created_at,updated_at) VALUES(?,?,?,?)', otherVault, 'Other', stamp, stamp);
  const other = repositories(f, otherVault); const otherTrip = await savedTrip(other, 'Other');
  await other.routes.createPlaceAndAddStop(otherTrip.id, { name: 'Private place', latitude: 5, longitude: 6, coordinatePrecision: 'point' });
  const first = await primary.map.archive(); const second = await primary.map.archive();
  assert.deepEqual(first, second); assert.deepEqual(first.places.map(place => place.name), ['A place', 'B place']);
  assert.deepEqual((await other.map.archive()).places.map(place => place.name), ['Private place']);
});

test('global camera inputs handle no coordinates, one/identical/wide points and the antimeridian', () => {
  assert.equal(fitTripCamera([]), null);
  const one = fitTripCamera([[75, 30]]); assert.equal(one.zoom, 11);
  assert.deepEqual(fitTripCamera([[75, 30], [75, 30]]), one);
  const wide = fitTripCamera([[-120, -60], [75, 60]]); assert.ok(wide.zoom >= 0 && wide.zoom <= 11);
  assert.ok(wide.center.every(Number.isFinite));
  const dateline = fitTripCamera([[179, 10], [-179, 10]]);
  assert.equal(dateline.center[0], -180); assert.ok(dateline.zoom > 5);
});
