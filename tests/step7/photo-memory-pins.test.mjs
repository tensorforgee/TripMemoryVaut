import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrations, migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { PhotoMemoryRepository } from '../../.expo/step1-tests/features/map/photo-memory-repository.js';
import { pinInput, pinCoordinate, longPressPin } from '../../.expo/step1-tests/features/map/photo-memory-model.js';
import { resetVaultContents } from '../../.expo/step1-tests/features/settings/reset-database.js';

const stamp='2026-10-18T00:00:00.000Z';
async function seed(t) {
  const f=await fixture(t), trip=await f.trips.createTripDraft({title:'Pin-only trip'}), mediaId=randomUUID();
  await f.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,source_fidelity,source_metadata_json,parser_version,created_at,updated_at)
    VALUES(?,?,?,12,'image/jpeg','jpg',10,10,'unknown',?,1,?,?)`,mediaId,f.vault.id,'a'.repeat(64),JSON.stringify({gps:null,capture:null}),stamp,stamp);
  return {...f,trip,mediaId,pins:new PhotoMemoryRepository(f.database,f.vault.id,randomUUID)};
}
test('manual coordinates include zero/poles/dateline and reject missing, infinite or inferred values',()=>{
  for(const point of [[0,0],[-180,-90],[180,90],[77.5,31.2]]) assert.deepEqual(pinCoordinate(point),point);
  for(const point of [[NaN,0],[0,Infinity],[181,0],[0,91],null,[1],['1',2]]) assert.throws(()=>pinCoordinate(point));
  assert.throws(()=>pinInput({mediaId:randomUUID(),coordinate:[0,0],note:'a'.repeat(10001)}));
});
test('long press is a draft; reposition retains photo/note/id until deliberate save',()=>{
  const draft=longPressPin([77,31],null); assert.equal(draft.mediaId,null); assert.equal(draft.id,undefined);
  const editing={...draft,id:randomUUID(),mediaId:randomUUID(),note:'A memory',moving:true};
  const moved=longPressPin([0,0],editing);
  assert.deepEqual(moved,{...editing,coordinate:[0,0],moving:false});
  assert.deepEqual(editing.coordinate,[77,31]);
});
test('pins reuse vault media, remain independent of visits and preserve immutable evidence',async t=>{
  const x=await seed(t), original=await x.connection.getFirstAsync('SELECT * FROM media');
  assert.equal((await x.pins.photos())[0].media_id,x.mediaId);
  const id=await x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[0,0],note:'here'});
  await x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[180,90],note:'updated'},id);
  await x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[180,90],note:null});
  assert.equal((await x.pins.list(x.trip.id)).length,2);
  for(const table of ['stops','places','trip_media','road_route_segments','local_media_files']) assert.equal((await x.connection.getFirstAsync(`SELECT count(*) n FROM ${table}`)).n,0);
  assert.deepEqual(await x.connection.getFirstAsync('SELECT * FROM media'),original);
  await x.pins.remove(x.trip.id,id); assert.equal((await x.pins.list(x.trip.id)).length,1);
  assert.deepEqual(await x.connection.getFirstAsync('SELECT * FROM media'),original);
  await assert.rejects(x.connection.runAsync('UPDATE media SET deleted_at=? WHERE id=?',stamp,x.mediaId),/referenced/);
  await assert.rejects(x.connection.runAsync('DELETE FROM media WHERE id=?',x.mediaId),/FOREIGN KEY/);
});
test('ownership, deleted parents, stale editor and direct SQLite writes fail closed',async t=>{
  const x=await seed(t), other=await x.trips.createTripDraft({title:'Other'});
  const id=await x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[77,31],note:null});
  await assert.rejects(x.pins.save(other.id,{mediaId:x.mediaId,coordinate:[1,1],note:null},id),/unavailable/);
  await assert.rejects(x.pins.save(x.trip.id,{mediaId:randomUUID(),coordinate:[1,1],note:null}));
  const foreign=randomUUID(); await x.connection.runAsync(`INSERT INTO vaults(id,name,format_version,created_at,updated_at) VALUES(?,'Other vault',1,?,?)`,foreign,stamp,stamp);
  const alien=new PhotoMemoryRepository(x.database,foreign,randomUUID);
  assert.deepEqual(await alien.photos(),[]); assert.deepEqual(await alien.list(x.trip.id),[]);
  await assert.rejects(alien.save(x.trip.id,{mediaId:x.mediaId,coordinate:[1,1],note:null}));
  await assert.rejects(x.connection.runAsync('UPDATE photo_memory_pins SET latitude=91 WHERE id=?',id),/CHECK/);
  await assert.rejects(x.connection.runAsync('UPDATE photo_memory_pins SET trip_id=? WHERE id=?',other.id,id),/ownership/);
  await x.trips.trashTrip(x.trip.id); assert.deepEqual(await x.pins.list(x.trip.id),[]);
  await assert.rejects(x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[1,1],note:null},id));
  await x.trips.restoreTrip(x.trip.id); assert.equal((await x.pins.list(x.trip.id))[0].id,id);
  await x.pins.remove(x.trip.id,id); await assert.rejects(x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[1,1],note:null},id),/unavailable/);
});
test('offline SQLite reopening retains pins and full vault picker paginates without duplicates',async t=>{
  const x=await seed(t); const id=await x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[77,31],note:'offline'});
  for(let i=0;i<64;i++) await x.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,source_fidelity,source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,1,'image/png','png',1,1,'unknown','{}',1,?,?)`,randomUUID(),x.vault.id,i.toString(16).padStart(64,'0'),stamp,stamp);
  const first=await x.pins.photos(), second=await x.pins.photos(first.at(-1).media_id);
  assert.equal(first.length,60);assert.equal(second.length,5);assert.equal(new Set([...first,...second].map(p=>p.media_id)).size,65);
  await x.database.close(); const c=new NodeConnection(x.path); await configureConnection(c); const db=new LocalDatabase(c);
  try { assert.equal((await new PhotoMemoryRepository(db,x.vault.id,randomUUID).list(x.trip.id))[0].id,id); }
  finally { await db.close(); }
});
test('migration 12 preserves schema 11 data and checksums; explicit disposable reset respects references',async t=>{
  const f=await fixture(t,false);await migrateDatabase(f.database,f.services,migrations.slice(0,11));
  const vault=await getOrCreateVault(f.database,randomUUID), trips=new TripRepository(f.database,vault.id,randomUUID);
  const trip=await trips.createTripDraft({title:'Keep me'}), history=await f.connection.getAllAsync('SELECT * FROM schema_migrations');
  await migrateDatabase(f.database,f.services);
  assert.deepEqual((await f.connection.getAllAsync('SELECT * FROM schema_migrations')).slice(0,11),history);
  assert.deepEqual(await trips.getTripById(trip.id),trip);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version,12);
  const x=await seed(t);await x.pins.save(x.trip.id,{mediaId:x.mediaId,coordinate:[0,0],note:null});
  await resetVaultContents(x.database,randomUUID);assert.deepEqual(await x.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
});
test('privacy and gesture boundary: no GPS, inference, network, file copy or route writes in pin commands',async()=>{
  const repository=await readFile('src/features/map/photo-memory-repository.ts','utf8');
  assert.doesNotMatch(repository,/fetch\(|location_override|source_metadata|INSERT INTO (stops|places|trip_media|road_route)|\.copy\(|expo-location|openrouteservice/);
  const canvas=await readFile('src/features/map/TripMapScreen.tsx','utf8');
  assert.match(canvas,/onLongPress=\{event => longPress\(event.nativeEvent.lngLat\)\}/);
  const ui=await readFile('src/features/map/PhotoMemories.tsx','utf8');
  assert.match(ui,/Save photo memory/);assert.match(ui,/original is|imported photo and its other uses/);assert.match(ui,/onRequestClose=\{close\}/);
  assert.match(ui,/onPress=\{event => \{ event.stopPropagation\(\); select\(pin\); \}\}/,'Native Marker owns the press, not a nested React Pressable');
});
