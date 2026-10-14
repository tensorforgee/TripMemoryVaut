import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../step1/sqlite-harness.mjs';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { buildTripMap } from '../../.expo/step1-tests/features/map/model.js';
import { tripMapSummary, tripMarkerFeatures, selectedStopDetails, tripMapCamera, basemapPresentation,
  resolveMapStyleUrl, mapPalette } from '../../.expo/step1-tests/features/map/trip-map-v2.js';
import { tripMapPhotoCounts } from '../../.expo/step1-tests/features/map/trip-map-query.js';
import { unknownDates } from '../../.expo/step1-tests/domain/date-spec.js';

const trip = { id: 'trip', title: 'Mountain journal', dates: unknownDates(), durationEstimateDays: null };
const photos = { total: 43, byStop: { b: 3 } };
const stop = (id, position, latitude = 30, longitude = 75, extra = {}) => ({ id, position, tripId: 'trip', vaultId: 'vault',
  placeId: 'place', deletedAt: null, visitConfirmed: true, kind: 'visit', dates: null, note: null, dayId: null,
  lodgingLabel: null, checkoutDates: null,
  place: { id: 'place', vaultId: 'vault', deletedAt: null, name: 'Place', latitude, longitude }, ...extra });
const exact = (start, end) => ({ start: { precision: 'day', value: start }, end: { precision: 'day', value: end }, certainty: 'exact', source: 'user' });

test('V2 header uses title, inclusive exact days, canonical route and placement counts', () => {
  const model = buildTripMap('trip', [stop('a', 0), stop('b', 1, null, null), stop('c', 2)]);
  const summary = tripMapSummary({ ...trip, dates: exact('2026-06-12', '2026-06-16') }, model, photos);
  assert.equal(summary.title, trip.title);
  assert.equal(summary.duration, '5 days');
  assert.equal(summary.route, 'Place → Place → Place');
  assert.equal(summary.mappedCount, 2); // Stop occurrences, not distinct Places.
  assert.equal(summary.photoCount, 43);
  assert.deepEqual(summary.chips, ['5 days', '2 mapped stops', '43 photos']);
});

test('V2 missing or incomplete duration stays absent; explicit estimate stays approximate', () => {
  const model = buildTripMap('trip', []);
  for (const dates of [unknownDates(), { ...exact('2026-06-12', '2026-06-16'), end: null },
    { ...exact('2026-06-12', '2026-06-16'), certainty: 'approximate' },
    { start: { precision: 'year', value: '2001' }, end: null, certainty: 'exact', source: 'user' }]) {
    assert.equal(tripMapSummary({ ...trip, dates }, model, photos).duration, null);
  }
  assert.equal(tripMapSummary({ ...trip, durationEstimateDays: 5 }, model, photos).duration, 'About 5 days');
  assert.equal(tripMapSummary({ ...trip, dates: exact('2024-02-28', '2024-03-01') }, model, photos).duration, '3 days');
});

test('V2 never manufactures distance from sequence geometry', () => {
  const summary = tripMapSummary(trip, buildTripMap('trip', [stop('a', 0), stop('b', 1, -50, -100)]), photos);
  assert.equal(summary.distance, null);
  assert.ok(!summary.chips.some(chip => /km|mile/.test(chip)));
});

test('V2 numbered markers retain order, start/destination hierarchy and actual stay kind', () => {
  const model = buildTripMap('trip', [stop('c', 2, 33, 78), stop('b', 1, 31, 76, { kind: 'stay' }), stop('a', 0)]);
  const features = tripMarkerFeatures(model).features;
  assert.deepEqual(features.map(f => [f.properties.stopId, f.properties.order, f.properties.role, f.properties.stay]),
    [['a', 1, 'Start', false], ['b', 2, 'Stop', true], ['c', 3, 'Destination', false]]);
  assert.equal(features[0].properties.color, mapPalette.start);
  assert.equal(features[2].properties.color, mapPalette.destination);
});

