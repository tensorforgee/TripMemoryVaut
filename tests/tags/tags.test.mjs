import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase,configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrations,migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TagRepository } from '../../.expo/step1-tests/features/tags/repository.js';
import { MemoryRepository } from '../../.expo/step1-tests/features/memories/repository.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { SearchRepository } from '../../.expo/step1-tests/features/search/repository.js';
import { resetVaultContents } from '../../.expo/step1-tests/features/settings/reset-database.js';
const input={title:'Evening',body:'Quiet river',dates:null,dayId:null,stopId:null,mediaIds:[]};
async function seed(t){const f=await fixture(t),tags=new TagRepository(f.database,f.vault.id,randomUUID),memories=new MemoryRepository(f.database,f.vault.id,randomUUID);
 const trip=await f.trips.createTripDraft({title:'Mountains'}),memory=await memories.save(trip.id,input);
 return {...f,tags,memories,trip,memory,search:new SearchRepository(f.database,f.vault.id),a:{kind:'trip',id:trip.id},b:{kind:'memory',id:memory}};}
test('tag create/rename validates, prevents normalized duplicates, races and preserves identity',async t=>{
 const x=await seed(t),g=await x.tags.create('  Summer   walks  ');assert.equal(g.name,'Summer walks');
 for(const name of ['SUMMER WALKS','Ｓｕｍｍｅｒ walks'])await assert.rejects(x.tags.create(name),/already exists/);
 for(const name of [' ','x'.repeat(81),'a\u0000b'])await assert.rejects(async()=>x.tags.create(name));
 await x.tags.rename(g.id,'Straße');await assert.rejects(x.tags.create('STRASSE'),/already exists/);
 const other=await x.tags.create('Family');await assert.rejects(x.tags.rename(other.id,'straße'),/already exists/);
 const race=await Promise.allSettled([x.tags.create('Race'),x.tags.create('race')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await x.tags.list()).find(r=>r.id===g.id).name,'Straße');
});
test('many-to-many associations are idempotent, independently detached and survive content edits',async t=>{
 const x=await seed(t),g=await x.tags.create('Hiking'),other=await x.trips.createTripDraft({title:'Second'});
 for(const target of [x.a,x.b,{kind:'trip',id:other.id}]){await x.tags.setAttached(target,g.id,true);await x.tags.setAttached(target,g.id,true);}
 assert.equal((await x.connection.getFirstAsync('SELECT count(*) n FROM trip_tags')).n,2);
 const original=await x.connection.getFirstAsync('SELECT * FROM memory_tags');
 await x.memories.save(x.trip.id,{...input,title:'Changed'},x.memory);assert.deepEqual((await x.tags.forTarget(x.b)).map(r=>({...r})),[g]);
 await x.tags.setAttached(x.b,g.id,false);assert.deepEqual((await x.tags.forTarget(x.a)).map(r=>({...r})),[g]);
 await x.tags.setAttached(x.b,g.id,true);assert.equal((await x.connection.getFirstAsync('SELECT * FROM memory_tags')).id,original.id);
 await x.tags.rename(g.id,'Walking');assert.equal((await x.tags.forTarget(x.b))[0].name,'Walking');
});
test('deletion detaches without changing content; parent trash/restore preserves explicit detachment',async t=>{
 const x=await seed(t),a=await x.tags.create('Shared'),b=await x.tags.create('Detached');
 for(const target of [x.a,x.b])for(const g of [a,b])await x.tags.setAttached(target,g.id,true);
 await x.tags.setAttached(x.a,b.id,false);await x.trips.trashTrip(x.trip.id);
 assert.deepEqual(await x.search.search('',30,[a.id]),[]);await assert.rejects(x.tags.setAttached(x.b,b.id,true));
 await x.trips.restoreTrip(x.trip.id);assert.deepEqual((await x.tags.forTarget(x.a)).map(r=>({...r})),[a]);assert.equal((await x.tags.forTarget(x.b)).length,2);
 const before=await x.connection.getAllAsync('SELECT * FROM trips');await x.tags.remove(a.id);
 assert.deepEqual(await x.tags.forTarget(x.a),[]);assert.deepEqual(await x.connection.getAllAsync('SELECT * FROM trips'),before);
 assert.equal((await x.memories.list(x.trip.id))[0].body,input.body);
 await x.memories.remove(x.trip.id,x.memory);assert.equal((await x.connection.getFirstAsync('SELECT count(*) n FROM memory_tags WHERE deleted_at IS NULL')).n,0);
 await x.tags.create('Shared');await resetVaultContents(x.database,randomUUID);
});
test('offline search combines text and all selected direct tags; rename, detach, deleted tags update immediately',async t=>{
 const x=await seed(t),a=await x.tags.create('Alpine'),b=await x.tags.create('Family');
 await x.tags.setAttached(x.a,a.id,true);await x.tags.setAttached(x.b,a.id,true);await x.tags.setAttached(x.b,b.id,true);
 assert.equal((await x.search.search('alp')).length,2);
 assert.equal((await x.search.search('',30,[a.id])).length,2);
 assert.deepEqual((await x.search.search('',30,[a.id,b.id])).map(r=>r.entityId),[x.memory]);
 assert.deepEqual((await x.search.search('river',30,[a.id,b.id])).map(r=>r.entityId),[x.memory]);
 assert.deepEqual(await x.search.search('Mountains',30,[b.id]),[]);
 await x.tags.rename(a.id,'Snow');assert.deepEqual(await x.search.search('alp'),[]);assert.equal((await x.search.search('Snow')).length,2);
 await x.tags.setAttached(x.b,a.id,false);assert.deepEqual(await x.search.search('',30,[a.id,b.id]),[]);
 await x.search.rebuild();assert.equal((await x.search.search('Snow')).length,1);
 await x.tags.remove(a.id);assert.deepEqual(await x.search.search('Snow'),[]);
});
test('tag filters are applied before result cap and do not inherit parent tags',async t=>{
 const x=await seed(t),g=await x.tags.create('Rare');
 for(let i=0;i<70;i++)await x.trips.createTripDraft({title:`Match ${i}`});
 const last=await x.trips.createTripDraft({title:'Match ZZZ'});await x.tags.setAttached({kind:'trip',id:last.id},g.id,true);
 assert.deepEqual((await x.search.search('Match',30,[g.id])).map(r=>r.entityId),[last.id]);
 await x.tags.setAttached(x.a,g.id,true);assert.equal((await x.search.search('',30,[g.id])).some(r=>r.entityId===x.memory),false);
});
test('ownership guards reject dangling and cross-vault assignments; reopen keeps links',async t=>{
 const x=await seed(t),g=await x.tags.create('Kept');await x.tags.setAttached(x.b,g.id,true);
 await assert.rejects(x.tags.setAttached({kind:'trip',id:randomUUID()},g.id,true));
 const alien=new TagRepository(x.database,randomUUID(),randomUUID);await assert.rejects(alien.setAttached(x.b,g.id,true));
 await x.database.close();const c=new NodeConnection(x.path);await configureConnection(c);const db=new LocalDatabase(c);
 try{assert.deepEqual((await new TagRepository(db,x.vault.id,randomUUID).forTarget(x.b)).map(r=>({...r})),[g]);assert.deepEqual(await c.getAllAsync('PRAGMA foreign_key_check'),[]);}finally{await db.close();}
});
test('migration 14 to 15 retains populated memories, media metadata and immutable ledger; rollback recovers',async t=>{
 const x=await fixture(t,false);await migrateDatabase(x.database,x.services,migrations.slice(0,14));const v=await getOrCreateVault(x.database,randomUUID);
 const trips=new TripRepository(x.database,v.id,randomUUID),trip=await trips.createTripDraft({title:'Existing'});
 await new MemoryRepository(x.database,v.id,randomUUID).save(trip.id,input);
 await x.connection.runAsync("INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,source_fidelity,source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,1,'image/heic','heic','unknown','{}',1,?,?)",randomUUID(),v.id,'a'.repeat(64),'2026-11-13T00:00:00.000Z','2026-11-13T00:00:00.000Z');
 const mediaBefore=await x.connection.getAllAsync('SELECT * FROM media');
 const before=await x.connection.getAllAsync('SELECT * FROM memories'),ledger=await x.connection.getAllAsync('SELECT * FROM schema_migrations');
 await assert.rejects(migrateDatabase(x.database,x.services,[...migrations.slice(0,14),{version:15,sql:migrations[14].sql+' INVALID;'}]));
 assert.equal((await x.connection.getFirstAsync('PRAGMA user_version')).user_version,14);
 await migrateDatabase(x.database,x.services);await migrateDatabase(x.database,x.services);
 assert.deepEqual(await x.connection.getAllAsync('SELECT * FROM media'),mediaBefore);
 assert.deepEqual(await x.connection.getAllAsync('SELECT * FROM memories'),before);assert.deepEqual((await x.connection.getAllAsync('SELECT * FROM schema_migrations')).slice(0,14),ledger);
});

test('tag FTS matches diacritics and token prefixes, updates on rename and rebuild',async t=>{
 const x=await seed(t),g=await x.tags.create('Café Winter');await x.tags.setAttached(x.a,g.id,true);
 assert.deepEqual((await x.search.search('cafe win')).map(r=>r.entityId),[x.trip.id]);
 assert.equal(await x.search.indexVersion(),3);await x.search.rebuild();
 await x.connection.runAsync("INSERT INTO search_fts(search_fts,rank) VALUES('integrity-check',1)");
 await x.tags.rename(g.id,'Snow');assert.deepEqual(await x.search.search('cafe'),[]);
 assert.equal((await x.connection.getFirstAsync("SELECT count(*) n FROM search_documents WHERE entity_type='tag'")).n,1);
 await x.tags.remove(g.id);assert.equal((await x.connection.getFirstAsync("SELECT count(*) n FROM search_documents WHERE entity_type='tag'")).n,0);
});
