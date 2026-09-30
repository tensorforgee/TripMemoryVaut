import { File, Paths } from 'expo-file-system';
import { openVaultDatabase } from '../../src/core/database/open';

type FixtureIds = { firstTrip: string; secondTrip: string; sharedPlace: string; unknownPlace: string; dreamPlace: string };
const fixtureFile = () => new File(Paths.document, 'step11-runtime.json');
const archiveStateFile = () => new File(Paths.document, 'step11-archive-state.json');
const day = (value: string) => ({ start: { precision: 'day' as const, value }, end: null,
  certainty: 'exact' as const, source: 'user' as const });

export async function prepareGlobalMapFixtures(): Promise<FixtureIds> {
  const store = await openVaultDatabase();
  if (fixtureFile().exists) return JSON.parse(await fixtureFile().text()) as FixtureIds;
  const first = await store.trips.createTripDraft({ title: 'Step 11 Kinnaur', dates: day('2024-09-14') });
  await store.trips.updateBasicTripFields(first.id, { status: 'saved' });
  const second = await store.trips.createTripDraft({ title: 'Step 11 Kinnaur return', dates: {
    start: { precision: 'year', value: '2026' }, end: null, certainty: 'approximate', source: 'user',
  } });
  await store.trips.updateBasicTripFields(second.id, { status: 'saved' });
  const section = await store.timeline.createTripDay(first.id, { label: 'Synthetic mountain section' });
  const shared = await store.routes.createPlace({ name: 'Step 11 shared Place', latitude: 31.5, longitude: 78.2, coordinatePrecision: 'area' });
  const unknown = await store.routes.createPlace({ name: 'Step 11 unknown Place' });
  const firstVisit = await store.routes.addStop(first.id, { placeId: shared.id, dates: day('2024-09-14') });
  await store.timeline.assignStop(first.id, firstVisit.id, section.id);
  await store.routes.addStop(first.id, { placeId: shared.id, kind: 'stay' });
  await store.routes.addStop(first.id, { placeId: unknown.id });
  const linkedStop = await store.routes.addStop(second.id, { placeId: shared.id });
  const dream = await store.dreams.create({ title: 'Step 11 dream-only pin', latitude: 40, longitude: 80 });
  await store.dreams.linkVisit(dream.id, linkedStop.id);
  const ids = { firstTrip: first.id, secondTrip: second.id, sharedPlace: shared.id, unknownPlace: unknown.id, dreamPlace: dream.placeId };
  fixtureFile().write(JSON.stringify(ids));
  return ids;
}

export async function auditGlobalMapFixtures(): Promise<string> {
  const ids = JSON.parse(await fixtureFile().text()) as FixtureIds;
  const archive = await (await openVaultDatabase()).map.archive();
  const shared = archive.places.find(place => place.id === ids.sharedPlace);
  const unknown = archive.places.find(place => place.id === ids.unknownPlace);
  if (!shared || shared.visitCount !== 3 || shared.tripCount !== 2 || shared.visits.length !== 3 || !shared.coordinate) throw new Error('Shared Place aggregation audit failed');
  if (!unknown || unknown.coordinate !== null || unknown.visitCount !== 1) throw new Error('Unmapped Place audit failed');
  if (archive.places.some(place => place.id === ids.dreamPlace)) throw new Error('Dream Place leaked into My Map');
  return 'PASS: one shared canonical marker has 3 separate visits across 2 Trips; the unknown Place remains listed; the visited Dream adds no marker or visit.';
}

export async function stageZeroMappedPlaces(): Promise<string> {
  if (archiveStateFile().exists) await restoreRuntimeArchive();
  const store = await openVaultDatabase();
  const saved = await store.trips.listTrips({ status: 'saved', limit: 100 });
  archiveStateFile().write(JSON.stringify(saved.map(trip => trip.id)));
  for (const trip of saved) await store.trips.trashTrip(trip.id);
  const archive = await store.map.archive();
  if (archive.totalPlaceCount !== 0 || archive.mappedPlaceCount !== 0) throw new Error('Zero-map staging failed');
  return 'Zero mapped Places staged. Open My Map, then return here before restoring.';
}

export async function stageOneMappedPlace(): Promise<string> {
  if (!archiveStateFile().exists) throw new Error('Stage zero first');
  const ids = JSON.parse(await fixtureFile().text()) as FixtureIds;
  const store = await openVaultDatabase();
  if (!await store.trips.getTripById(ids.secondTrip)) await store.trips.restoreTrip(ids.secondTrip);
  const archive = await store.map.archive();
  if (archive.mappedPlaceCount !== 1 || archive.unmappedPlaceCount !== 0) throw new Error('One-map staging failed');
  return 'One mapped Place staged. Open My Map, then return here and restore the archive.';
}

export async function restoreRuntimeArchive(): Promise<string> {
  if (!archiveStateFile().exists) return 'No staged archive state to restore.';
  const ids = JSON.parse(await archiveStateFile().text()) as string[];
  const store = await openVaultDatabase();
  for (const id of ids) if (!await store.trips.getTripById(id)) await store.trips.restoreTrip(id);
  archiveStateFile().delete();
  return 'All Trips active before zero-map staging have been restored.';
}
