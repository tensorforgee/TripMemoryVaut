import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrations, migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { MemoryRepository } from '../../.expo/step1-tests/features/memories/repository.js';
import { SearchRepository } from '../../.expo/step1-tests/features/search/repository.js';
import { TimelineRepository } from '../../.expo/step1-tests/features/timeline/repository.js';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { memoryInput } from '../../.expo/step1-tests/domain/memory.js';
import { resetVaultContents } from '../../.expo/step1-tests/features/settings/reset-database.js';

const input={title:'Evening recollection',body:'We talked by the river.',dates:null,dayId:null,stopId:null,mediaIds:[]};
const approximate={start:{precision:'year',value:'2009'},end:null,certainty:'approximate',source:'user',label:'College days'};
const stamp='2026-11-12T00:00:00.000Z';
async function seed(t){
  const f=await fixture(t),trip=await f.trips.createTripDraft({title:'Synthetic memories'});
  const repo=new MemoryRepository(f.database,f.vault.id,randomUUID),search=new SearchRepository(f.database,f.vault.id);
  const timeline=new TimelineRepository(f.database,f.vault.id,randomUUID),routes=new RouteRepository(f.database,f.vault.id,randomUUID);
  const day=await timeline.createTripDay(trip.id,{label:'Early'});
  const place=await routes.createPlace({name:'Remembered place'});
  const stop=await routes.addStop(trip.id,{placeId:place.id});
  const mediaId=randomUUID();
  await f.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,source_fidelity,source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,1,'image/jpeg','jpg',1,1,'unknown','{}',1,?,?)`,mediaId,f.vault.id,'a'.repeat(64),stamp,stamp);
  return {...f,trip,repo,search,timeline,routes,day,stop,mediaId};
}
test('CRUD preserves unknown/approximate dates, identity and original evidence',async t=>{
  const x=await seed(t),before=await x.connection.getFirstAsync('SELECT * FROM media');
  const id=await x.repo.save(x.trip.id,{...input,mediaIds:[x.mediaId]});
  const first=(await x.repo.list(x.trip.id))[0];assert.equal(first.id,id);assert.equal(first.dates,null);
  await x.repo.save(x.trip.id,{...input,title:'Edited memory',dates:approximate,dayId:x.day.id,mediaIds:[x.mediaId]},id);
  const edited=(await x.repo.list(x.trip.id))[0];assert.deepEqual(edited.dates,approximate);assert.equal(edited.createdAt,first.createdAt);
  await x.repo.remove(x.trip.id,id);assert.deepEqual(await x.repo.list(x.trip.id),[]);
  assert.deepEqual(await x.connection.getFirstAsync('SELECT * FROM media'),before);
  await assert.rejects(x.repo.save(x.trip.id,input,id),/unavailable/);
});
test('date validation accepts absent, unknown, day, month, year and approximate values without invention',()=>{
  const dates=[null,{start:{precision:'unknown'},end:null,certainty:'unknown',source:'user'},approximate,
    ...[['day','2009-02-28'],['month','2009-02'],['year','2009']].map(([precision,value])=>({start:{precision,value},end:null,certainty:'exact',source:'user'}))];
  for(const value of dates)assert.deepEqual(memoryInput({...input,dates:value}).dates,value);
  assert.throws(()=>memoryInput({...input,dates:{...approximate,start:{precision:'day',value:'2009-02-30'}}}));
  assert.throws(()=>memoryInput({...input,title:' '}));assert.throws(()=>memoryInput({...input,body:' '}));
  assert.throws(()=>memoryInput({...input,dayId:randomUUID(),stopId:randomUUID()}));
});
test('trip trash hides memories and search; restore preserves anchors and independent removals',async t=>{
  const x=await seed(t),id=await x.repo.save(x.trip.id,{...input,stopId:x.stop.id,mediaIds:[x.mediaId]});
  const removed=await x.repo.save(x.trip.id,{...input,title:'Removed'});await x.repo.remove(x.trip.id,removed);
  await x.trips.trashTrip(x.trip.id);assert.deepEqual(await x.repo.list(x.trip.id),[]);assert.deepEqual(await x.search.search('recollection'),[]);
  await assert.rejects(x.repo.save(x.trip.id,input,id),/unavailable/);
  await x.trips.restoreTrip(x.trip.id);const restored=await x.repo.list(x.trip.id);assert.equal(restored.length,1);assert.equal(restored[0].stopId,x.stop.id);
  assert.equal((await x.search.search('recollection'))[0].entityId,id);
});
test('removing a section or Stop detaches context and keeps memory text/photos',async t=>{
  const x=await seed(t),a=await x.repo.save(x.trip.id,{...input,dayId:x.day.id}),b=await x.repo.save(x.trip.id,{...input,stopId:x.stop.id});
  await x.timeline.removeTripDay(x.trip.id,x.day.id);await x.routes.removeStop(x.trip.id,x.stop.id);
  const rows=await x.repo.list(x.trip.id);assert.equal(rows.find(n=>n.id===a).dayId,null);assert.equal(rows.find(n=>n.id===b).stopId,null);assert.equal(rows[0].body,input.body);
});
test('shared attachments detach independently and prevent source trash or physical deletion',async t=>{
  const x=await seed(t),other=await x.trips.createTripDraft({title:'Second trip'});
  const a=await x.repo.save(x.trip.id,{...input,mediaIds:[x.mediaId]}),b=await x.repo.save(other.id,{...input,mediaIds:[x.mediaId]});
  await x.repo.save(x.trip.id,input,a);assert.deepEqual((await x.repo.list(other.id))[0].mediaIds,[x.mediaId]);
  await assert.rejects(x.connection.runAsync('UPDATE media SET deleted_at=? WHERE id=?',stamp,x.mediaId),/referenced/);
  await assert.rejects(x.connection.runAsync('DELETE FROM media WHERE id=?',x.mediaId),/FOREIGN KEY/);
  await x.repo.remove(other.id,b);assert.equal((await x.connection.getFirstAsync('SELECT COUNT(*) n FROM media')).n,1);
});
test('same-trip/vault constraints and failed attachment writes roll back the whole edit',async t=>{
  const x=await seed(t),other=await x.trips.createTripDraft({title:'Other'});
  await assert.rejects(x.repo.save(other.id,{...input,dayId:x.day.id}));
  await assert.rejects(x.repo.save(other.id,{...input,stopId:x.stop.id}));
  const id=await x.repo.save(x.trip.id,input);
  await assert.rejects(x.repo.save(x.trip.id,{...input,title:'Rollback',mediaIds:[x.mediaId,randomUUID()]},id));
  assert.equal((await x.repo.list(x.trip.id))[0].title,input.title);assert.deepEqual((await x.repo.list(x.trip.id))[0].mediaIds,[]);
  const alien=new MemoryRepository(x.database,randomUUID(),randomUUID);assert.deepEqual(await alien.list(x.trip.id),[]);await assert.rejects(alien.save(x.trip.id,input));
  assert.deepEqual(await x.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
});
test('search updates transactionally on edits/removal and rebuild retains title/body matches',async t=>{
  const x=await seed(t),id=await x.repo.save(x.trip.id,input);
  assert.equal((await x.search.search('river'))[0].entityType,'memory');assert.match((await x.search.search('recollection'))[0].navigationTarget,new RegExp(id));
  await x.repo.save(x.trip.id,{...input,body:'Quiet orchard'},id);assert.deepEqual(await x.search.search('river'),[]);
  await x.search.rebuild();assert.equal((await x.search.search('orchard'))[0].entityId,id);
  await x.connection.runAsync("INSERT INTO search_fts(search_fts,rank) VALUES('integrity-check',1)");
  await x.repo.remove(x.trip.id,id);assert.deepEqual(await x.search.search('orchard'),[]);
});
test('offline reopen retains memory, attachments and unfinished editor draft',async t=>{
  const x=await seed(t),id=await x.repo.save(x.trip.id,{...input,mediaIds:[x.mediaId],dates:approximate});
  const draft=JSON.stringify({id,title:'Unfinished',body:'Draft survives',mediaIds:[x.mediaId]});await x.repo.saveDraft(x.trip.id,draft);
  await x.database.close();const c=new NodeConnection(x.path);await configureConnection(c);const db=new LocalDatabase(c);
  try {const repo=new MemoryRepository(db,x.vault.id,randomUUID);assert.equal((await repo.list(x.trip.id))[0].id,id);assert.equal(await repo.draft(x.trip.id),draft);assert.deepEqual((await repo.list(x.trip.id))[0].mediaIds,[x.mediaId]);}
  finally{await db.close();}
});
test('v12 upgrade preserves migration checksums and existing FTS; failed migration restores snapshot',async t=>{
  const x=await fixture(t,false);await migrateDatabase(x.database,x.services,migrations.slice(0,12));
  const v=await getOrCreateVault(x.database,randomUUID),trips=new TripRepository(x.database,v.id,randomUUID);const trip=await trips.createTripDraft({title:'Existing history'});
  const history=await x.connection.getAllAsync('SELECT * FROM schema_migrations');
  await assert.rejects(migrateDatabase(x.database,x.services,[...migrations.slice(0,12),{version:13,sql:migrations[12].sql+'\nINVALID SQL;'}]));
  assert.equal((await x.connection.getFirstAsync('PRAGMA user_version')).user_version,12);
  await migrateDatabase(x.database,x.services);assert.deepEqual((await x.connection.getAllAsync('SELECT * FROM schema_migrations')).slice(0,12),history);
  assert.deepEqual(await trips.getTripById(trip.id),trip);assert.equal((await new SearchRepository(x.database,v.id).search('history'))[0].entityId,trip.id);
  await migrateDatabase(x.database,x.services);
});
test('explicit reset on a disposable database deletes references in dependency order',async t=>{
  const x=await seed(t);await x.repo.save(x.trip.id,{...input,mediaIds:[x.mediaId]});await x.repo.saveDraft(x.trip.id,'{}');
  await resetVaultContents(x.database,randomUUID);assert.deepEqual(await x.connection.getAllAsync('PRAGMA foreign_key_check'),[]);assert.deepEqual(await x.connection.getAllAsync('SELECT * FROM memories'),[]);
});


test('draft photo references block media trash until discarded',async t=>{
 const x=await seed(t);await x.repo.saveDraft(x.trip.id,JSON.stringify({mediaIds:[x.mediaId]}));
 await assert.rejects(x.connection.runAsync('UPDATE media SET deleted_at=? WHERE id=?',stamp,x.mediaId),/memory draft/);
 await assert.rejects(x.connection.runAsync('DELETE FROM media WHERE id=?',x.mediaId),/memory draft/);
 await x.repo.discardDraft(x.trip.id);await x.connection.runAsync('UPDATE media SET deleted_at=? WHERE id=?',stamp,x.mediaId);
});
