import { File, Paths } from 'expo-file-system';
import { openVaultDatabase } from '../../src/core/database/open';
import { buildTripMap } from '../../src/features/map/model';

const manifest = () => new File(Paths.document, 'step7-runtime.json');
export async function prepareMapFixtures() {
  const store = await openVaultDatabase();
  if (manifest().exists) return JSON.parse(await manifest().text()) as { route: string; empty: string; single: string; identical: string; wide: string };
  const route = await store.trips.createTripDraft({ title: 'Step 7 synthetic route' });
  const day = await store.timeline.createTripDay(route.id, { label: 'Synthetic section' });
  const a = await store.routes.createPlace({ name: 'Fixture A', latitude: 30, longitude: 75, coordinatePrecision: 'point' });
  const b = await store.routes.createPlace({ name: 'Fixture B', latitude: 31, longitude: 76, coordinatePrecision: 'point' });
  const unknown = await store.routes.createPlace({ name: 'Fixture unknown' });
  const c = await store.routes.createPlace({ name: 'Fixture C', latitude: 32, longitude: 77, coordinatePrecision: 'point' });
  await store.routes.addStop(route.id, { placeId: a.id });
  const stay = await store.routes.addStop(route.id, { placeId: b.id, kind: 'stay', note: 'Synthetic stay note',
    dates: { start: { precision: 'year', value: '2001' }, end: null, certainty: 'approximate', source: 'user' } });
  await store.timeline.assignStop(route.id, stay.id, day.id);
  await store.routes.addStop(route.id, { placeId: unknown.id });
  await store.routes.addStop(route.id, { placeId: c.id, kind: 'transit' });
  await store.routes.addStop(route.id, { placeId: b.id });
  const empty = await store.trips.createTripDraft({ title: 'Step 7 no coordinates' });
  await store.routes.addStop(empty.id, { placeId: unknown.id });
  const single = await store.trips.createTripDraft({ title: 'Step 7 single point' });
  await store.routes.addStop(single.id, { placeId: a.id });
  const identical = await store.trips.createTripDraft({ title: 'Step 7 identical points' });
  await store.routes.addStop(identical.id, { placeId: a.id });
  await store.routes.addStop(identical.id, { placeId: a.id });
  const wide = await store.trips.createTripDraft({ title: 'Step 7 wide extent' });
  await store.routes.addStop(wide.id, { placeId: a.id });
  const distant = await store.routes.createPlace({ name: 'Fixture distant', latitude: -30, longitude: -100, coordinatePrecision: 'point' });
  await store.routes.addStop(wide.id, { placeId: distant.id });
  const ids = { route: route.id, empty: empty.id, single: single.id, identical: identical.id, wide: wide.id };
  manifest().write(JSON.stringify(ids)); return ids;
}
export async function auditMapFixtures() {
  const ids = JSON.parse(await manifest().text()); const store = await openVaultDatabase();
  const read = async (id: string) => buildTripMap(id, (await store.routes.getRoute(id)).stops);
  const route = await read(ids.route);
  if (route.route.length !== 5 || route.mapped.length !== 4 || route.unknownCount !== 1 || route.lines.features.length !== 2
    || route.mapped[1].stop.placeId !== route.mapped[3].stop.placeId || route.mapped[1].stop.id === route.mapped[3].stop.id) throw Error('Route audit failed');
  const pairs = route.lines.features.map(f => [f.properties.fromStopId, f.properties.toStopId]);
  if (JSON.stringify(pairs) !== JSON.stringify([[route.route[0].stop.id, route.route[1].stop.id], [route.route[3].stop.id, route.route[4].stop.id]])) throw Error('Line gap audit failed');
  if ((await read(ids.empty)).mapped.length || (await read(ids.single)).mapped.length !== 1
    || (await read(ids.identical)).mapped.length !== 2 || (await read(ids.wide)).mapped.length !== 2) throw Error('Camera fixture audit failed');
  return 'PASS: canonical route persisted; 5 Stops, 4 mapped occurrences, 1 unknown, 2 separate sequence segments. Repeated Place retains distinct Stops. Empty/single/identical/wide fixtures intact.';
}
