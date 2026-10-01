import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fixture } from '../step1/sqlite-harness.mjs';
import { createPortableExport, inspectPortableRestore, publishPortableExport, restorePortableArchive } from '../../.expo/step1-tests/services/archive/portable.js';
import { mediaPath } from '../../.expo/step1-tests/core/media/files.js';

class NodeIO {
  async createRoot(root){await mkdir(root,{recursive:false});}
  async removeRoot(root){await rm(root,{recursive:true,force:true});}
  async writeText(root,path,value){const target=join(root,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,value,'utf8');}
  async readText(root,path){return readFile(join(root,path),'utf8');}
  async copyFromUri(source,root,path){const target=join(root,path);await mkdir(dirname(target),{recursive:true});await cp(source.replace('file://',''),target);}
  async copyTree(source,destination){await cp(source,destination,{recursive:true,errorOnExist:true});}
  async exists(root,path){try{return(await stat(join(root,path))).isFile();}catch{return false;}}
  async size(root,path){return (await stat(join(root,path))).size;}
  fileUri(root,path){return join(root,path);}
  async sha256Text(value){return createHash('sha256').update(value).digest('hex');}
  async verifyFile(root,path,hash,bytes){try{const value=await readFile(join(root,path));return value.length===bytes&&createHash('sha256').update(value).digest('hex')===hash;}catch{return false;}}
}
class MediaFiles {
  constructor(root){this.root=root;this.failCopy=false;this.removed=[];}
  uri(path){return join(this.root,path);}
  async copy(source,path){if(this.failCopy)throw Error('INTERRUPTED_RESTORE');const target=this.uri(path);await mkdir(dirname(target),{recursive:true});await cp(source.replace('file://',''),target);}
  async inspect(){throw Error('unused');}
  async verify(path,hash,bytes){try{const value=await readFile(this.uri(path));return value.length===bytes&&createHash('sha256').update(value).digest('hex')===hash;}catch{return false;}}
  async publish(source,target,hash,bytes){await mkdir(dirname(this.uri(target)),{recursive:true});if(await this.exists(target)){if(!await this.verify(target,hash,bytes))throw Error('ORIGINAL_CONFLICT');}else{await cp(this.uri(source),this.uri(target));}}
  async derive(){throw Error('unused');}
  async exists(path){try{return(await stat(this.uri(path))).isFile();}catch{return false;}}
  async removeStaging(path){this.removed.push(path);if(await this.exists(path))await unlink(this.uri(path));}
}
const stamp='2026-09-30T08:30:00.000Z';
const unknown={start:{precision:'unknown'},end:null,certainty:'unknown',source:'user'};
const approximate={start:{precision:'year',value:'2009'},end:null,certainty:'approximate',source:'user',label:'College year'};

