import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { openVaultDatabase } from '../../src/core/database/open';

type Checkpoint = { tripId: string; placeId: string; companionId: string; chapterId: string; dreamId: string; report: string };
const checkpoint = () => new File(Paths.document, 'step13-native-checkpoint.json');
const unknown = { start: { precision: 'unknown' as const }, end: null, certainty: 'unknown' as const, source: 'user' as const };
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export async function runNativeSearchVerification(): Promise<string> {
  const vault = await openVaultDatabase();
  const suffix = randomUUID().slice(0, 8);
  const draft = await vault.trips.createTripDraft({ title: 'Step 13 Chitkul Road Trip', summary: 'Shimla bike search', dates: unknown });
  await vault.trips.updateBasicTripFields(draft.id, { status: 'saved' });
  const day = await vault.timeline.createTripDay(draft.id, { label: 'Step 13 mountain morning' });
  const place = await vault.routes.createPlace({ name: 'Step 13 Sangla' });
  const stop = await vault.routes.addStop(draft.id, { placeId: place.id, kind: 'stay', note: 'Step 13 apple orchard note', lodgingLabel: 'Step 13 River Lodge' });
  await vault.timeline.assignStop(draft.id, stop.id, day.id);
  const companion = await vault.companions.create({ displayName: 'Step 13 Rahul', note: 'Step 13 college friend' });
  await vault.companions.attachToTrip(draft.id, companion.id);
  const chapter = await vault.chapters.create({ title: `Step 13 College Years ${suffix}`, description: 'Step 13 bike friends' });
  await vault.chapters.attachTrip(draft.id, chapter.id);
  const dream = await vault.dreams.create({ title: 'Step 13 Japan', note: 'Step 13 slow train someday' });
  check((await vault.search.search('chitkul'))[0]?.entityId === draft.id, 'Trip title search failed');
  check((await vault.search.search('sangla')).some(row => row.entityId === place.id), 'Place search failed');
  check((await vault.search.search('rahul')).some(row => row.entityId === companion.id), 'Companion search failed');
  check((await vault.search.search('college years')).some(row => row.entityId === chapter.id), 'Chapter search failed');
  check((await vault.search.search('slow train')).some(row => row.entityId === dream.id), 'Dream note search failed');
  check((await vault.search.search('apple orchard')).some(row => row.entityId === stop.id), 'Stop note search failed');
  check((await vault.search.search('mountain morn')).some(row => row.entityId === day.id), 'TripDay prefix search failed');
  check((await vault.search.search('SHIMLA BIKE')).some(row => row.entityId === draft.id), 'Case-insensitive multi-term search failed');
  check((await vault.search.search('" ) OR * : NEAR(')).length === 0, 'Malformed punctuation was not handled safely');
  await vault.trips.updateBasicTripFields(draft.id, { title: 'Step 13 Kinnaur Journey' });
  check(!(await vault.search.search('Chitkul')).some(row => row.entityId === draft.id)
    && (await vault.search.search('Kinnaur')).some(row => row.entityId === draft.id), 'Rename synchronization failed');
  await vault.trips.trashTrip(draft.id); check(!(await vault.search.search('Kinnaur')).some(row => row.entityId === draft.id), 'Trip trash exclusion failed');
  await vault.trips.restoreTrip(draft.id); check((await vault.search.search('Kinnaur')).some(row => row.entityId === draft.id), 'Trip restore inclusion failed');
  await vault.companions.remove(companion.id); check(!(await vault.search.search('Rahul')).some(row => row.entityId === companion.id), 'Companion archive exclusion failed');
  await vault.companions.restore(companion.id); check((await vault.search.search('Rahul')).some(row => row.entityId === companion.id), 'Companion restore failed');
  await vault.chapters.remove(chapter.id); check(!(await vault.search.search('College Years')).some(row => row.entityId === chapter.id), 'Chapter archive exclusion failed');
  await vault.chapters.restore(chapter.id); check((await vault.search.search('College Years')).some(row => row.entityId === chapter.id), 'Chapter restore failed');
  await vault.dreams.archive(dream.id); check(!(await vault.search.search('Slow train')).some(row => row.entityId === dream.id), 'Dream archive exclusion failed');
  await vault.dreams.unarchive(dream.id); check((await vault.search.search('Slow train')).some(row => row.entityId === dream.id), 'Dream restore failed');
  await vault.database.run(connection => connection.execAsync("INSERT INTO search_fts(search_fts) VALUES('integrity-check')"));
  const report = 'PASS: native FTS5 title/place/Companion/Chapter/Dream/note/day search, case/prefix/multi-term matching, malformed input safety, rename, trash/restore, entity archive/restore, and FTS integrity.';
  checkpoint().write(JSON.stringify({ tripId: draft.id, placeId: place.id, companionId: companion.id, chapterId: chapter.id, dreamId: dream.id, report } satisfies Checkpoint));
  return report;
}

export async function auditNativeSearchAfterRelaunch(): Promise<string> {
  check(checkpoint().exists, 'Run the Step 13 search lifecycle first');
  const saved = JSON.parse(await checkpoint().text()) as Checkpoint; const vault = await openVaultDatabase();
  check((await vault.search.search('Kinnaur')).some(row => row.entityId === saved.tripId), 'Trip missing after relaunch');
  check((await vault.search.search('Sangla')).some(row => row.entityId === saved.placeId), 'Place missing after relaunch');
  check((await vault.search.search('Rahul')).some(row => row.entityId === saved.companionId), 'Companion missing after relaunch');
  check((await vault.search.search('College Years')).some(row => row.entityId === saved.chapterId), 'Chapter missing after relaunch');
  check((await vault.search.search('Japan')).some(row => row.entityId === saved.dreamId), 'Dream missing after relaunch');
  return `PASS after force-stop/relaunch, offline: ${saved.report}`;
}
