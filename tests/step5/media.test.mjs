import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, rename, stat, unlink, readdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { MediaRepository } from '../../.expo/step1-tests/features/media/repository.js';
import { ImportPipeline } from '../../.expo/step1-tests/services/import/pipeline.js';
import { parseMedia, parseTripMedia } from '../../.expo/step1-tests/domain/media.js';
import { mediaPath } from '../../.expo/step1-tests/core/media/files.js';
import { migrations, migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
const corpus=join(import.meta.dirname,'../fixtures/media');
const manifest=JSON.parse(await readFile(join(corpus,'manifest.json'),'utf8'));
const evidence=(name='plain.jpg')=>({...manifest[name],originalFilename:name,sourceFidelity:'picker_representation'});
// Real filesystem and SQLite; inspect/decode is an explicit native-boundary double.
// Actual decoder/EXIF behavior is checked separately on Android, not asserted by this double.
class Files {
  constructor(root){this.root=root;this.failDerivative=false;this.copies=0;}
  uri(p){return join(this.root,p);}
  async copy(s,p){this.copies++;await mkdir(dirname(this.uri(p)),{recursive:true});await copyFile(s.replace('file://',''),this.uri(p));}
  async inspect(p){const b=await readFile(this.uri(p));const hash=createHash('sha256').update(b).digest('hex');const found=Object.values(manifest).find(x=>x.sha256===hash);if(!found)throw Error('UNSUPPORTED_FORMAT');return found;}
  async verify(p,h,n){try{const b=await readFile(this.uri(p));return b.length===n&&createHash('sha256').update(b).digest('hex')===h;}catch{return false;}}
  async publish(s,p,h,n){await mkdir(dirname(this.uri(p)),{recursive:true});if(await this.exists(p)){if(!await this.verify(p,h,n))throw Error('ORIGINAL_CONFLICT');}else{assert.ok(await this.verify(s,h,n));await rename(this.uri(s),this.uri(p));}}
  async derive(s,p){if(this.failDerivative)throw Error('decode failed');await mkdir(dirname(this.uri(p)),{recursive:true});await copyFile(this.uri(s),this.uri(p));const e=await this.inspect(p);return {bytes:e.byteSize,checksum:e.sha256,width:e.width,height:e.height};}
  async exists(p){try{return(await stat(this.uri(p))).isFile();}catch{return false;}}
  async removeStaging(p){if(await this.exists(p))await unlink(this.uri(p));}
}
async function setup(t){const f=await fixture(t);const trip=await f.trips.createTripDraft({title:'Synthetic media trip'});const repo=new MediaRepository(f.database,f.vault.id,randomUUID);const files=new Files(join(dirname(f.path),'files'));return {...f,trip,repo,files,pipeline:new ImportPipeline(repo,files)};}
async function select(f,names=['plain.jpg']){await f.repo.select(f.trip.id,names.map(name=>({uri:'file://'+join(corpus,name),filename:name})));}

test('Media validates hash/type/size/dimensions, raw metadata and unknowns',()=>{
  assert.equal(parseMedia(evidence()).sourceMetadata.capture,null);assert.equal(parseMedia(evidence()).sourceMetadata.gps,null);
  const e=evidence('capture-gps.jpg');assert.deepEqual(parseMedia(e),e);
  const snapshot=parseMedia(e);snapshot.sourceMetadata.exif.DateTimeOriginal='changed';assert.equal(e.sourceMetadata.exif.DateTimeOriginal,'2001:02:03 04:05:06');
  for(const patch of [{sha256:'bad'},{byteSize:0},{byteSize:104857601},{mimeType:'video/mp4'},{extension:'exe'},{width:0},{height:null},{parserVersion:0},{sourceFidelity:'camera_original'},{sourceMetadata:{...e.sourceMetadata,gps:{latitude:91,longitude:0}}},{sourceMetadata:{...e.sourceMetadata,capture:{...e.sourceMetadata.capture,local:'2001-02-30T04:05:06'}}}])assert.throws(()=>parseMedia({...e,...patch}));
});
test('TripMedia validates IDs, position, optional context, favourite and caption',()=>{
  const p={tripId:randomUUID(),mediaId:randomUUID(),position:0,caption:null,isFavourite:false,dayId:null,stopId:null};assert.deepEqual(parseTripMedia(p),p);
  for(const patch of [{tripId:'x'},{position:-1},{position:0.5},{isFavourite:1},{caption:''},{dayId:'x'},{stopId:'x'}])assert.throws(()=>parseTripMedia({...p,...patch}));
});
test('migration v3 to v4 preserves trips and creates only media foundation',async t=>{
  const f=await fixture(t,false);await migrateDatabase(f.database,f.services,migrations.slice(0,3));
  const before=await f.connection.getAllAsync('SELECT * FROM trips');await migrateDatabase(f.database,f.services);
  assert.deepEqual(await f.connection.getAllAsync('SELECT * FROM trips'),before);assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version,migrations.length);
});
test('applied v4 checksum stays immutable and v5 preserves existing media/jobs/files',async t=>{
  const f=await fixture(t,false);await migrateDatabase(f.database,f.services,migrations.slice(0,4));
  assert.equal(await f.services.checksum(migrations[3].sql),'8be223e91d0e9c2bb0cc385853d28cfb3f76371fbd6a334a860f98c89ce3f0b6');
  const vault=await getOrCreateVault(f.database,randomUUID);const trips=new TripRepository(f.database,vault.id,randomUUID);
  const trip=await trips.createTripDraft({title:'Applied v4'});const repo=new MediaRepository(f.database,vault.id,randomUUID);const files=new Files(join(dirname(f.path),'files'));
  await repo.select(trip.id,[{uri:'file://'+join(corpus,'plain.jpg'),filename:'plain.jpg'}]);await new ImportPipeline(repo,files).run();
  const tables=['media','trip_media','import_items','import_batches','local_media_files'];
  const before=await Promise.all(tables.map(name=>f.connection.getAllAsync(`SELECT * FROM ${name}`)));
  await migrateDatabase(f.database,f.services);
  assert.deepEqual(await Promise.all(tables.map(name=>f.connection.getAllAsync(`SELECT * FROM ${name}`))),before);
  for(const a of await repo.assets())assert.ok(await files.verify(a.relative_path,a.sha256,a.byte_size));
  assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
});
test('JPEG/PNG import archives real durable bytes, preserves capture/GPS, orders placements',async t=>{
  const f=await setup(t);await select(f,['plain.jpg','transparent.png','capture-gps.jpg']);await f.pipeline.run();
  const jobs=await f.repo.items();assert.ok(jobs.every(j=>j.state==='archived'&&j.source_uri===null));
  const photos=await f.repo.gallery(f.trip.id);assert.deepEqual(photos.map(p=>p.original_filename),['plain.jpg','transparent.png','capture-gps.jpg']);
  for(const a of await f.repo.assets())assert.ok(await f.files.verify(a.relative_path,a.sha256,a.byte_size));
  const rows=await f.connection.getAllAsync('SELECT * FROM media ORDER BY original_filename');
  assert.deepEqual(JSON.parse(rows[0].source_metadata_json),manifest['capture-gps.jpg'].sourceMetadata);
  assert.equal(JSON.parse(rows[1].source_metadata_json).capture,null);
  await assert.rejects(f.connection.execAsync("UPDATE media SET source_metadata_json='{}'"),/immutable/);
});
test('duplicate hash reuse, cross-trip reuse and duplicate placement prevention',async t=>{
  const f=await setup(t);await select(f,['plain.jpg','plain.jpg']);await Promise.all([f.pipeline.run(),f.pipeline.run()]);
  assert.equal((await f.repo.assets()).length,1);assert.equal((await f.repo.gallery(f.trip.id)).length,1);
  assert.equal((await f.repo.items())[1].result,'already_added');
  const other=await f.trips.createTripDraft({title:'Other trip'});await f.repo.select(other.id,[{uri:'file://'+join(corpus,'plain.jpg'),filename:'same.jpg'}]);await f.pipeline.run();
  assert.equal((await f.repo.assets()).length,1);assert.equal((await f.repo.gallery(other.id)).length,1);
  const asset=(await f.repo.assets())[0];assert.equal((await readdir(dirname(f.files.uri(asset.relative_path)))).length,1);
});
test('invalid transitions are rejected, unsupported is explicit and partial success persists',async t=>{
  const f=await setup(t);await select(f,['plain.jpg','unsupported.gif']);const item=(await f.repo.items())[0];
  await assert.rejects(f.repo.state(item.id,'archived'),/transition|CHECK/);await f.pipeline.run();
  assert.deepEqual((await f.repo.items()).map(i=>i.state),['archived','unsupported']);assert.equal((await f.repo.gallery(f.trip.id)).length,1);
});
test('interruption during copy discards even a decodable partial and reacquires',async t=>{
  const f=await setup(t);await select(f);const item=(await f.repo.items())[0];await f.repo.state(item.id,'copying');await f.files.copy(item.source_uri,item.staging_relative_path);
  await new ImportPipeline(f.repo,f.files).run();assert.equal(f.files.copies,2);assert.equal((await f.repo.items())[0].state,'archived');
});
test('crash after verified journal or rename recovers idempotently without source',async t=>{
  for(const publish of [false,true]){
    const f=await setup(t);await select(f);let item=(await f.repo.items())[0];await f.repo.state(item.id,'copying');await f.files.copy(item.source_uri,item.staging_relative_path);await f.repo.state(item.id,'staged');await f.repo.verified(item.id,evidence());
    if(publish)await f.files.publish(item.staging_relative_path,mediaPath(evidence().sha256,'jpg'),evidence().sha256,evidence().byteSize);
    await f.connection.runAsync('UPDATE import_items SET source_uri=NULL WHERE id=?',item.id);
    await new ImportPipeline(f.repo,f.files).run();assert.equal((await f.repo.items())[0].state,'archived');assert.equal((await f.repo.assets()).length,1);assert.equal(f.files.copies,1);
  }
});
test('derivative failure retains original and retries independently without another copy',async t=>{
  const f=await setup(t);f.files.failDerivative=true;await select(f);await f.pipeline.run();
  assert.equal((await f.repo.items())[0].state,'archived');assert.equal((await f.repo.gallery(f.trip.id))[0].display,null);
  const asset=(await f.repo.assets())[0];assert.ok(await f.files.verify(asset.relative_path,asset.sha256,asset.byte_size));
  f.files.failDerivative=false;await f.pipeline.run(true);assert.ok((await f.repo.gallery(f.trip.id))[0].display);assert.equal(f.files.copies,1);
});
test('remove placement retains Media; restart does not resurrect placement; trip trash/restore isolated',async t=>{
  const f=await setup(t);await select(f,['plain.jpg','transparent.png']);await f.pipeline.run();const p=await f.repo.gallery(f.trip.id);
  await f.repo.remove(f.trip.id,p[0].id);await f.trips.trashTrip(f.trip.id);assert.equal((await f.repo.gallery(f.trip.id)).length,0);
  await f.trips.restoreTrip(f.trip.id);await f.pipeline.run();assert.deepEqual((await f.repo.gallery(f.trip.id)).map(x=>x.id),[p[1].id]);assert.equal((await f.repo.assets()).length,2);
});
test('vault/trip ownership, tombstones, FK integrity and active uniqueness',async t=>{
  const f=await setup(t);await select(f);await f.pipeline.run();const p=(await f.repo.gallery(f.trip.id))[0];
  const other=new MediaRepository(f.database,randomUUID(),randomUUID);assert.deepEqual(await other.gallery(f.trip.id),[]);await assert.rejects(other.remove(f.trip.id,p.id));await assert.rejects(other.select(f.trip.id,[{uri:'file://a',filename:null}]));
  await assert.rejects(f.connection.runAsync('UPDATE trip_media SET media_id=?',randomUUID()));
  await assert.rejects(f.connection.runAsync('UPDATE media SET deleted_at=?',new Date().toISOString()),/live placements/);
  assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
});
test('context FKs require same trip and trip trash preserves recoverable photo context',async t=>{
  const f=await setup(t);await select(f);await f.pipeline.run();const photo=(await f.repo.gallery(f.trip.id))[0];
  const day=randomUUID(),stop=randomUUID(),place=randomUUID(),now=new Date().toISOString();
  await f.connection.runAsync('INSERT INTO trip_days(id,vault_id,trip_id,position,created_at,updated_at) VALUES(?,?,?,0,?,?)',day,f.vault.id,f.trip.id,now,now);
  await f.connection.runAsync('INSERT INTO places(id,vault_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',place,f.vault.id,'Synthetic place',now,now);
  await f.connection.runAsync('INSERT INTO stops(id,vault_id,trip_id,place_id,day_id,position,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)',stop,f.vault.id,f.trip.id,place,day,now,now);
  await assert.rejects(f.connection.runAsync('UPDATE trip_media SET stop_id=? WHERE id=?',stop,photo.id),/matching section/);
  await f.connection.runAsync('UPDATE trip_media SET stop_id=?,day_id=? WHERE id=?',stop,day,photo.id);
  await f.trips.trashTrip(f.trip.id);await f.trips.restoreTrip(f.trip.id);
  assert.equal((await f.connection.getFirstAsync('SELECT stop_id FROM trip_media WHERE id=?',photo.id)).stop_id,stop);
  const other=await f.trips.createTripDraft({title:'Other context'});await assert.rejects(f.connection.runAsync('UPDATE trip_media SET trip_id=? WHERE id=?',other.id,photo.id));
});
test('missing original becomes explicit retry required; never claims available',async t=>{
  const f=await setup(t);await select(f);await f.pipeline.run();const a=(await f.repo.assets())[0];await unlink(f.files.uri(a.relative_path));await f.pipeline.gallery(f.trip.id);
  assert.equal((await f.repo.items())[0].state,'retry_required');assert.equal((await f.repo.gallery(f.trip.id))[0].original_state,'missing');
  await select(f);await f.pipeline.run();assert.equal((await f.repo.assets()).length,1);assert.equal((await f.repo.gallery(f.trip.id))[0].original_state,'available');
});
test('database/files survive close/reopen offline with stable placement order',async t=>{
  const f=await setup(t);await select(f,['transparent.png','plain.jpg']);await f.pipeline.run();const before=await f.repo.gallery(f.trip.id);await f.database.close();
  const conn=new NodeConnection(f.path);try{await configureConnection(conn);const repo=new MediaRepository(new LocalDatabase(conn),f.vault.id,randomUUID);await new ImportPipeline(repo,f.files).run();assert.deepEqual(await repo.gallery(f.trip.id),before);}finally{await conn.closeAsync();}
});