async function seed(f,mediaFiles){
  const c=f.connection,v=f.vault.id;
  const ids=Object.fromEntries(['trip','trashedTrip','place','unmapped','day','stop','trashStop','media','placement','companion','membership','chapter','chapterLink','dream','dreamPlace','dreamVisit','run','suggestion'].map(key=>[key,randomUUID()]));
  await c.runAsync(`INSERT INTO trips(id,vault_id,title,status,dates_json,sort_date,sort_precision,created_at,updated_at) VALUES(?,?,?,'saved',?,'2009-01-01','year',?,?)`,ids.trip,v,'College trip',JSON.stringify(approximate),stamp,stamp);
  await c.runAsync(`INSERT INTO trips(id,vault_id,title,status,dates_json,sort_date,sort_precision,created_at,updated_at) VALUES(?,?,?,'saved',?,NULL,'unknown',?,?)`,ids.trashedTrip,v,'Old deleted trip',JSON.stringify(unknown),stamp,stamp);
  await c.runAsync(`INSERT INTO places(id,vault_id,name,latitude,longitude,coordinate_precision,source,provenance_json,aliases_json,created_at,updated_at) VALUES(?,?,?,31.1048,77.1734,'point','user','{}','[]',?,?)`,ids.place,v,'Shimla',stamp,stamp);
  await c.runAsync(`INSERT INTO places(id,vault_id,name,coordinate_precision,source,provenance_json,aliases_json,created_at,updated_at) VALUES(?,?,?,'unknown','user','{}','[]',?,?)`,ids.unmapped,v,'Unknown village',stamp,stamp);
  await c.runAsync(`INSERT INTO trip_days(id,vault_id,trip_id,position,label,dates_json,created_at,updated_at) VALUES(?,?,?,0,'Arrival',?,?,?)`,ids.day,v,ids.trip,JSON.stringify(approximate),stamp,stamp);
  await c.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,day_id,position,kind,visit_confirmed,detail_certainty,source,dates_json,note,created_at,updated_at) VALUES(?,?,?,?,?,0,'stay',1,'approximate','user',?,'First visit',?,?)`,ids.stop,v,ids.trip,ids.place,ids.day,JSON.stringify(approximate),stamp,stamp);
  await c.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,position,kind,visit_confirmed,detail_certainty,source,created_at,updated_at) VALUES(?,?,?,?,0,'visit',1,'unknown','user',?,?)`,ids.trashStop,v,ids.trashedTrip,ids.place,stamp,stamp);
  const bytes=Buffer.from('original-photo-bytes\n');const hash=createHash('sha256').update(bytes).digest('hex');const relative=mediaPath(hash,'jpg');await mkdir(dirname(mediaFiles.uri(relative)),{recursive:true});await writeFile(mediaFiles.uri(relative),bytes);
  await c.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,original_filename,source_fidelity,source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,?,'image/jpeg','jpg',10,10,'memory.jpg','original_confirmed','{}',1,?,?)`,ids.media,v,hash,bytes.length,stamp,stamp);
  await c.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at,checksum,width,height) VALUES(?,?,'original',?,'available',?,1,?,?,10,10)`,ids.media,v,relative,bytes.length,stamp,hash);
  await c.runAsync(`INSERT INTO trip_media(id,vault_id,trip_id,media_id,day_id,stop_id,position,caption,is_favourite,created_at,updated_at) VALUES(?,?,?,?,?,?,0,'At the ridge',1,?,?)`,ids.placement,v,ids.trip,ids.media,ids.day,ids.stop,stamp,stamp);
  await c.runAsync(`INSERT INTO companions(id,vault_id,label,note,created_at,updated_at) VALUES(?,?,?,'College friend',?,?)`,ids.companion,v,'Aman',stamp,stamp);
  await c.runAsync(`INSERT INTO trip_companions(id,vault_id,trip_id,companion_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`,ids.membership,v,ids.trip,ids.companion,stamp,stamp);
  await c.runAsync(`INSERT INTO chapters(id,vault_id,name,normalized_name,description,position,created_at,updated_at) VALUES(?,?,?,'college years','Studies',0,?,?)`,ids.chapter,v,'College Years',stamp,stamp);
  await c.runAsync(`INSERT INTO trip_chapters(id,vault_id,trip_id,chapter_id,position,created_at,updated_at) VALUES(?,?,?,?,0,?,?)`,ids.chapterLink,v,ids.trip,ids.chapter,stamp,stamp);
  await c.runAsync(`INSERT INTO places(id,vault_id,name,coordinate_precision,source,provenance_json,aliases_json,created_at,updated_at) VALUES(?,?,?,'unknown','user','{}','[]',?,?)`,ids.dreamPlace,v,'Ladakh dream',stamp,stamp);
  await c.runAsync(`INSERT INTO dream_destinations(id,vault_id,place_id,added_dates_json,note,location_text,created_at,updated_at) VALUES(?,?,?,?,?,'North India',?,?)`,ids.dream,v,ids.dreamPlace,JSON.stringify({start:{precision:'day',value:'2026-09-30'},end:null,certainty:'exact',source:'user'}),'Someday',stamp,stamp);
  await c.runAsync(`INSERT INTO dream_visits(id,vault_id,dream_id,stop_id,linked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,ids.dreamVisit,v,ids.dream,ids.stop,stamp,stamp,stamp);
  await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,kind,payload_json,evidence_json,algorithm_version,state,created_at,updated_at) VALUES(?,?,?,'run','{}','{}',1,'pending',?,?)`,ids.run,v,ids.trip,stamp,stamp);
  await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,run_id,kind,payload_json,evidence_json,algorithm_version,state,resolution_json,created_at,updated_at) VALUES(?,?,?,?,'section','{}','{}',1,'accepted','{}',?,?)`,ids.suggestion,v,ids.trip,ids.run,stamp,stamp);
  await f.trips.trashTrip(ids.trashedTrip);
  return {...ids,hash,relative,bytes};
}
async function exported(t){const f=await fixture(t);const io=new NodeIO();const sourceMedia=new MediaFiles(join(dirname(f.path),'source-vault'));const ids=await seed(f,sourceMedia);const staging=join(dirname(f.path),'stage');const published=join(dirname(f.path),'published');const result=await createPortableExport({database:f.database,vaultId:f.vault.id,io,mediaFiles:sourceMedia,stagingRoot:staging,now:()=>stamp});await publishPortableExport(io,staging,published);return{f,io,sourceMedia,ids,staging,published,result};}
async function rewriteManifest(io,root,mutate){const manifest=JSON.parse(await io.readText(root,'manifest.json'));mutate(manifest);const text=JSON.stringify(manifest,null,2)+'\n';await io.writeText(root,'manifest.json',text);await io.writeText(root,'COMPLETE.json',JSON.stringify({manifest_sha256:await io.sha256Text(text)},null,2)+'\n');}
async function rewriteData(io,root,path,mutate){const value=JSON.parse(await io.readText(root,path));mutate(value);const text=JSON.stringify(value,null,2)+'\n';await io.writeText(root,path,text);await rewriteManifest(io,root,m=>{const file=m.files.find(x=>x.path===path);file.bytes=Buffer.byteLength(text);file.sha256=createHash('sha256').update(text).digest('hex');});}

test('format v1 export is deterministic, structured, complete and excludes device/import state',async t=>{
  const x=await exported(t);const second=join(dirname(x.f.path),'stage-two');const again=await createPortableExport({database:x.f.database,vaultId:x.f.vault.id,io:x.io,mediaFiles:x.sourceMedia,stagingRoot:second,now:()=>stamp});
  assert.equal(await x.io.readText(x.staging,'manifest.json'),await x.io.readText(second,'manifest.json'));
  assert.equal(again.manifest.format_version,1);assert.equal(again.manifest.vault.id,x.f.vault.id);assert.equal(again.manifest.counts.trips,2);assert.equal(again.manifest.counts.reconstruction_history,2);
  const trips=JSON.parse(await x.io.readText(x.staging,'data/trips.json')).records;assert.deepEqual(trips.find(r=>r.id===x.ids.trip).dates,approximate);assert.ok(trips.find(r=>r.id===x.ids.trashedTrip).deleted_at);
  const media=await readFile(join(x.staging,'media','originals',x.ids.hash.slice(0,2),`${x.ids.hash}.original`));assert.deepEqual(media,x.ids.bytes);assert.equal(createHash('sha256').update(media).digest('hex'),x.ids.hash);
  const all=(await Promise.all(again.manifest.files.filter(f=>f.kind==='data').map(f=>x.io.readText(second,f.path)))).join('');assert.doesNotMatch(all,/source_uri|staging_relative_path|cache|content:\/\//);
});

test('round trip into a fresh vault preserves IDs, relationships, uncertainty, tombstones and original bytes',async t=>{
  const x=await exported(t);const fresh=await fixture(t);const destination=new MediaFiles(join(dirname(fresh.path),'restored-vault'));
  const restored=await restorePortableArchive({database:fresh.database,currentVaultId:fresh.vault.id,io:x.io,archiveRoot:x.published,destinationMedia:destination,newStagingId:randomUUID});
  assert.equal(restored.vaultId,x.f.vault.id);assert.equal((await fresh.connection.getFirstAsync('SELECT id FROM vaults')).id,x.f.vault.id);
  const semantic=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key.endsWith('_json')&&value!==null?JSON.parse(value):value])));
  for(const table of ['trips','trip_days','places','stops','media','trip_media','companions','trip_companions','chapters','trip_chapters','dream_destinations','dream_visits','draft_suggestions']){
    assert.deepEqual(semantic(await fresh.connection.getAllAsync(`SELECT * FROM ${table} ORDER BY id`)),semantic(await x.f.connection.getAllAsync(`SELECT * FROM ${table} ${table==='draft_suggestions'?"WHERE state!='pending' OR kind='run'":''} ORDER BY id`)),table);
  }
  assert.deepEqual(JSON.parse((await fresh.connection.getFirstAsync('SELECT dates_json FROM trips WHERE id=?',x.ids.trip)).dates_json),approximate);
  assert.deepEqual(await readFile(destination.uri(x.ids.relative)),x.ids.bytes);assert.deepEqual(await fresh.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
  assert.equal((await fresh.connection.getAllAsync("SELECT variant FROM local_media_files")).length,1);
});

test('missing or altered originals fail closed and never claim a complete export',async t=>{
  const f=await fixture(t);const io=new NodeIO();const media=new MediaFiles(join(dirname(f.path),'source'));const ids=await seed(f,media);await unlink(media.uri(ids.relative));const root=join(dirname(f.path),'failed-stage');
  await assert.rejects(createPortableExport({database:f.database,vaultId:f.vault.id,io,mediaFiles:media,stagingRoot:root}),/missing|SHA-256/);assert.equal(await io.exists(root,'COMPLETE.json'),false);
});

test('restore rejects checksum mismatch, unsupported version, missing files and path traversal before mutation',async t=>{
  const x=await exported(t);
  await writeFile(join(x.published,'data/trips.json'),'corrupt');await assert.rejects(inspectPortableRestore(x.io,x.published),/Checksum mismatch/);
  await cp(x.staging,x.published,{recursive:true,force:true});await rewriteManifest(x.io,x.published,m=>{m.format_version=99;});await assert.rejects(inspectPortableRestore(x.io,x.published),/Unsupported/);
  await rm(x.published,{recursive:true});await cp(x.staging,x.published,{recursive:true});await unlink(join(x.published,'data/stops.json'));await assert.rejects(inspectPortableRestore(x.io,x.published),/missing/);
  await rm(x.published,{recursive:true});await cp(x.staging,x.published,{recursive:true});await rewriteManifest(x.io,x.published,m=>{m.files[0].path='../escape';});await assert.rejects(inspectPortableRestore(x.io,x.published),/unsafe path/);
});

test('duplicate IDs and broken foreign keys are rejected during read-only validation',async t=>{
  const x=await exported(t);const duplicate=join(dirname(x.f.path),'duplicate');await cp(x.staging,duplicate,{recursive:true});
  await rewriteData(x.io,duplicate,'data/stops.json',value=>value.records.push({...value.records[0]}));await rewriteManifest(x.io,duplicate,m=>{m.counts.stops++;});
  await assert.rejects(inspectPortableRestore(x.io,duplicate),/duplicate ID/);
  const broken=join(dirname(x.f.path),'broken');await cp(x.staging,broken,{recursive:true});
  await rewriteData(x.io,broken,'data/stops.json',value=>{value.records[0].place_id=randomUUID();});await assert.rejects(inspectPortableRestore(x.io,broken),/Broken reference/);
});

test('failed/interrupted restore and nonempty-vault rejection leave existing data unchanged',async t=>{
  const x=await exported(t);const fresh=await fixture(t);const destination=new MediaFiles(join(dirname(fresh.path),'interrupt'));destination.failCopy=true;
  await assert.rejects(restorePortableArchive({database:fresh.database,currentVaultId:fresh.vault.id,io:x.io,archiveRoot:x.staging,destinationMedia:destination,newStagingId:randomUUID}),/INTERRUPTED/);
  assert.equal((await fresh.connection.getFirstAsync('SELECT count(*) count FROM trips')).count,0);assert.equal((await fresh.connection.getFirstAsync('SELECT id FROM vaults')).id,fresh.vault.id);
  const existing=await fresh.trips.createTripDraft({title:'Do not overwrite'});destination.failCopy=false;
  await assert.rejects(restorePortableArchive({database:fresh.database,currentVaultId:fresh.vault.id,io:x.io,archiveRoot:x.staging,destinationMedia:destination,newStagingId:randomUUID}),/fresh, empty vault/);
  assert.equal((await fresh.trips.getTripById(existing.id)).title,'Do not overwrite');
});
