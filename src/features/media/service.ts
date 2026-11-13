import { randomUUID } from 'expo-crypto';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { File } from 'expo-file-system';
import { openVaultDatabase } from '../../core/database/open';
import { nativeMediaFiles, selectedFileName } from '../../core/media/native-adapter';
import { ImportPipeline } from '../../services/import/pipeline';
import { MediaRepository } from './repository';

let service: Promise<ImportPipeline> | undefined;
export function mediaService(): Promise<ImportPipeline> {
  return service ??= openVaultDatabase().then(v=>new ImportPipeline(new MediaRepository(v.database,v.vault.id,randomUUID),nativeMediaFiles(v.vault.id)));
}
export function resetMediaService(): void { service=undefined; }
export async function selectPhotos(tripId: string, fromFiles = false) {
  if (fromFiles) {
    // OPEN_DOCUMENT avoids Android redirecting GET_CONTENT into the photo picker.
    const picked=await File.pickFileAsync({multipleFiles:true,mimeTypes:['image/*']});
    if(picked.canceled) return;
    if(picked.result.length>100) throw new Error('Select up to 100 photos at a time.');
    const service=await mediaService();
    const selection=await Promise.all(picked.result.map(async file=>({uri:file.uri,filename:await selectedFileName(file.uri)})));
    await service.repository.select(tripId,selection);
    await service.run();
    return;
  }
  // quality=1 uses Android's RawImageExporter (byte copy); exif/base64 disabled.
  const result=await launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:100,allowsEditing:false,quality:1,exif:false,base64:false});
  if(result.canceled) return;
  const service=await mediaService();
  await service.repository.select(tripId,result.assets.map(a=>({uri:a.uri,filename:a.fileName??null,unsupported:a.type==='video'||a.type==='pairedVideo'||a.type==='livePhoto'})));
  await service.run();
}
