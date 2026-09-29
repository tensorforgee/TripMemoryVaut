import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { openVaultDatabase } from '../../src/core/database/open';
import { nativeMediaFiles } from '../../src/core/media/native-adapter';
import { mediaPath } from '../../src/core/media/files';
import { MediaRepository } from '../../src/features/media/repository';
import { ImportPipeline } from '../../src/services/import/pipeline';
import { parseMedia } from '../../src/domain/media';
import manifest from '../fixtures/media/manifest.json';
import { mediaService } from '../../src/features/media/service';

export async function prepareNativeCrashCheckpoint(): Promise<string> {
  const store=await openVaultDatabase();const service=await mediaService();
  const trip=await store.trips.createTripDraft({title:'Step 5 interrupted import'});
  const filename='plain.jpg';
  await service.repository.select(trip.id,[{uri:new File(Paths.document,'step5-corpus',filename).uri,filename}]);
  const item=(await service.repository.items(trip.id))[0];
  await service.repository.state(item.id,'copying');await service.files.copy(item.source_uri!,item.staging_relative_path);
  await service.repository.state(item.id,'staged');
  const evidence=parseMedia({...await service.files.inspect(item.staging_relative_path),originalFilename:filename,sourceFidelity:'picker_representation'});
  await service.repository.verified(item.id,evidence);
  await service.files.publish(item.staging_relative_path,mediaPath(evidence.sha256,evidence.extension),evidence.sha256,evidence.byteSize);
  new File(Paths.document,'step5-checkpoint.json').write(JSON.stringify({tripId:trip.id,itemId:item.id,vaultId:store.vault.id,sha256:evidence.sha256}));
  return 'Checkpoint ready: original published, no Media/TripMedia commit. Force-stop now; normal startup must recover it.';
}

// Development only, isolated DB/vault. Corpus is installed with adb, never personal media.
export async function verifyNativeMedia(): Promise<string[]> {
  const results:string[]=[];
  const check=(label:string,value:unknown)=>{if(!value)throw new Error(label);results.push(label);};
  const name=`step5-${randomUUID()}.sqlite`;
  const store=await openVaultDatabase(name);
  const repo=new MediaRepository(store.database,store.vault.id,randomUUID);
  const files=nativeMediaFiles(store.vault.id); const pipeline=new ImportPipeline(repo,files);
  const source=(filename:string)=>new File(Paths.document,'step5-corpus',filename).uri;
  const trip=await store.trips.createTripDraft({title:'Synthetic native media verification'});
  try {
    await repo.select(trip.id,['plain.jpg','transparent.png','capture-gps.jpg','animated.png','unsupported.gif','truncated.jpg'].map(filename=>({uri:source(filename),filename})));
    await pipeline.run(); const items=await repo.items();
    new File(Paths.document,'step5-native-items.json').write(JSON.stringify(items));
    check('JPEG, transparent PNG and EXIF JPEG archived',items.slice(0,3).every(i=>i.state==='archived'));
    check('Animated PNG and GIF explicitly unsupported',items[3].state==='unsupported'&&items[4].state==='unsupported');
    check('Truncated JPEG failed without Media',items[5].state==='failed');
    for(const a of await repo.assets())check(`Original ${a.sha256.slice(0,8)} bytes hash-match`,await files.verify(a.relative_path,a.sha256,a.byte_size));
    const rows=await store.database.run(c=>c.getAllAsync<{original_filename:string;source_metadata_json:string}>('SELECT original_filename,source_metadata_json FROM media'));
    const evidence=JSON.parse(rows.find(r=>r.original_filename==='capture-gps.jpg')!.source_metadata_json);
    check('Raw capture text preserved',evidence.exif.DateTimeOriginal==='2001:02:03 04:05:06');
    check('Offset capture preserved',evidence.capture.local==='2001-02-03T04:05:06'&&evidence.capture.utc==='2001-02-02T22:35:06Z');
    check('GPS preserved',evidence.gps.latitude===12.5&&evidence.gps.longitude===77.5);
    check('Absent capture and GPS stay null',rows.filter(r=>r.original_filename!=='capture-gps.jpg').every(r=>{const m=JSON.parse(r.source_metadata_json);return m.capture===null&&m.gps===null;}));
    const previews=await store.database.run(c=>c.getAllAsync<{width:number;height:number;variant:string}>("SELECT width,height,variant FROM local_media_files WHERE variant!='original' AND state='available'"));
    check('Six derivatives with bounded dimensions',previews.length===6&&previews.every(p=>Math.max(p.width,p.height)<=(p.variant==='display'?2048:320)));
    const oriented=await store.database.run(c=>c.getFirstAsync<{width:number;height:number}>("SELECT f.width,f.height FROM local_media_files f JOIN media m ON m.id=f.media_id WHERE m.original_filename='capture-gps.jpg' AND f.variant='display'"));
    check('EXIF orientation applied to display',oriented?.width===64&&oriented.height===96);
    await repo.select(trip.id,[{uri:source('plain.jpg'),filename:'duplicate.jpg'}]);await pipeline.run();
    check('Duplicate reuses original and placement',(await repo.assets()).length===3&&(await repo.gallery(trip.id)).length===3&&(await repo.items()).at(-1)?.result==='already_added');
    // Journal/rename crash window: deliberately stop before SQL publication.
    const other=await store.trips.createTripDraft({title:'Interrupted journal fixture'});
    await repo.select(other.id,[{uri:source('plain.jpg'),filename:'plain.jpg'}]);const item=(await repo.items(other.id))[0];
    await repo.state(item.id,'copying');await files.copy(item.source_uri!,item.staging_relative_path);await repo.state(item.id,'staged');
    const e=parseMedia({...await files.inspect(item.staging_relative_path),originalFilename:'plain.jpg',sourceFidelity:'picker_representation'});
    check('Native streaming hash matches deterministic manifest',e.sha256===manifest['plain.jpg'].sha256);
    await repo.verified(item.id,e);await files.publish(item.staging_relative_path,mediaPath(e.sha256,e.extension),e.sha256,e.byteSize);
    await new ImportPipeline(repo,files).run();check('Journal recovery after publish succeeds',(await repo.items(other.id))[0].state==='archived');
    const photos=await repo.gallery(trip.id);await repo.remove(trip.id,photos[0].id);
    check('Placement removal retains shared asset',(await repo.gallery(trip.id)).length===2&&(await repo.assets()).length===3&&(await repo.gallery(other.id)).length===1);
    await store.close();const reopened=await openVaultDatabase(name);
    try{const r=new MediaRepository(reopened.database,reopened.vault.id,randomUUID);check('SQLite/gallery persistence after reopen',(await r.gallery(trip.id)).length===2);}finally{await reopened.close();}
    return results;
  } finally { await store.close().catch(()=>undefined); }
}
