import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { integer, parseMedia, parseTripMedia, type MediaEvidence } from '../../domain/media';
import { uuid } from '../../domain/validation';
import { mediaPath, type Derivative, type Variant } from '../../core/media/files';

export type ImportState = 'selected' | 'copying' | 'staged' | 'verified' | 'archived' | 'failed' | 'unsupported' | 'retry_required';
export type Selection = { uri: string; filename: string | null; unsupported?: boolean };
export type ImportItem = { id: string; batch_id: string; trip_id: string; ordinal: number; state: ImportState; source_uri: string | null; staging_relative_path: string; final_relative_path: string | null; evidence_json: string | null; media_id: string | null; error_code: string | null; original_filename: string | null; result: string | null };
export type Photo = { id: string; media_id: string; position: number; is_favourite: number; caption: string | null; thumbnail: string | null; display: string | null; original_state: string; original_filename: string | null };
export type Asset = { id: string; sha256: string; byte_size: number; extension: string; relative_path: string };
const liveTrip = `SELECT t.id FROM trips t JOIN vaults v ON v.id=t.vault_id WHERE t.id=? AND t.vault_id=? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`;
export class MediaRepository {
  private listeners = new Set<() => void>();
  constructor(readonly database: LocalDatabase, readonly vaultId: string, private newId: () => string) { uuid(vaultId, 'vaultId'); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private async changed<T>(operation: Promise<T>) { const value = await operation; for (const fn of this.listeners) { try { fn(); } catch { /* observers cannot undo a commit */ } } return value; }
  private async trip(c: SqlConnection, id: string) { uuid(id, 'tripId'); if (!await c.getFirstAsync(liveTrip, id, this.vaultId)) throw new Error('Trip unavailable'); }
  async select(tripId: string, selections: Selection[]): Promise<string> {
    if (!selections.length || selections.length > 100) throw new Error('Select 1–100 photos per batch');
    const batch = uuid(this.newId(), 'batchId'); const now = new Date().toISOString();
    return this.changed(this.database.transaction(async c => {
      await this.trip(c, tripId);
      await c.runAsync(`INSERT INTO import_batches(id,vault_id,trip_id,state,created_at,updated_at,options_json) VALUES(?,?,?,'pending',?,?,'{}')`, batch,this.vaultId,tripId,now,now);
      for (const [ordinal,s] of selections.entries()) {
        if (typeof s.uri !== 'string' || !/^(file|content):/.test(s.uri)) throw new Error('Invalid selected URI');
        const id = uuid(this.newId(), 'itemId');
        await c.runAsync(`INSERT INTO import_items(id,vault_id,batch_id,ordinal,state,source_uri,original_filename,staging_relative_path,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          id,this.vaultId,batch,ordinal,s.unsupported?'unsupported':'selected',s.unsupported?null:s.uri,s.filename,`staging/${id}.part`,s.unsupported?'UNSUPPORTED_FORMAT':null,now,now);
      }
      return batch;
    }));
  }
  items(tripId?: string): Promise<ImportItem[]> {
    if (tripId) uuid(tripId,'tripId');
    return this.database.run(c => c.getAllAsync<ImportItem>(`SELECT i.*,b.trip_id FROM import_items i JOIN import_batches b ON b.id=i.batch_id JOIN trips t ON t.id=b.trip_id JOIN vaults v ON v.id=t.vault_id WHERE i.vault_id=? AND t.deleted_at IS NULL AND v.deleted_at IS NULL ${tripId?'AND b.trip_id=?':''} ORDER BY b.created_at,b.id,i.ordinal`, this.vaultId,...(tripId?[tripId]:[])));
  }
  state(id: string, state: ImportState, error: string | null = null): Promise<void> {
    uuid(id,'itemId');
    return this.changed(this.database.transaction(async c => {
      const r=await c.runAsync(`UPDATE import_items SET state=?,error_code=?,attempts=attempts+?,updated_at=? WHERE id=? AND vault_id=?`,state,error,state==='copying'?1:0,new Date().toISOString(),id,this.vaultId);
      if(r.changes!==1) throw new Error('Import item unavailable');
    }));
  }
  verified(id: string, input: MediaEvidence): Promise<void> {
    const e=parseMedia(input);
    return this.changed(this.database.transaction(async c => {
      await c.runAsync(`UPDATE import_items SET state='verified',evidence_json=?,final_relative_path=?,error_code=NULL,updated_at=? WHERE id=? AND vault_id=?`,JSON.stringify(e),mediaPath(e.sha256,e.extension),new Date().toISOString(),id,this.vaultId);
    }));
  }
  // Called only after a successful filesystem publish/verification. Rename and SQL are NOT atomic.
  archive(item: ImportItem, input: MediaEvidence): Promise<string> {
    const e=parseMedia(input); const now=new Date().toISOString();
    return this.changed(this.database.transaction(async c => {
      await this.trip(c,item.trip_id);
      const journal=await c.getFirstAsync<ImportItem>('SELECT * FROM import_items WHERE id=? AND vault_id=?',item.id,this.vaultId);
      if(!journal || journal.state!=='verified' || journal.evidence_json!==JSON.stringify(e)) throw new Error('Import journal mismatch');
      let asset=await c.getFirstAsync<{id:string}>('SELECT id FROM media WHERE vault_id=? AND sha256=?',this.vaultId,e.sha256);
      const reused=!!asset;
      if (!asset) {
        asset={id:uuid(this.newId(),'mediaId')};
        await c.runAsync(`INSERT INTO media(id,vault_id,sha256,byte_size,mime_type,extension,width,height,original_filename,source_fidelity,source_metadata_json,parser_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,asset.id,this.vaultId,e.sha256,e.byteSize,e.mimeType,e.extension,e.width,e.height,e.originalFilename,e.sourceFidelity,JSON.stringify(e.sourceMetadata),e.parserVersion,now,now);
      } else await c.runAsync('UPDATE media SET deleted_at=NULL,updated_at=? WHERE id=? AND vault_id=?',now,asset.id,this.vaultId);
      await this.file(c,asset.id,'original',mediaPath(e.sha256,e.extension),'available',{bytes:e.byteSize,checksum:e.sha256,width:e.width,height:e.height});
      const placed=await c.getFirstAsync('SELECT id FROM trip_media WHERE trip_id=? AND media_id=? AND deleted_at IS NULL',item.trip_id,asset.id);
      if(!placed) {
        const last=await c.getFirstAsync<{p:number}>('SELECT coalesce(max(position),-1)+1 AS p FROM trip_media WHERE trip_id=? AND deleted_at IS NULL',item.trip_id);
        const p=parseTripMedia({tripId:item.trip_id,mediaId:asset.id,position:last!.p,caption:null,isFavourite:false,dayId:null,stopId:null});
        await c.runAsync('INSERT INTO trip_media(id,vault_id,trip_id,media_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',uuid(this.newId(),'placementId'),this.vaultId,p.tripId,p.mediaId,p.position,now,now);
      }
      await c.runAsync(`UPDATE import_items SET state='archived',source_uri=NULL,media_id=?,error_code=NULL,result=?,updated_at=? WHERE id=? AND vault_id=?`,asset.id,placed?'already_added':reused?'reused':'added',now,item.id,this.vaultId);
      return asset.id;
    }));
  }
  private async file(c: SqlConnection, id: string, variant: Variant, path: string, state: string, data: {bytes:number;checksum:string|null;width:number|null;height:number|null}) {
    await c.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at,checksum,recipe_version,width,height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(media_id,variant) DO UPDATE SET state=excluded.state,bytes=excluded.bytes,checksum=excluded.checksum,width=excluded.width,height=excluded.height,last_access_at=excluded.last_access_at`,id,this.vaultId,variant,path,state,data.bytes,variant==='original'?1:0,new Date().toISOString(),data.checksum,variant==='original'?null:1,data.width,data.height);
  }
  derivative(id: string, variant: 'display'|'thumbnail', path: string, data: Derivative | null) {
    return this.changed(this.database.transaction(c => this.file(c,id,variant,path,data?'available':'failed',data??{bytes:0,checksum:null,width:null,height:null})));
  }
  assets(needsRepair = false, ids?: string[]): Promise<Asset[]> {
    if(ids){if(!ids.length)return Promise.resolve([]);if(ids.length>60)throw new Error('Asset page too large');ids.forEach(id=>uuid(id,'mediaId'));}
    return this.database.run(c=>c.getAllAsync<Asset>(`SELECT m.id,m.sha256,m.byte_size,m.extension,f.relative_path FROM media m JOIN local_media_files f ON f.media_id=m.id AND f.variant='original' WHERE m.vault_id=?
      ${needsRepair?`AND (f.state!='available' OR (SELECT count(*) FROM local_media_files d WHERE d.media_id=m.id AND d.variant IN ('display','thumbnail') AND d.state='available')<2)`:''}
      ${ids?`AND m.id IN (${ids.map(()=>'?').join(',')})`:''}`,this.vaultId,...(ids??[])));
  }
  async availability(id: string, available: boolean) {
    const changed=await this.database.transaction(async c=>{
      const state=available?'available':'missing';
      const result=await c.runAsync(`UPDATE local_media_files SET state=? WHERE media_id=? AND vault_id=? AND variant='original' AND state!=?`,state,id,this.vaultId,state);
      if(!available) await c.runAsync(`UPDATE import_items SET state='retry_required',error_code='ORIGINAL_MISSING',updated_at=? WHERE media_id=? AND vault_id=? AND state='archived'`,new Date().toISOString(),id,this.vaultId);
      return result.changes>0;
    });
    if(changed) await this.changed(Promise.resolve());
  }
  finishBatches() { return this.changed(this.database.transaction(async c=>{
    await c.runAsync(`UPDATE import_batches SET state=CASE WHEN EXISTS(SELECT 1 FROM import_items i WHERE i.batch_id=import_batches.id AND i.state IN ('selected','copying','staged','verified')) THEN 'pending' WHEN EXISTS(SELECT 1 FROM import_items i WHERE i.batch_id=import_batches.id AND i.state!='archived') THEN 'attention' ELSE 'complete' END,updated_at=? WHERE vault_id=?`,new Date().toISOString(),this.vaultId);
  })); }
  gallery(tripId: string, after?: {position:number;id:string}): Promise<Photo[]> {
    uuid(tripId,'tripId'); if(after) { integer(after.position,'position'); uuid(after.id,'id'); }
    return this.database.run(c=>c.getAllAsync<Photo>(`SELECT p.id,p.media_id,p.position,p.caption,p.is_favourite,m.original_filename,o.state AS original_state,CASE WHEN th.state='available' THEN th.relative_path END AS thumbnail,CASE WHEN d.state='available' THEN d.relative_path END AS display FROM trip_media p JOIN media m ON m.id=p.media_id JOIN trips t ON t.id=p.trip_id JOIN vaults v ON v.id=p.vault_id JOIN local_media_files o ON o.media_id=m.id AND o.variant='original' LEFT JOIN local_media_files th ON th.media_id=m.id AND th.variant='thumbnail' LEFT JOIN local_media_files d ON d.media_id=m.id AND d.variant='display' WHERE p.vault_id=? AND p.trip_id=? AND p.deleted_at IS NULL AND m.deleted_at IS NULL AND t.deleted_at IS NULL AND v.deleted_at IS NULL ${after?'AND (p.position>? OR (p.position=? AND p.id>?))':''} ORDER BY p.position,p.id LIMIT 60`,this.vaultId,tripId,...(after?[after.position,after.position,after.id]:[])));
  }
  remove(tripId: string,id: string) {
    uuid(id,'placementId');
    return this.changed(this.database.transaction(async c=>{
      await this.trip(c,tripId); const now=new Date().toISOString();
      const r=await c.runAsync('UPDATE trip_media SET deleted_at=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NULL',now,now,id,tripId,this.vaultId);
      if(r.changes!==1) throw new Error('Photo unavailable');
    }));
  }
}
