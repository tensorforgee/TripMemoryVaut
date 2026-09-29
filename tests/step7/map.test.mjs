import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture } from '../step1/sqlite-harness.mjs';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { ReconstructionRepository } from '../../.expo/step1-tests/features/reconstruction/repository.js';
import { buildTripMap, fitTripCamera } from '../../.expo/step1-tests/features/map/model.js';

const stop = (id, position, latitude = 30, longitude = 75, extra = {}) => ({ id, position, tripId: 'trip', vaultId: 'vault',
  placeId: 'place', deletedAt: null, visitConfirmed: true, kind: 'visit',
  place: { id: 'place', vaultId: 'vault', deletedAt: null, name: 'Place', latitude, longitude }, ...extra });
test('mapped extraction preserves canonical order, identity and repeated Place visits', () => {
  const input = [stop('c', 2), stop('a', 0), stop('b', 1, 31, 76)];
  const model = buildTripMap('trip', input);
  assert.deepEqual(model.mapped.map(s => [s.stop.id, s.order]), [['a', 1], ['b', 2], ['c', 3]]);
  assert.deepEqual(model.mapped[0].coordinate, [75, 30]);
  assert.deepEqual(input.map(s => s.id), ['c', 'a', 'b']);
  assert.equal(model.lines.features.length, 2);
  assert.deepEqual(model, buildTripMap('trip', input));
});
test('unknown and partial coordinates never plot and break both adjacent segments', () => {
  for (const [lat, lon] of [[null, null], [30, null], [null, 75], [undefined, 75], [NaN, 75], [91, 75], [30, 181], [0, 0]]) {
    const missing = stop('b', 1); missing.place.latitude = lat; missing.place.longitude = lon;
    const model = buildTripMap('trip', [stop('a', 0), missing, stop('c', 2, 32, 78)]);
    assert.equal(model.route.length, 3); assert.equal(model.mapped.length, 2);
    assert.equal(model.unknownCount, 1); assert.deepEqual(model.lines.features, []);
  }
});
test('valid single-axis zero coordinates remain valid', () => {
  assert.deepEqual(buildTripMap('trip', [stop('a', 0, 0, 75)]).mapped[0].coordinate, [75, 0]);
});
test('unconfirmed visit never plots or bridges a line', () => {
  const m = buildTripMap('trip', [stop('a', 0), stop('b', 1, 31, 76, { visitConfirmed: false }), stop('c', 2, 32, 78)]);
  assert.equal(m.unconfirmedCount, 1); assert.equal(m.route.length, 3); assert.equal(m.lines.features.length, 0);
});
test('trip isolation, deleted Stops and deleted Places excluded defensively', () => {
  const a = stop('a', 0);
  assert.equal(buildTripMap('trip', [a, stop('b', 1, 30, 75, { tripId: 'other' }),
    { ...a, id: 'c', deletedAt: 'deleted' }, { ...a, id: 'd', place: { ...a.place, deletedAt: 'deleted' } }]).route.length, 1);
});
test('identical coordinates retain independent occurrences without zero-length line', () => {
  const m = buildTripMap('trip', [stop('a', 0), stop('b', 1), stop('c', 2, 31, 76)]);
  assert.equal(m.mapped.length, 3); assert.equal(m.lines.features.length, 1);
  assert.equal(m.lines.features[0].properties.fromStopId, 'b');
});
test('deterministic line pairs remain broken around multiple unknown stops', () => {
  const m = buildTripMap('trip', [stop('a', 0), stop('b', 1, 31, 76), stop('c', 2, null, null),
    stop('d', 3, 32, 77), stop('e', 4, 33, 78)]);
  assert.deepEqual(m.lines.features.map(s => s.id), ['a:b', 'd:e']);
});
test('camera handles none, single, identical, nearby and widely separated pairs', () => {
  assert.equal(fitTripCamera([]), null);
  const single = fitTripCamera([[75, 30]]);
  assert.ok(Math.abs(single.center[0] - 75) < 1e-9 && Math.abs(single.center[1] - 30) < 1e-9);
  assert.equal(single.zoom, 11);
  assert.deepEqual(fitTripCamera([[75, 30], [75, 30]]), single);
  for (const points of [[[75, 30], [76, 31]], [[-120, -60], [75, 60]], [[75, 90], [76, -90]]]) {
    const c = fitTripCamera(points); assert.ok(c.zoom >= 0 && c.zoom <= 11);
    assert.ok(c.center.every(Number.isFinite));
  }
  assert.ok(fitTripCamera([[75, 30], [76, 31]]).zoom > fitTripCamera([[-120, -60], [75, 60]]).zoom);
});
test('antimeridian uses short camera bounds and no world-spanning false line', () => {
  const m = buildTripMap('trip', [stop('a', 0, 10, 179), stop('b', 1, 10, -179)]);
  assert.equal(m.datelineGaps, 1); assert.equal(m.lines.features.length, 0);
  const c = fitTripCamera(m.mapped.map(s => s.coordinate)); assert.equal(c.center[0], -180); assert.ok(c.zoom > 5);
});
test('bundled background is local valid polygon data without remote resources', () => {
  const land = JSON.parse(readFileSync('assets/maps/land.json', 'utf8'));
  assert.equal(land.type, 'FeatureCollection'); assert.ok(land.features.length > 0);
  assert.ok(land.features.every(f => f.geometry.type === 'Polygon'));
  assert.doesNotMatch(readFileSync('src/core/maps/offline-style.ts', 'utf8'), /https?:/);
});