test('SQL failure after publish leaves journal-owned file and retries without duplicate original',async t=>{
  const f=await setup(t);await select(f);
  await f.connection.execAsync("CREATE TRIGGER reject_media BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END;");
  await f.pipeline.run();assert.equal((await f.repo.assets()).length,0);assert.equal((await f.repo.items())[0].state,'failed');
  assert.ok(await f.files.verify(mediaPath(evidence().sha256,'jpg'),evidence().sha256,evidence().byteSize));
  await f.connection.execAsync('DROP TRIGGER reject_media');await f.pipeline.run(true);
  assert.equal((await f.repo.assets()).length,1);assert.equal(f.files.copies,1);assert.equal((await f.repo.items())[0].state,'archived');
});
test('expired picker source requires reselection and never promotes unjournaled staging',async t=>{
  const f=await setup(t);await f.repo.select(f.trip.id,[{uri:'file://'+join(corpus,'missing.jpg'),filename:'missing.jpg'}]);await f.pipeline.run();
  assert.equal((await f.repo.items())[0].state,'retry_required');assert.equal((await f.repo.assets()).length,0);assert.deepEqual(await f.repo.gallery(f.trip.id),[]);
});
test('keyset gallery ordering has no omissions across 60-row boundary',async t=>{
  const f=await setup(t);
  // Exercise repository ordering independent of image codec; each unique test hash represents a separate asset.
  for(let n=0;n<65;n++){
    await f.repo.select(f.trip.id,[{uri:'file://synthetic',filename:`${n}.jpg`}]);const i=(await f.repo.items()).at(-1);
    const e={...evidence(),sha256:createHash('sha256').update(String(n)).digest('hex')};
    await f.repo.state(i.id,'copying');await f.repo.state(i.id,'staged');await f.repo.verified(i.id,e);await f.repo.archive({...i,state:'verified'},e);
  }
  const first=await f.repo.gallery(f.trip.id);const last=first.at(-1);const second=await f.repo.gallery(f.trip.id,{position:last.position,id:last.id});
  assert.equal(first.length,60);assert.equal(second.length,5);assert.deepEqual([...first,...second].map(p=>p.position),Array.from({length:65},(_,i)=>i));
});
