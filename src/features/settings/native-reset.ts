import { Directory, File, Paths } from 'expo-file-system';
import type { VaultDatabase } from '../../core/database/open';
import { openVaultDatabase, resetOpenVaultDatabase } from '../../core/database/open';
import { uuid } from '../../domain/validation';
import { resetMediaService } from '../media/service';
import { runVaultReset } from './reset-coordinator';

const marker=new File(Paths.document,'trip-memory-vault-reset.json');
type Marker={vaultId:string;databaseName:string};
function validate(value:unknown):Marker{
  const row=value as Partial<Marker>;return{vaultId:uuid(row?.vaultId,'reset.vaultId'),databaseName:typeof row?.databaseName==='string'&&/^[a-zA-Z0-9_-]+\.sqlite$/.test(row.databaseName)?row.databaseName:(()=>{throw new Error('Invalid reset database name');})()};
}
function removeVaultDirectory(vaultId:string):void{const directory=new Directory(Paths.document,'vaults',vaultId);if(directory.exists)directory.delete();}
async function write(value:Marker):Promise<void>{marker.write(JSON.stringify(value));}
async function read():Promise<Marker|null>{if(!marker.exists)return null;return validate(JSON.parse(await marker.text()));}
function clear():void{if(marker.exists)marker.delete();}

export async function recoverPendingVaultReset():Promise<boolean>{
  const pending=await read();if(!pending)return false;
  const vault=await openVaultDatabase(pending.databaseName);
  await resetOpenVaultDatabase(vault);removeVaultDirectory(pending.vaultId);resetMediaService();return true;
}
export function completePendingVaultReset():void{clear();}
export async function resetLocalVault(vault:VaultDatabase):Promise<void>{
  const state={vaultId:vault.vault.id,databaseName:vault.databaseName};
  await runVaultReset({writeMarker:()=>write(state),resetDatabase:async()=>{await resetOpenVaultDatabase(vault);resetMediaService();},
    deleteOwnedFiles:async()=>removeVaultDirectory(state.vaultId),clearMarker:async()=>clear()});
}