async function setup(t) {
  const f = await fixture(t); const trip = await f.trips.createTripDraft({ title: 'Map fixture' });
  const routes = new RouteRepository(f.database, f.vault.id, randomUUID);
  const read = async () => buildTripMap(trip.id, (await routes.getRoute(trip.id)).stops);
  return { ...f, trip, routes, read };
}
test('real SQLite scope and deletion integrity apply to map reads', async t => {
  const f = await setup(t);
  const p = await f.routes.createPlace({ name: 'Known', latitude: 30, longitude: 75, coordinatePrecision: 'point' });
  const s = await f.routes.addStop(f.trip.id, { placeId: p.id });
  const other = await f.trips.createTripDraft({ title: 'Other' });
  await f.routes.addStop(other.id, { placeId: p.id });
  assert.equal((await f.read()).mapped.length, 1);
  await assert.rejects(f.connection.runAsync('UPDATE places SET deleted_at=? WHERE id=?', '2026-09-30T00:00:00Z', p.id));
  await f.routes.removeStop(f.trip.id, s.id); assert.equal((await f.read()).route.length, 0);
  await f.trips.trashTrip(f.trip.id); await assert.rejects(f.read());
});
test('accepted reconstruction appears through canonical Stops only; pending/rejected never appear', async t => {
  const f = await setup(t); const reconstruction = new ReconstructionRepository(f.database, f.vault.id, randomUUID);
  for (let i = 0; i < 3; i++) {
    const id = randomUUID(); const stamp = '2001-01-01T00:00:00Z';
    const metadata = { exif: {}, capture: null, gps: { latitude: 30 + i, longitude: 75 + i }, warnings: [] };
    await f.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,source_metadata_json,source_fidelity,parser_version,created_at,updated_at) VALUES(?,?,?,1,'image/jpeg','jpg',?,'unknown',1,?,?)`, id, f.vault.id, id.replaceAll('-', '').repeat(2), JSON.stringify(metadata), stamp, stamp);
    await f.connection.runAsync('INSERT INTO trip_media(id,vault_id,trip_id,media_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', randomUUID(), f.vault.id, f.trip.id, id, i, stamp, stamp);
  }
  await reconstruction.run(f.trip.id);
  const suggestions = (await reconstruction.list(f.trip.id)).filter(s => s.kind === 'location');
  assert.equal(suggestions.length, 3); assert.equal((await f.read()).route.length, 0);
  await reconstruction.reject(f.trip.id, suggestions[0].id);
  assert.equal((await f.read()).route.length, 0);
  const accepted = await reconstruction.accept(f.trip.id, suggestions[1].id, { confirmPlace: true, confirmAppend: true });
  assert.equal((await f.read()).mapped.length, 1);
  await f.routes.updatePlace(accepted.placeId, { latitude: 40, longitude: 80 });
  assert.deepEqual((await f.read()).mapped[0].coordinate, [80, 40]);
  await f.routes.updatePlace(accepted.placeId, { latitude: null, longitude: null, coordinatePrecision: 'unknown' });
  assert.equal((await f.read()).mapped.length, 0); // No fallback to accepted evidence either.
});
