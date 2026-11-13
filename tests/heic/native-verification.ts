import { randomUUID } from 'expo-crypto';
import { requireNativeModule } from 'expo';
import { Directory,File,Paths } from 'expo-file-system';
import { openVaultDatabase } from '../../src/core/database/open';
import { nativeMediaFiles, selectedFileName } from '../../src/core/media/native-adapter';
import { MediaRepository } from '../../src/features/media/repository';
import { ImportPipeline } from '../../src/services/import/pipeline';
import { ReconstructionRepository } from '../../src/features/reconstruction/repository';
import { createPortableExport,inspectPortableRestore,restorePortableArchive } from '../../src/services/archive/portable';
import { nativeArchiveIO } from '../../src/services/archive/native';
const expected='1ddce96766efbfa0f6bdf634bdab26bdeff831393df8d67f4cdc7b7a7afebc67';
const checks:string[]=[];
function check(value:unknown,label:string):asserts value {
  checks.push(`${value?'PASS':'FAIL'}: ${label}`);
  new File(Paths.document,'heic-verification.txt').write(checks.join('\n'));
  if(!value)throw Error(label);console.log('HEIC_AUDIT PASS',label);
}
// Only unique disposable databases. Never opens or restores the user's vault.sqlite.
export async function verifyHeic(selectedUri?:string):Promise<string[]> {
  const run=randomUUID();const source=await openVaultDatabase(`heic-source-${run}.sqlite`);
  const trip=await source.trips.createTripDraft({title:'Disposable HEIC test'});
  const files=nativeMediaFiles(source.vault.id),repo=new MediaRepository(source.database,source.vault.id,randomUUID),pipeline=new ImportPipeline(repo,files);
  const fixture=new File(Paths.document,'heic-corpus','example.heic');
  const filename=selectedUri?await selectedFileName(selectedUri):'example.heic';
  await repo.select(trip.id,[{uri:selectedUri??fixture.uri,filename},{uri:selectedUri??fixture.uri,filename:'same.HEIF'}]);
  await pipeline.run();const items=await repo.items();console.log('HEIC_AUDIT ITEMS',JSON.stringify(items.map(x=>({state:x.state,error:x.error_code}))));
  check(items.every(x=>x.state==='archived'),'HEIC and HEIF filename import');
  const assets=await repo.assets();check(assets.length===1&&items[1].result==='already_added','SHA-256 deduplication');const asset=assets[0];
  const receivedHash=asset.sha256;
  const native=requireNativeModule<{verifyExternal(uri:string,hash:string,bytes:number):Promise<boolean>}>('ArchiveMedia');
  check(['heic','heif'].includes(asset.extension),'picker retains HEIC format');
  check((selectedUri?await native.verifyExternal(selectedUri,receivedHash,asset.byte_size):receivedHash===expected)&&await files.verify(asset.relative_path,receivedHash,asset.byte_size),'received source/original checksum equality');
  checks.push(`Source ${selectedUri?'picker':'fixture'}: ${receivedHash===expected?'byte-identical fixture':'provider representation'} ${receivedHash}`);
  const evidence=await source.database.run(c=>c.getFirstAsync<{source_metadata_json:string}>('SELECT source_metadata_json FROM media WHERE id=?',asset.id));
  console.log('HEIC_AUDIT METADATA',evidence?.source_metadata_json);
  const meta=JSON.parse(evidence!.source_metadata_json);
  check(meta.exif.Model==='iPhone 13 Pro'&&meta.exif.DateTimeOriginal==='2023:02:21 14:33:08'&&meta.capture?.utc==='2023-02-21T11:33:08Z','iPhone HEIC EXIF date and offset');
  check((receivedHash===expected?meta.gps!==null:meta.gps===null)&&meta.exif.Orientation==='1','HEIC GPS availability and orientation (provider redaction stays unknown)');
  const gallery=await pipeline.gallery(trip.id);check(gallery[0].thumbnail?.endsWith('.jpg')&&gallery[0].display?.endsWith('.jpg'),'JPEG thumbnail and full preview');
  const before=await source.database.run(c=>c.getAllAsync('SELECT * FROM local_media_files ORDER BY variant'));await pipeline.run();
  check(JSON.stringify(before)===JSON.stringify(await source.database.run(c=>c.getAllAsync('SELECT * FROM local_media_files ORDER BY variant'))),'no duplicate previews');
  await source.photoMemories.save(trip.id,{mediaId:asset.id,coordinate:[0,0],note:'Manual pin'});
  await source.memories.save(trip.id,{title:'Test memory',body:'Disposable',dates:null,dayId:null,stopId:null,mediaIds:[asset.id]});
  check((await source.photoMemories.list(trip.id))[0].display===gallery[0].display,'Map Memory Pins share preview');
  check((await source.memories.list(trip.id))[0].mediaIds[0]===asset.id,'Travel Memories share asset');
  await new ReconstructionRepository(source.database,source.vault.id,randomUUID).run(trip.id);
  check((await source.database.run(c=>c.getFirstAsync<{n:number}>('SELECT count(*) n FROM stops')))?.n===0,'reconstruction creates no confirmed history');
  // Truncated BMFF and a non-image are isolated failed items, never archived.
  const corrupt=new File(Paths.cache,`corrupt-${run}.heic`);corrupt.write(new Uint8Array([0,0,0,32,102,116,121,112,104,101,105,99]));
  await repo.select(trip.id,[{uri:corrupt.uri,filename:'corrupt.heic'}]);await pipeline.run();check((await repo.items()).at(-1)?.state==='failed','malformed HEIC rejected');
  const io=nativeArchiveIO(),root=new Directory(Paths.document,`heic-export-${run}`).uri;
  const exported=await createPortableExport({database:source.database,vaultId:source.vault.id,io,mediaFiles:files,stagingRoot:root});
  check(exported.manifest.format_version===4,'archive remains v4');await inspectPortableRestore(io,root);
  // Move only this synthetic vault directory so restore must copy from the archive.
  const syntheticRoot=new Directory(Paths.document,'vaults',source.vault.id);const retained=new Directory(Paths.document,`heic-retained-${run}`);syntheticRoot.move(retained);
  await source.close();
  const dest=await openVaultDatabase(`heic-restored-${run}.sqlite`);
  await restorePortableArchive({database:dest.database,currentVaultId:dest.vault.id,io,archiveRoot:root,destinationMedia:files,newStagingId:randomUUID});await dest.close();
  const restored=await openVaultDatabase(`heic-restored-${run}.sqlite`);const rr=new MediaRepository(restored.database,restored.vault.id,randomUUID);await new ImportPipeline(rr,files).run(true);
  check(await files.verify(asset.relative_path,receivedHash,asset.byte_size),'restored original checksum equality');
  check((await restored.memories.list(trip.id))[0].mediaIds[0]===asset.id&&(await restored.photoMemories.list(trip.id)).length===1,'restored attachments and pins');
  check((await restored.database.run(c=>c.getAllAsync('PRAGMA foreign_key_check'))).length===0,'restored foreign keys');
  const photos=await rr.gallery(trip.id);await restored.close();
  console.log('HEIC_AUDIT COMPLETE',run);return [files.uri(photos[0].thumbnail!),files.uri(photos[0].display!)];
}