test('V2 selecting either repeated Place visit retains identity and unmodified geometry', () => {
  const model = buildTripMap('trip', [stop('a', 0), stop('b', 1, 31, 76), stop('c', 2, 30, 75, { kind: 'stay' })]);
  const before = tripMarkerFeatures(model).features[0];
  assert.deepEqual(before.properties.stopIds, ['a', 'c']);
  assert.equal(before.properties.digits, '1+');
  assert.equal(before.properties.destination, true); // End visit remains visible in a shared badge.
  const chosen = tripMarkerFeatures(model, 'c').features[0];
  assert.equal(chosen.properties.stopId, 'c');
  assert.equal(chosen.properties.digits, '3+');
  assert.equal(chosen.properties.stay, true);
  assert.equal(chosen.properties.selected, true);
  assert.equal(chosen.properties.color, mapPalette.selected);
  assert.ok(chosen.properties.radius > before.properties.radius);
  assert.deepEqual(chosen.geometry.coordinates, [75, 30]);
  assert.equal(tripMarkerFeatures(model, 'a').features[0].properties.stopId, 'a');
});

test('V2 selected stay details use existing section, DateSpecs, private note and lodging only', () => {
  const dates = { start: { precision: 'year', value: '2001' }, end: null, certainty: 'approximate', source: 'user' };
  const model = buildTripMap('trip', [stop('b', 0, 30, 75, { kind: 'stay', dayId: 'day', dates,
    note: 'Private memory', lodgingLabel: 'Remembered guesthouse', checkoutDates: dates })]);
  const details = selectedStopDetails(model.route[0], [{ id: 'day', tripId: 'trip', deletedAt: null, label: 'Mountain section' }], photos);
  assert.equal(details.section, 'Mountain section');
  assert.equal(details.lodging, 'Remembered guesthouse');
  assert.match(details.dates, /Approximate.*2001/);
  assert.equal(details.checkout, details.dates);
  assert.equal(details.note, 'Private memory');
  assert.equal(details.photoCount, 3);
  assert.equal(selectedStopDetails(model.route[0], [], photos).section, null);
});

test('V2 unassigned photos do not become stop photos; no Place-level count sharing', () => {
  const model = buildTripMap('trip', [stop('a', 0), stop('b', 1)]);
  assert.equal(selectedStopDetails(model.route[0], [], photos).photoCount, 0);
  assert.equal(selectedStopDetails(model.route[1], [], photos).photoCount, 3);
  assert.equal(selectedStopDetails(model.route[0], [], photos).dates, null);
  assert.equal(tripMapSummary(trip, model, photos).photoCount, 43);
});

test('V2 camera input and sequence preserve unknown/unconfirmed gaps and canonical-only input', () => {
  const model = buildTripMap('trip', [stop('a', 0), stop('b', 1, null, null), stop('c', 2, 32, 77),
    stop('d', 3, 33, 78, { visitConfirmed: false }), stop('e', 4, 34, 79),
    stop('other', 0, 70, -100, { tripId: 'other' }), stop('trash', 7, 80, -120, { deletedAt: 'deleted' })]);
  assert.deepEqual(tripMarkerFeatures(model).features.flatMap(f => f.properties.stopIds), ['a', 'c', 'e']);
  assert.deepEqual(model.lines.features, []);
  const camera = tripMapCamera(model, 400, 500);
  assert.ok(camera.center[0] >= 75 && camera.center[0] <= 79);
  assert.ok(camera.zoom > 4 && camera.zoom < 11);
});

test('V2 zero-stop and one-stop models remain useful with sensible cameras', () => {
  const empty = buildTripMap('trip', []);
  assert.equal(tripMapCamera(empty, 400, 500), null);
  assert.equal(tripMarkerFeatures(empty).features.length, 0);
  assert.equal(tripMapSummary(trip, empty, { total: 0, byStop: {} }).mappedCount, 0);
  const single = buildTripMap('trip', [stop('a', 0)]);
  assert.equal(tripMapCamera(single, 400, 500).zoom, 11);
  assert.equal(tripMarkerFeatures(single).features[0].properties.role, 'Only stop');
  assert.deepEqual(tripMapSummary(trip, single, { total: 1, byStop: {} }).chips, ['1 mapped stop', '1 photo']);
});

