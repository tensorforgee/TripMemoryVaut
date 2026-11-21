import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from '../step1/sqlite-harness.mjs';
import { MemoryRepository } from '../../.expo/step1-tests/features/memories/repository.js';

test('overview preserves empty, unassigned, missing-preview and trashed states', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'Unknown history' });
  assert.deepEqual((await f.trips.overview([trip.id])).map(row => ({...row})), [{ id: trip.id, photos: 0, stops: 0, memories: 0, cover: null }]);
  const memories = new MemoryRepository(f.database, f.vault.id, randomUUID);
  const memory = await memories.save(trip.id, { title: 'Remembered', body: 'A recollection', dates: null, dayId: null, stopId: null, mediaIds: [] });
  const mediaId = randomUUID(), placement = randomUUID(), stamp = '2026-11-15T00:00:00.000Z';
  await f.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,source_fidelity,source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,1,'image/jpeg','jpg',1,1,'unknown','{}',1,?,?)`, mediaId,f.vault.id,'a'.repeat(64),stamp,stamp);
  await f.connection.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,position,created_at,updated_at) VALUES(?,?,?,?,0,?,?)`,placement,f.vault.id,trip.id,mediaId,stamp,stamp);
  assert.equal((await f.trips.overview([trip.id]))[0].photos, 1);
  for (const variant of ['display','original']) await f.connection.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at) VALUES(?,?,?,?,'available',1,1,?)`,mediaId,f.vault.id,variant,`media/${variant}.jpg`,stamp);
  assert.deepEqual({...((await f.trips.overview([trip.id]))[0])}, {id:trip.id,photos:1,stops:0,memories:1,cover:'media/display.jpg'});
  await f.connection.runAsync("UPDATE local_media_files SET state='missing' WHERE variant='original'");
  assert.equal((await f.trips.overview([trip.id]))[0].cover, null);
  await memories.remove(trip.id, memory);
  assert.equal((await f.trips.overview([trip.id]))[0].memories, 0);
  await f.trips.trashTrip(trip.id);
  assert.deepEqual(await f.trips.overview([trip.id]), []);
  assert.deepEqual(await f.trips.overview([]), []);
  assert.throws(() => f.trips.overview(Array(101).fill(trip.id)));
});
