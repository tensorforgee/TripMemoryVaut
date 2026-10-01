import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { openVaultDatabase } from '../../src/core/database/open';
import { nativeMediaFiles } from '../../src/core/media/native-adapter';
import { MediaRepository } from '../../src/features/media/repository';
import { ImportPipeline } from '../../src/services/import/pipeline';
import { createPortableExport, inspectPortableRestore, publishPortableExport, restorePortableArchive } from '../../src/services/archive/portable';
import { nativeArchiveIO } from '../../src/services/archive/native';

type Checkpoint={databaseName:string;vaultId:string;tripId:string;sharedPlaceId:string;mediaId:string;exportRoot:string;report:string};
const checkpoint=()=>new File(Paths.document,'step12-native-checkpoint.json');
const approx={start:{precision:'year' as const,value:'2009'},end:null,certainty:'approximate' as const,source:'user' as const,label:'College year'};
const unknown={start:{precision:'unknown' as const},end:null,certainty:'unknown' as const,source:'user' as const};
const exact=(value:string)=>({start:{precision:'day' as const,value},end:null,certainty:'exact' as const,source:'user' as const});
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),value=>value.charCodeAt(0));
function check(condition:unknown,message:string): asserts condition {if(!condition)throw new Error(message);}

export async function runNativeArchiveRoundTrip():Promise<string>{
  const run=randomUUID();const sourceName=`step12-source-${run}.sqlite`;const destinationName=`step12-destination-${run}.sqlite`;
  const source=await openVaultDatabase(sourceName);const trip=await source.trips.createTripDraft({title:'Step 12 College trip',dates:approx});await source.trips.updateBasicTripFields(trip.id,{status:'saved'});
  const second=await source.trips.createTripDraft({title:'Step 12 return',dates:unknown});await source.trips.updateBasicTripFields(second.id,{status:'saved'});
  const trash=await source.trips.createTripDraft({title:'Step 12 trash',dates:unknown});await source.trips.updateBasicTripFields(trash.id,{status:'saved'});
  const section=await source.timeline.createTripDay(trip.id,{label:'Arrival',dates:approx});
  const shared=await source.routes.createPlace({name:'Step 12 Shimla',latitude:31.1048,longitude:77.1734,coordinatePrecision:'point'});
  const unmapped=await source.routes.createPlace({name:'Step 12 unknown village'});
  const first=await source.routes.addStop(trip.id,{placeId:shared.id,kind:'stay',dates:approx,note:'First visit'});await source.timeline.assignStop(trip.id,first.id,section.id);
  await source.routes.addStop(trip.id,{placeId:shared.id});await source.routes.addStop(trip.id,{placeId:unmapped.id});const linked=await source.routes.addStop(second.id,{placeId:shared.id,dates:exact('2026-09-30')});
  await source.routes.addStop(trash.id,{placeId:shared.id});
  const person=await source.companions.create({displayName:'Step 12 Aman',note:'College friend'});await source.companions.attachToTrip(trip.id,person.id);
  const chapter=await source.chapters.create({title:'Step 12 College Years',description:'Studies'});await source.chapters.attachTrip(trip.id,chapter.id);
  await source.dreams.create({title:'Step 12 unvisited dream',latitude:40,longitude:80,note:'Someday'});
  const visited=await source.dreams.create({title:'Step 12 visited dream',locationText:'North India'});await source.dreams.linkVisit(visited.id,linked.id);
  const runId=randomUUID(),suggestionId=randomUUID(),stamp='2026-09-30T08:30:00.000Z';
  await source.database.transaction(async c=>{await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,kind,payload_json,evidence_json,algorithm_version,state,created_at,updated_at) VALUES(?,?,?,'run','{}','{}',1,'pending',?,?)`,runId,source.vault.id,trip.id,stamp,stamp);await c.runAsync(`INSERT INTO draft_suggestions(id,vault_id,trip_id,run_id,kind,payload_json,evidence_json,algorithm_version,state,resolution_json,created_at,updated_at) VALUES(?,?,?,?,'section','{}','{}',1,'accepted','{}',?,?)`,suggestionId,source.vault.id,trip.id,runId,stamp,stamp);});
  const photo=new File(Paths.cache,`step12-${run}.png`);photo.write(png);
  const mediaRepository=new MediaRepository(source.database,source.vault.id,randomUUID);const sourceFiles=nativeMediaFiles(source.vault.id);const pipeline=new ImportPipeline(mediaRepository,sourceFiles);
  await mediaRepository.select(trip.id,[{uri:photo.uri,filename:'step12-original.png'}]);await pipeline.run();const asset=(await mediaRepository.assets())[0];check(asset,'Native media import failed');
  await source.trips.trashTrip(trash.id);
  const io=nativeArchiveIO();const base=new Directory(Paths.document,'step12-runtime',run);base.create({intermediates:true});const stage=new Directory(base,'stage').uri;const exportRoot=new Directory(base,'export').uri;
  const exported=await createPortableExport({database:source.database,vaultId:source.vault.id,io,mediaFiles:sourceFiles,stagingRoot:stage,now:()=>stamp});await io.createRoot(exportRoot);await publishPortableExport(io,stage,exportRoot);
  const inspected=await inspectPortableRestore(io,exportRoot);check(inspected.manifest.media_count===1&&inspected.manifest.counts.trips===3,'Export manifest counts failed');
  const sourceVaultId=source.vault.id;await source.close();const sourceRoot=new Directory(Paths.document,'vaults',sourceVaultId);check(sourceRoot.exists,'Source originals were not written');sourceRoot.delete();
  const destination=await openVaultDatabase(destinationName);await restorePortableArchive({database:destination.database,currentVaultId:destination.vault.id,io,archiveRoot:exportRoot,destinationMedia:nativeMediaFiles(sourceVaultId),newStagingId:randomUUID});await destination.close();
  const restored=await openVaultDatabase(destinationName);check(restored.vault.id===sourceVaultId,'Vault ID was not preserved');
  const restoredMedia=new MediaRepository(restored.database,restored.vault.id,randomUUID);const restoredPipeline=new ImportPipeline(restoredMedia,nativeMediaFiles(restored.vault.id));await restoredPipeline.run(true);const gallery=await restoredPipeline.gallery(trip.id);
  const map=await restored.map.archive();const mapped=map.places.find(place=>place.id===shared.id);const life=await restored.life.overview();const dreams=await restored.dreams.listActive();
  check(mapped?.visitCount===3&&mapped.tripCount===2&&mapped.visits.length===3,'My Map semantics changed after restore');check(map.unmappedPlaceCount===1,'Unmapped Place was not restored');
  check(life.metrics.trips===2&&life.metrics.places===2&&life.metrics.visits===4&&life.metrics.photos===1&&life.metrics.companions===1&&life.metrics.chapters===1,'Travel Life totals changed after restore');
  check(gallery.length===1&&gallery[0].media_id===asset.id&&gallery[0].original_state==='available'&&gallery[0].thumbnail!==null,'Gallery/original/derivative restore failed');
  check(dreams.length===2&&dreams.some(dream=>dream.status==='dreaming')&&dreams.some(dream=>dream.status==='visited'),'Dream states were not restored');
  check((await restored.trips.listDeletedTrips()).some(value=>value.id===trash.id),'Trip trash state was not restored');
  check((await restored.timeline.listTripDays(trip.id))[0]?.id===section.id,'Timeline section ID was not preserved');
  check((await restored.companions.listForTrip(trip.id))[0]?.id===person.id,'Companion relationship was not restored');check((await restored.chapters.listForTrip(trip.id))[0]?.id===chapter.id,'Chapter relationship was not restored');
  check((await restored.trips.getTripById(trip.id))?.dates.certainty==='approximate'&&(await restored.trips.getTripById(second.id))?.dates.certainty==='unknown','Date uncertainty changed');
  check((await restored.database.run(c=>c.getAllAsync('PRAGMA foreign_key_check'))).length===0,'Foreign-key audit failed');
  const originalEntry=inspected.manifest.files.find(file=>file.kind==='media-original');check(originalEntry,'Exported original was not listed in the manifest');
  const before=(await restored.trips.listTrips({limit:100})).length;const corrupt=new Directory(base,'corrupt').uri;await io.createRoot(corrupt);await io.copyTree(exportRoot,corrupt);new File(io.fileUri(corrupt,originalEntry.path)).write('tampered');
  let rejected=false;try{await inspectPortableRestore(io,corrupt);}catch{rejected=true;}check(rejected,'Tampered archive was accepted');check((await restored.trips.listTrips({limit:100})).length===before,'Corrupt inspection changed the restored vault');
  const report=`PASS: format v${exported.manifest.format_version}; 3 Trips, ${exported.manifest.counts.places} Places, 1 original (${asset.sha256.slice(0,12)}…); IDs, timeline, map, gallery, Companions, Chapters, Dreams, Travel Life, uncertainty and trash preserved; altered checksum rejected without mutation.`;
  checkpoint().write(JSON.stringify({databaseName:destinationName,vaultId:sourceVaultId,tripId:trip.id,sharedPlaceId:shared.id,mediaId:asset.id,exportRoot,report} satisfies Checkpoint));await restored.close();if(photo.exists)photo.delete();return report;
}

export async function auditNativeArchiveAfterRelaunch():Promise<string>{
  check(checkpoint().exists,'Run the Step 12 round trip first');const saved=JSON.parse(await checkpoint().text()) as Checkpoint;const restored=await openVaultDatabase(saved.databaseName);
  check(restored.vault.id===saved.vaultId,'Relaunch vault ID mismatch');check((await restored.trips.getTripById(saved.tripId))!==null,'Representative Trip missing after relaunch');
  const map=await restored.map.archive();check(map.places.find(place=>place.id===saved.sharedPlaceId)?.visitCount===3,'Map archive failed after relaunch');
  const media=new MediaRepository(restored.database,restored.vault.id,randomUUID);const asset=(await media.assets(false,[saved.mediaId]))[0];check(asset&&await nativeMediaFiles(restored.vault.id).verify(asset.relative_path,asset.sha256,asset.byte_size),'Original failed offline relaunch verification');
  return `PASS after force-stop/relaunch, offline: ${saved.report}`;
}
