import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { fixture } from '../step1/sqlite-harness.mjs';
import { VaultMaintenance, STALE_STAGING_MS } from '../../.expo/step1-tests/features/settings/maintenance.js';
import { privacyCapabilities, settingsVersions } from '../../.expo/step1-tests/features/settings/capabilities.js';
import { canConfirmVaultReset, runVaultReset } from '../../.expo/step1-tests/features/settings/reset-coordinator.js';
import { resetVaultContents } from '../../.expo/step1-tests/features/settings/reset-database.js';
import { migrations } from '../../.expo/step1-tests/core/database/migrate.js';
import { PORTABLE_FORMAT_VERSION } from '../../.expo/step1-tests/services/archive/portable.js';

const stamp='2026-10-02T08:00:00.000Z';
const old=Date.parse(stamp)-STALE_STAGING_MS-1;
const dates=JSON.stringify({start:{precision:'unknown'},end:null,certainty:'unknown',source:'user'});
const hash=value=>createHash('sha256').update(value).digest('hex');
const sha=value=>Promise.resolve(hash(value));

class Files{
  constructor(){this.values=new Map();this.removed=[];}
  add(relativePath,contents,kind,modifiedAt=Date.parse(stamp)){this.values.set(relativePath,{contents:Buffer.from(contents),kind,modifiedAt});}
  async inventory(){return [...this.values].map(([relativePath,value])=>({relativePath,bytes:value.contents.length,modifiedAt:value.modifiedAt,kind:value.kind}));}
  async verify(path,expected,bytes){const value=this.values.get(path)?.contents;return !!value&&value.length===bytes&&hash(value)===expected;}
  async removeDerivative(path){assert.equal(this.values.get(path)?.kind,'derivative');this.removed.push(path);this.values.delete(path);}
  async removeStaging(path){assert.equal(this.values.get(path)?.kind,'staging');this.removed.push(path);this.values.delete(path);}
}

async function seed(f,files){
  const trip=randomUUID();await f.connection.runAsync(`INSERT INTO trips(id,vault_id,title,status,dates_json,sort_precision,created_at,updated_at)
    VALUES(?,?,'Settings fixture','saved',?,'unknown',?,?)`,trip,f.vault.id,dates,stamp,stamp);
  const original=Buffer.from('authoritative-original');const digest=hash(original);const media=randomUUID();
  await f.connection.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,source_fidelity,source_metadata_json,parser_version,created_at,updated_at)
    VALUES(?,?,?,?,'image/jpeg','jpg',1,1,'original_confirmed','{}',1,?,?)`,media,f.vault.id,digest,original.length,stamp,stamp);
  const path=`media/originals/${digest.slice(0,2)}/${digest}.jpg`;files.add(path,original,'original');
  await f.connection.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at,checksum)
    VALUES(?,?,'original',?,'available',?,1,?,?)`,media,f.vault.id,path,original.length,stamp,digest);
  return{trip,media,path,digest,original};
}
function service(f,files,regenerate=async()=>({generated:0,failed:0,missingOriginals:0})){
  return new VaultMaintenance(f.database,f.vault.id,files,sha,regenerate,()=>new Date(stamp));
}

test('storage summary counts only app-owned originals, derivatives and staging',async t=>{
  const f=await fixture(t);const files=new Files();await seed(f,files);
  files.add(`media/display/v1/${'a'.repeat(2)}/${'a'.repeat(64)}.jpg`,'preview','derivative');
  files.add(`staging/${randomUUID()}.part`,'part','staging');
  const externalPhotoLibraryBytes=9_000_000;void externalPhotoLibraryBytes;
  const value=await service(f,files).storageSummary();
  assert.equal(value.trips,1);assert.equal(value.photos,1);assert.equal(value.originalBytes,22);
  assert.equal(value.derivativeBytes,7);assert.equal(value.stagingBytes,4);assert.equal(value.externalFilesIncluded,false);assert.ok(value.databaseBytes>0);
});

