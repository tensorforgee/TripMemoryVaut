import { Directory, File, Paths } from 'expo-file-system';
import { uuid } from '../../domain/validation';
import type { MaintenanceFiles, OwnedFile, OwnedFileKind } from './maintenance';
import { nativeMediaFiles } from '../../core/media/native-adapter';

const derivative=/^media\/(display\/v1|thumbnails\/v1)\/[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|png)$/;
const original=/^media\/originals\/[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|png)$/;
const staging=/^staging\/[a-zA-Z0-9_-]+\.part$/;
function kind(path:string):OwnedFileKind|null{return original.test(path)?'original':derivative.test(path)?'derivative':staging.test(path)?'staging':null;}

export function nativeMaintenanceFiles(vaultId:string):MaintenanceFiles{
  uuid(vaultId,'vaultId');const root=new Directory(Paths.document,'vaults',vaultId);const media=nativeMediaFiles(vaultId);
  const inventory=async():Promise<OwnedFile[]>=>{
    if(!root.exists)return[];const found:OwnedFile[]=[];
    const walk=(directory:Directory,prefix:string)=>{for(const entry of directory.list()){
      const relative=prefix?`${prefix}/${entry.name}`:entry.name;
      if(entry instanceof Directory)walk(entry,relative);else{const fileKind=kind(relative);if(fileKind)found.push({relativePath:relative,bytes:entry.size,modifiedAt:entry.lastModified,kind:fileKind});}
    }};walk(root,'');return found;
  };
  return {inventory,verify:media.verify,
    removeDerivative:async path=>{if(!derivative.test(path))throw new Error('Only regenerable derivatives may be removed');const file=new File(root,...path.split('/'));if(file.exists)file.delete();},
    removeStaging:async path=>{if(!staging.test(path))throw new Error('Only staging files may be removed');const file=new File(root,...path.split('/'));if(file.exists)file.delete();}};
}
