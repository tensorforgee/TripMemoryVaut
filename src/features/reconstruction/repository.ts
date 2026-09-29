import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { text, uuid } from '../../domain/validation';
import { parseTripDayFields } from '../../domain/trip-day';
import { reconstruct, RULES, type PhotoEvidence, type Proposal } from '../../services/reconstruction/rules';
export type Suggestion = {id:string;run_id:string|null;kind:'run'|'section'|'location';state:'pending'|'accepted'|'rejected';payload_json:string;evidence_json:string;resolution_json:string|null;created_at:string};
export type Acceptance = {dayId?:string;placeId?:string;stopId?:string;confirmPlace?:boolean;confirmAppend?:boolean};
export class ReconstructionRepository {
 constructor(readonly database:LocalDatabase,readonly vaultId:string,private newId:()=>string){uuid(vaultId,'vaultId');}
 private async trip(c:SqlConnection,id:string){uuid(id,'tripId');if(!await c.getFirstAsync(`SELECT t.id FROM trips t JOIN vaults v ON v.id=t.vault_id WHERE t.id=? AND t.vault_id=? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`,id,this.vaultId))throw Error('Trip unavailable');}
 list(tripId:string){return this.database.run(async c=>{await this.trip(c,tripId);return c.getAllAsync<Suggestion>('SELECT * FROM draft_suggestions WHERE vault_id=? AND trip_id=? ORDER BY created_at,id',this.vaultId,tripId);});}
 private async photos(c:SqlConnection,tripId:string):Promise<PhotoEvidence[]>{
  const rows=await c.getAllAsync<{id:string;media_id:string;position:number;source_metadata_json:string;parser_version:number;day_id:string|null;stop_id:string|null;original_filename:string|null;thumbnail:string|null;capture_override_json:string|null;location_override_json:string|null}>(`SELECT p.id,p.media_id,p.position,p.day_id,p.stop_id,m.source_metadata_json,m.parser_version,m.original_filename,m.capture_override_json,m.location_override_json,f.relative_path AS thumbnail FROM trip_media p JOIN media m ON m.id=p.media_id LEFT JOIN local_media_files f ON f.media_id=m.id AND f.variant='thumbnail' AND f.state='available' WHERE p.vault_id=? AND p.trip_id=? AND p.deleted_at IS NULL AND m.deleted_at IS NULL ORDER BY p.position,p.id`,this.vaultId,tripId);
  return rows.map(r=>{
   const source=JSON.parse(r.source_metadata_json);const metadata=JSON.parse(r.source_metadata_json);
   for(const [key,raw] of [['capture',r.capture_override_json],['gps',r.location_override_json]] as const)if(raw){const override=JSON.parse(raw);if(override.mode!=='clear'&&override.mode!=='replace')throw Error('Unsupported media correction');metadata[key]=override.mode==='clear'?null:override.value;}
   return {id:r.id,mediaId:r.media_id,position:r.position,metadata,sourceMetadata:source,captureOverride:r.capture_override_json,locationOverride:r.location_override_json,parserVersion:r.parser_version,dayId:r.day_id,stopId:r.stop_id,filename:r.original_filename,thumbnail:r.thumbnail};
  });
 }
 run(tripId:string){return this.database.transaction(async c=>{
  await this.trip(c,tripId);const photos=await this.photos(c,tripId);
  if(!photos.length)throw Error('Add imported photos first');
  const prior=await c.getAllAsync<Suggestion>(`SELECT * FROM draft_suggestions WHERE vault_id=? AND trip_id=? AND kind!='run' AND state!='pending'`,this.vaultId,tripId);
  const excluded={section:new Set<string>(),location:new Set<string>()};
  for(const s of prior)for(const id of (JSON.parse(s.payload_json) as Proposal).members)excluded[s.kind as 'section'|'location'].add(id);
  const input=JSON.stringify({rules:RULES,photos,excluded:{section:[...excluded.section].sort(),location:[...excluded.location].sort()}});
  const same=await c.getFirstAsync<{id:string}>(`SELECT id FROM draft_suggestions WHERE vault_id=? AND trip_id=? AND kind='run' AND evidence_json=?`,this.vaultId,tripId,input);
  if(same)return same.id;
  const result=reconstruct(photos,excluded);const run=uuid(this.newId(),'runId');const now=new Date().toISOString();
  await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,kind,payload_json,evidence_json,algorithm_version,created_at,updated_at) VALUES(?,?,?,'run',?,?,?,?,?)`,run,this.vaultId,tripId,JSON.stringify({unknown:result.unknown,missingGps:result.missingGps,count:photos.length}),input,RULES.version,now,now);
  for(const p of result.proposals)await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,run_id,kind,payload_json,evidence_json,algorithm_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,uuid(this.newId(),'suggestionId'),this.vaultId,tripId,run,p.kind,JSON.stringify(p),JSON.stringify({rules:RULES,photos:photos.filter(x=>p.members.includes(x.id))}),RULES.version,now,now);
  return run;
 });}
 private async read(c:SqlConnection,tripId:string,id:string){await this.trip(c,tripId);uuid(id,'suggestionId');const s=await c.getFirstAsync<Suggestion>(`SELECT * FROM draft_suggestions WHERE id=? AND vault_id=? AND trip_id=? AND kind!='run'`,id,this.vaultId,tripId);if(!s)throw Error('Suggestion unavailable');return s;}
 edit(tripId:string,id:string,label:string,members?:string[]){return this.database.transaction(async c=>{
  const s=await this.read(c,tripId,id);if(s.state!=='pending')throw Error('Suggestion already resolved');const p=JSON.parse(s.payload_json) as Proposal;p.label=text(label,'label');
  if(members){const original=JSON.parse(s.evidence_json).photos as PhotoEvidence[];if(!members.length||new Set(members).size!==members.length||members.some(m=>!original.some(x=>x.id===m)))throw Error('Choose one or more original members');
   if(JSON.stringify(members)!==JSON.stringify(p.members)){
    p.members=members;const times=original.filter(x=>members.includes(x.id)).map(x=>x.metadata.capture?.local).filter((x):x is string=>!!x).sort();
    p.start=times[0]??null;p.end=times.at(-1)??null;p.confidence='tentative';p.reasons=[...p.reasons.filter(r=>r!=='Membership edited by user; review evidence bounds'),'Membership edited by user; review evidence bounds'];
    if(p.kind==='location'){const points=original.filter(x=>members.includes(x.id)).map(x=>x.metadata.gps).filter(x=>x!==null);p.point=points[0]??null;}
   }
  }
  await c.runAsync('UPDATE draft_suggestions SET payload_json=?,updated_at=? WHERE id=?',JSON.stringify(p),new Date().toISOString(),id);
 });}
 reject(tripId:string,id:string){return this.database.transaction(async c=>{const s=await this.read(c,tripId,id);if(s.state==='rejected')return;if(s.state!=='pending')throw Error('Suggestion already accepted');await c.runAsync(`UPDATE draft_suggestions SET state='rejected',updated_at=? WHERE id=?`,new Date().toISOString(),id);});}
 accept(tripId:string,id:string,choice:Acceptance={}){return this.database.transaction(async c=>{
  const s=await this.read(c,tripId,id);if(s.state==='accepted')return JSON.parse(s.resolution_json!);if(s.state!=='pending')throw Error('Suggestion rejected');
  const p=JSON.parse(s.payload_json) as Proposal;const original=JSON.parse(s.evidence_json).photos as PhotoEvidence[];const current=await this.photos(c,tripId);
  const members=p.members.map(id=>{const row=current.find(x=>x.id===id);const old=original.find(x=>x.id===id);if(!row||!old||JSON.stringify(row.metadata)!==JSON.stringify(old.metadata))throw Error('Evidence changed or photo removed; rerun reconstruction');return row;});
  const others=await c.getAllAsync<Suggestion>(`SELECT * FROM draft_suggestions WHERE vault_id=? AND trip_id=? AND kind=? AND state='accepted'`,this.vaultId,tripId,s.kind);
  if(others.some(o=>(JSON.parse(o.payload_json) as Proposal).members.some(m=>p.members.includes(m))))throw Error('These photos already have an accepted suggestion. Use canonical editors.');
  const now=new Date().toISOString();let dayId:string|null=null,placeId:string|null=null,stopId:string|null=null;
  if(s.kind==='section'){
   if(choice.placeId||choice.stopId)throw Error('Choose a section');
   if(choice.dayId){uuid(choice.dayId,'dayId');if(!await c.getFirstAsync('SELECT id FROM trip_days WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NULL',choice.dayId,tripId,this.vaultId))throw Error('Section unavailable');dayId=choice.dayId;}
   else {dayId=uuid(this.newId(),'dayId');const fields=parseTripDayFields({label:p.label,dates:p.start&&p.end?{start:{precision:'day',value:p.start.slice(0,10)},end:{precision:'day',value:p.end.slice(0,10)},certainty:'approximate',source:'photo_suggestion'}:null});
    await c.runAsync(`INSERT INTO trip_days(id,vault_id,trip_id,position,label,dates_json,created_at,updated_at) VALUES(?,?,?,(SELECT coalesce(max(position),-1)+1 FROM trip_days WHERE trip_id=? AND deleted_at IS NULL),?,?,?,?)`,dayId,this.vaultId,tripId,tripId,fields.label,JSON.stringify(fields.dates),now,now);
   }
   for(const m of members){if(m.dayId&&m.dayId!==dayId)throw Error('Photo already belongs to another section; use canonical editors');if(m.stopId){const stop=await c.getFirstAsync<{day_id:string|null}>('SELECT day_id FROM stops WHERE id=?',m.stopId);if(stop?.day_id&&stop.day_id!==dayId)throw Error('Photo stop belongs to another section');}await c.runAsync('UPDATE trip_media SET day_id=?,updated_at=? WHERE id=?',dayId,now,m.id);}
  }else{
   if(choice.dayId)throw Error('Section mapping is separate');
   if(choice.stopId){uuid(choice.stopId,'stopId');const stop=await c.getFirstAsync<{place_id:string;day_id:string|null}>('SELECT place_id,day_id FROM stops WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NULL',choice.stopId,tripId,this.vaultId);if(!stop)throw Error('Stop unavailable');stopId=choice.stopId;placeId=stop.place_id;dayId=stop.day_id;}
   else {
    if(!choice.confirmAppend||!choice.confirmPlace)throw Error('Confirm Place and append Stop explicitly');
    if(choice.placeId){uuid(choice.placeId,'placeId');if(!await c.getFirstAsync('SELECT id FROM places WHERE id=? AND vault_id=? AND deleted_at IS NULL',choice.placeId,this.vaultId))throw Error('Place unavailable');placeId=choice.placeId;}
    else {if(!p.point)throw Error('No coordinate evidence');placeId=uuid(this.newId(),'placeId');await c.runAsync(`INSERT INTO places(id,vault_id,name,latitude,longitude,coordinate_precision,source,provenance_json,created_at,updated_at) VALUES(?,?,?,?,?,'area','exif',?,?,?)`,placeId,this.vaultId,text(p.label,'label'),p.point.latitude,p.point.longitude,JSON.stringify({note:JSON.stringify({suggestionId:id,algorithmVersion:RULES.version,rule:'250m photo cluster; user confirmed'})}),now,now);}
    stopId=uuid(this.newId(),'stopId');const days=new Set(members.map(m=>m.dayId));dayId=days.size===1?members[0].dayId:null;
    await c.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,day_id,position,source,detail_certainty,created_at,updated_at) VALUES(?,?,?,?,?,(SELECT coalesce(max(position),-1)+1 FROM stops WHERE trip_id=? AND deleted_at IS NULL),'photo_suggestion','approximate',?,?)`,stopId,this.vaultId,tripId,placeId,dayId,tripId,now,now);
   }
   for(const m of members){if(m.stopId&&m.stopId!==stopId)throw Error('Photo already belongs to another Stop');if(dayId&&m.dayId&&dayId!==m.dayId)throw Error('Stop and photo sections conflict');await c.runAsync('UPDATE trip_media SET stop_id=?,day_id=?,updated_at=? WHERE id=?',stopId,dayId??m.dayId,now,m.id);}
  }
  const resolution={dayId,placeId,stopId};await c.runAsync(`UPDATE draft_suggestions SET state='accepted',resolution_json=?,updated_at=? WHERE id=?`,JSON.stringify(resolution),now,id);
  await c.runAsync('UPDATE trips SET order_revision=order_revision+1,updated_at=? WHERE id=? AND vault_id=?',now,tripId,this.vaultId);
  return resolution;
 });}
}