test('orphan and stale cleanup never delete originals or active staging',async t=>{
  const f=await fixture(t);const files=new Files();const seeded=await seed(f,files);
  const expected=`media/display/v1/${seeded.digest.slice(0,2)}/${seeded.digest}.jpg`;
  const orphan=`media/thumbnails/v1/${'b'.repeat(2)}/${'b'.repeat(64)}.jpg`;
  files.add(expected,'preview','derivative');files.add(orphan,'orphan','derivative');
  await f.connection.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at,checksum,recipe_version,width,height)
    VALUES(?,?,'display',?,'available',7,0,?,NULL,1,1,1)`,seeded.media,f.vault.id,expected,stamp);
  const batch=randomUUID(),item=randomUUID(),active=`staging/${item}.part`,orphanStage=`staging/${randomUUID()}.part`;
  await f.connection.runAsync(`INSERT INTO import_batches(id,vault_id,trip_id,state,created_at,updated_at,options_json) VALUES(?,?,?,'pending',?,?,'{}')`,batch,f.vault.id,seeded.trip,stamp,stamp);
  await f.connection.runAsync(`INSERT INTO import_items(id,vault_id,batch_id,ordinal,state,source_uri,staging_relative_path,created_at,updated_at) VALUES(?,?,?,0,'selected','file://source',?,?,?)`,item,f.vault.id,batch,active,stamp,stamp);
  files.add(active,'active','staging',old);files.add(orphanStage,'stale','staging',old);
  await service(f,files).removeOrphanedDerivatives();await service(f,files).cleanStaleStaging();
  assert.ok(files.values.has(seeded.path));assert.ok(files.values.has(expected));assert.ok(files.values.has(active));
  assert.ok(!files.values.has(orphan));assert.ok(!files.values.has(orphanStage));
  assert.equal(await files.verify(seeded.path,seeded.digest,seeded.original.length),true);
});

test('derivative regeneration and search rebuild preserve canonical data and originals',async t=>{
  const f=await fixture(t);const files=new Files();const seeded=await seed(f,files);
  const canonical=await f.connection.getAllAsync('SELECT * FROM trips');const before=Buffer.from(files.values.get(seeded.path).contents);
  await f.connection.runAsync('DELETE FROM search_documents WHERE vault_id=?',f.vault.id);
  const result=await service(f,files,async()=>{files.add(`media/thumbnails/v1/${seeded.digest.slice(0,2)}/${seeded.digest}.jpg`,'thumb','derivative');return{generated:1,failed:0,missingOriginals:0};}).regenerateDerivatives();
  assert.equal(result.affected,1);assert.deepEqual(files.values.get(seeded.path).contents,before);
  const rebuilt=await service(f,files).rebuildSearch();assert.equal(rebuilt.affected,1);assert.deepEqual(await f.connection.getAllAsync('SELECT * FROM trips'),canonical);
});

test('healthy audit passes and is non-destructive',async t=>{
  const f=await fixture(t);const files=new Files();await seed(f,files);
  const before=JSON.stringify(await f.connection.getAllAsync(`SELECT name,type,sql FROM sqlite_schema ORDER BY name`));
  const report=await service(f,files).checkIntegrity();
  assert.equal(report.status,'healthy');assert.equal(report.originalsVerified,1);assert.ok(report.lines.every(line=>line.status==='pass'));
  assert.equal(JSON.stringify(await f.connection.getAllAsync(`SELECT name,type,sql FROM sqlite_schema ORDER BY name`)),before);
});

test('audit detects missing originals, hash mismatch, broken FK, interrupted imports and stale search without mutation',async t=>{
  const f=await fixture(t);const files=new Files();const seeded=await seed(f,files);
  files.values.delete(seeded.path);let report=await service(f,files).checkIntegrity();assert.match(report.lines.find(x=>x.key==='originals').detail,/1 missing/);
  files.add(seeded.path,Buffer.alloc(seeded.original.length,1),'original');report=await service(f,files).checkIntegrity();assert.match(report.lines.find(x=>x.key==='originals').detail,/1 size\/hash mismatches/);
  const doomedTrip=randomUUID();await f.connection.runAsync(`INSERT INTO trips(id,vault_id,title,status,dates_json,sort_precision,created_at,updated_at) VALUES(?,?,'Broken parent','saved',?,'unknown',?,?)`,doomedTrip,f.vault.id,dates,stamp,stamp);
  await f.connection.runAsync(`INSERT INTO trip_days(id,vault_id,trip_id,position,created_at,updated_at) VALUES(?,?,?,0,?,?)`,randomUUID(),f.vault.id,doomedTrip,stamp,stamp);
  await f.connection.execAsync('PRAGMA foreign_keys=OFF');await f.connection.runAsync('DELETE FROM trips WHERE id=?',doomedTrip);await f.connection.execAsync('PRAGMA foreign_keys=ON');
  const batch=randomUUID();await f.connection.runAsync(`INSERT INTO import_batches(id,vault_id,trip_id,state,created_at,updated_at,options_json) VALUES(?,?,?,'pending',?,?,'{}')`,batch,f.vault.id,seeded.trip,stamp,stamp);
  await f.connection.runAsync(`INSERT INTO import_items(id,vault_id,batch_id,ordinal,state,source_uri,staging_relative_path,created_at,updated_at) VALUES(?,?,?,0,'selected','file://source',?,?,?)`,randomUUID(),f.vault.id,batch,`staging/${randomUUID()}.part`,stamp,stamp);
  await f.connection.runAsync('DELETE FROM search_documents WHERE vault_id=?',f.vault.id);
  const tripCount=(await f.connection.getFirstAsync('SELECT count(*) count FROM trips')).count;report=await service(f,files).checkIntegrity();
  assert.equal(report.lines.find(x=>x.key==='database').status,'issue');assert.equal(report.lines.find(x=>x.key==='imports').status,'issue');assert.equal(report.lines.find(x=>x.key==='search').status,'issue');
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) count FROM trips')).count,tripCount);
});

test('settings versions and privacy statements reflect implemented architecture',()=>{
  assert.equal(settingsVersions.schemaVersion,migrations.length);assert.equal(settingsVersions.exportFormatVersion,PORTABLE_FORMAT_VERSION);
  assert.match(privacyCapabilities.cloud,/No cloud backup or sync/);assert.match(privacyCapabilities.photos,/system photo picker/);
  assert.match(privacyCapabilities.location,/No current or background location/);assert.match(privacyCapabilities.contacts,/not requested/);assert.match(privacyCapabilities.search,/locally/);
});

test('reset requires exact confirmation and interrupted reset retains recovery marker',async()=>{
  assert.equal(canConfirmVaultReset('DELETE'),true);for(const value of ['','delete','DELETE '])assert.equal(canConfirmVaultReset(value),false);
  const state={marker:false,database:true,originals:true,derivatives:true,staging:true,canonical:true,initialized:false};
  const calls=[];await runVaultReset({writeMarker:async()=>{calls.push('marker');state.marker=true;},
    resetDatabase:async()=>{calls.push('database');state.canonical=false;state.initialized=true;},deleteOwnedFiles:async()=>{calls.push('files');state.originals=false;state.derivatives=false;state.staging=false;},
    clearMarker:async()=>{calls.push('clear');state.marker=false;}});
  assert.deepEqual(calls,['marker','database','files','clear']);assert.deepEqual(state,{marker:false,database:true,originals:false,derivatives:false,staging:false,canonical:false,initialized:true});
  let marker=false;await assert.rejects(runVaultReset({writeMarker:async()=>{marker=true;},resetDatabase:async()=>{},deleteOwnedFiles:async()=>{throw Error('injected');},clearMarker:async()=>{marker=false;}}),/injected/);assert.equal(marker,true);
});

test('reset removes canonical and derived rows and leaves an initializable empty vault',async t=>{
  const f=await fixture(t);const files=new Files();const seeded=await seed(f,files);
  const run=randomUUID(),suggestion=randomUUID();
  await f.connection.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,run_id,kind,payload_json,evidence_json,algorithm_version,created_at,updated_at)
    VALUES(?,?,?,NULL,'run','{}','{}',1,?,?)`,run,f.vault.id,seeded.trip,stamp,stamp);
  await f.connection.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,run_id,kind,payload_json,evidence_json,algorithm_version,created_at,updated_at)
    VALUES(?,?,?,?, 'section','{}','{}',1,?,?)`,suggestion,f.vault.id,seeded.trip,run,stamp,stamp);
  const oldVaultId=f.vault.id;const freshId=randomUUID();
  const vault=await resetVaultContents(f.database,()=>freshId);
  assert.equal(vault.id,freshId);assert.notEqual(vault.id,oldVaultId);
  for(const table of ['trips','places','media','local_media_files','import_batches','search_documents']){
    assert.equal((await f.connection.getFirstAsync(`SELECT count(*) count FROM ${table}`)).count,0,table);
  }
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) count FROM vaults')).count,1);
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) count FROM search_index_state')).count,1);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version,migrations.length);
});