test('V2 camera still fits identical, wide and antimeridian points in the visible viewport', () => {
  const identical = buildTripMap('trip', [stop('a', 0), stop('b', 1)]);
  assert.equal(tripMapCamera(identical, 400, 300).zoom, 11);
  const dateline = buildTripMap('trip', [stop('a', 0, 10, 179), stop('b', 1, 10, -179)]);
  assert.equal(tripMapCamera(dateline, 400, 300).center[0], -180);
  assert.equal(dateline.lines.features.length, 0);
  const wide = buildTripMap('trip', [stop('a', 0, 60, -120), stop('b', 1, -60, 75)]);
  assert.ok(tripMapCamera(wide, 400, 300).zoom < 2);
  assert.ok(tripMapCamera(wide, 400, 600).zoom >= tripMapCamera(wide, 400, 300).zoom);
});

test('V2 fallback model distinguishes loading, detailed, unavailable and unconfigured states', () => {
  for (const state of ['offline', 'unconfigured']) {
    const result = basemapPresentation(state);
    assert.equal(result.useOfflineStyle, true);
    assert.match(result.label, /Offline overview/);
    assert.match(result.detail, /No detailed offline roads/);
  }
  assert.match(basemapPresentation('loading').label, /Loading/);
  assert.match(basemapPresentation('online').label, /cached/);
  assert.equal(basemapPresentation('offline').canRetry, true);
  assert.equal(basemapPresentation('unavailable').canRetry, true);
});

test('V2 production style is explicit HTTPS configuration; blank opts out and no key is embedded', () => {
  assert.equal(resolveMapStyleUrl(undefined), null);
  assert.equal(resolveMapStyleUrl(''), null);
  for (const value of ['http://provider/style', 'file:///style', 'bad url', 'https://user:password@provider/style', 'https://[bad]/']) {
    assert.equal(resolveMapStyleUrl(value), null);
  }
  assert.equal(resolveMapStyleUrl('https://provider.example/style.json'), 'https://provider.example/style.json');
});

test('V2 real SQLite photo counts respect placements, ownership, deletion, unassigned and shared media', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'V2 fixture' });
  const other = await f.trips.createTripDraft({ title: 'Other trip' });
  const routes = new RouteRepository(f.database, f.vault.id, randomUUID);
  const place = await routes.createPlace({ name: 'Repeated' });
  const a = await routes.addStop(trip.id, { placeId: place.id });
  const b = await routes.addStop(trip.id, { placeId: place.id });
  const stamp = '2026-10-04T00:00:00Z';
  const placements = [];
  for (const stopId of [a.id, b.id, null]) {
    const mediaId = randomUUID(), id = randomUUID(); placements.push(id);
    await f.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,source_metadata_json,source_fidelity,parser_version,created_at,updated_at)
      VALUES(?,?,?,1,'image/jpeg','jpg','{}','unknown',1,?,?)`, mediaId, f.vault.id, mediaId.replaceAll('-', '').repeat(2), stamp, stamp);
    await f.connection.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,stop_id,position,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`, id, f.vault.id, trip.id, mediaId, stopId, placements.length - 1, stamp, stamp);
    await f.connection.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,position,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`, randomUUID(), f.vault.id, other.id, mediaId, placements.length - 1, stamp, stamp);
  }
  // An unfinished selected import does not count as a photo.
  const batch = randomUUID();
  await f.connection.runAsync(`INSERT INTO import_batches(id,vault_id,trip_id,state,created_at,updated_at,options_json)
    VALUES(?,?,?,'pending',?,?,'{}')`, batch, f.vault.id, trip.id, stamp, stamp);
  assert.deepEqual(await tripMapPhotoCounts(f.database, f.vault.id, trip.id), { total: 3, byStop: { [a.id]: 1, [b.id]: 1 } });
  await f.connection.runAsync('UPDATE trip_media SET deleted_at=? WHERE id=?', stamp, placements[0]);
  assert.deepEqual(await tripMapPhotoCounts(f.database, f.vault.id, trip.id), { total: 2, byStop: { [b.id]: 1 } });
  assert.equal((await tripMapPhotoCounts(f.database, randomUUID(), trip.id)).total, 0);
  await f.trips.trashTrip(trip.id);
  assert.equal((await tripMapPhotoCounts(f.database, f.vault.id, trip.id)).total, 0);
  assert.equal((await tripMapPhotoCounts(f.database, f.vault.id, other.id)).total, 3);
});
