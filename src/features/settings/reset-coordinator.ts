export interface ResetOperations {
  writeMarker():Promise<void>;
  resetDatabase():Promise<void>;
  deleteOwnedFiles():Promise<void>;
  clearMarker():Promise<void>;
}

export const DELETE_CONFIRMATION_PHRASE='DELETE';
export function canConfirmVaultReset(value:string):boolean{return value===DELETE_CONFIRMATION_PHRASE;}

// The marker is written before either persistence boundary changes. It is only
// cleared after a clean vault opens, so process death cannot present a partial reset.
export async function runVaultReset(operations:ResetOperations):Promise<void>{
  await operations.writeMarker();
  await operations.resetDatabase();
  await operations.deleteOwnedFiles();
  await operations.clearMarker();
}
