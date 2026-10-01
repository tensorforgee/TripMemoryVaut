import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { migrations } from '../../core/database/migrate';
import { mediaPath } from '../../core/media/files';
import { SEARCH_INDEX_VERSION, rebuildSearchIndex, searchDocumentSelect } from '../search/schema';

export const STALE_STAGING_MS=24*60*60*1000;
export type OwnedFileKind='original'|'derivative'|'staging';
export type OwnedFile={relativePath:string;bytes:number;modifiedAt:number|null;kind:OwnedFileKind};
export interface MaintenanceFiles {
  inventory():Promise<OwnedFile[]>;
  verify(path:string,hash:string,bytes:number):Promise<boolean>;
  removeDerivative(path:string):Promise<void>;
  removeStaging(path:string):Promise<void>;
}
export type StorageSummary={
  trips:number;photos:number;originalBytes:number;derivativeBytes:number;databaseBytes:number;stagingBytes:number;
  databaseBytesEstimated:true;externalFilesIncluded:false;
};
export type MaintenanceResult={completed:true;detail:string;affected:number;issues:number};
export type IntegrityLine={key:string;label:string;status:'pass'|'issue';detail:string};
export type IntegrityReport={status:'healthy'|'issues';checkedAt:string;issues:number;originalsVerified:number;documentCount:number;lines:IntegrityLine[]};
type OriginalRow={id:string;sha256:string;byte_size:number;extension:string;relative_path:string|null;state:string|null};

function number(value:unknown):number{return Number(value??0);}
async function databaseSize(connection:SqlConnection):Promise<number>{
  const pageSize=await connection.getFirstAsync<{page_size:number}>('PRAGMA page_size');
  const pageCount=await connection.getFirstAsync<{page_count:number}>('PRAGMA page_count');
  return number(pageSize?.page_size)*number(pageCount?.page_count);
}
async function originals(connection:SqlConnection,vaultId:string):Promise<OriginalRow[]>{
  return connection.getAllAsync<OriginalRow>(`SELECT m.id,m.sha256,m.byte_size,m.extension,f.relative_path,f.state FROM media m
    LEFT JOIN local_media_files f ON f.media_id=m.id AND f.vault_id=m.vault_id AND f.variant='original'
    WHERE m.vault_id=? ORDER BY m.id`,vaultId);
}
function integrityLine(key:string,label:string,healthy:boolean,detail:string):IntegrityLine{return{key,label,status:healthy?'pass':'issue',detail};}

export class VaultMaintenance {
  constructor(
    private readonly database:LocalDatabase,
    private readonly vaultId:string,
    private readonly files:MaintenanceFiles,
    private readonly sha256Text:(value:string)=>Promise<string>,
    private readonly regenerate:()=>Promise<{generated:number;failed:number;missingOriginals:number}>,
    private readonly now:()=>Date=()=>new Date(),
  ){}

  async storageSummary():Promise<StorageSummary>{
    const inventory=await this.files.inventory();
    return this.database.run(async connection=>{
      const row=await connection.getFirstAsync<{trips:number;photos:number}>(`SELECT
        (SELECT count(*) FROM trips WHERE vault_id=?) trips,
        (SELECT count(DISTINCT id) FROM media WHERE vault_id=?) photos`,this.vaultId,this.vaultId);
      const sum=(kind:OwnedFileKind)=>inventory.filter(file=>file.kind===kind).reduce((total,file)=>total+file.bytes,0);
      return {trips:number(row?.trips),photos:number(row?.photos),originalBytes:sum('original'),derivativeBytes:sum('derivative'),
        databaseBytes:await databaseSize(connection),stagingBytes:sum('staging'),databaseBytesEstimated:true,externalFilesIncluded:false};
    });
  }

  async rebuildSearch():Promise<MaintenanceResult>{
    const count=await this.database.transaction(async connection=>{
      await rebuildSearchIndex(connection,this.vaultId,this.now().toISOString());
      return number((await connection.getFirstAsync<{count:number}>('SELECT count(*) count FROM search_documents WHERE vault_id=?',this.vaultId))?.count);
    });
    return {completed:true,detail:`Search rebuilt for ${count} documents.`,affected:count,issues:0};
  }

  async regenerateDerivatives():Promise<MaintenanceResult>{
    const result=await this.regenerate();
    return {completed:true,detail:`${result.generated} previews regenerated; ${result.failed} failed; ${result.missingOriginals} missing originals reported.`,
      affected:result.generated,issues:result.failed+result.missingOriginals};
  }

  async removeOrphanedDerivatives():Promise<MaintenanceResult>{
    const expected=new Set(await this.database.run(connection=>connection.getAllAsync<{relative_path:string}>(
      `SELECT relative_path FROM local_media_files WHERE vault_id=? AND variant IN ('display','thumbnail')`,this.vaultId).then(rows=>rows.map(row=>row.relative_path))));
    const inventory=await this.files.inventory(); let removed=0;
    for(const file of inventory)if(file.kind==='derivative'&&!expected.has(file.relativePath)){await this.files.removeDerivative(file.relativePath);removed++;}
    const present=new Set(inventory.filter(file=>file.kind==='derivative').map(file=>file.relativePath));
    await this.database.transaction(async connection=>{
      for(const path of expected)if(!present.has(path))await connection.runAsync(`UPDATE local_media_files SET state='failed',bytes=0 WHERE vault_id=? AND relative_path=? AND variant IN ('display','thumbnail')`,this.vaultId,path);
    });
    return {completed:true,detail:`Removed ${removed} orphaned preview files. Originals were not changed.`,affected:removed,issues:0};
  }

  async cleanStaleStaging():Promise<MaintenanceResult>{
    const inventory=await this.files.inventory();
    const rows=await this.database.run(connection=>connection.getAllAsync<{staging_relative_path:string;state:string}>(
      'SELECT staging_relative_path,state FROM import_items WHERE vault_id=?',this.vaultId));
    const states=new Map(rows.map(row=>[row.staging_relative_path,row.state]));
    const cutoff=this.now().getTime()-STALE_STAGING_MS;let removed=0;
    for(const file of inventory){
      if(file.kind!=='staging'||file.modifiedAt===null||file.modifiedAt>cutoff)continue;
      const state=states.get(file.relativePath);
      if(state===undefined||state==='archived'||state==='unsupported'){await this.files.removeStaging(file.relativePath);removed++;}
    }
    return {completed:true,detail:`Removed ${removed} stale staging files. Originals were not changed.`,affected:removed,issues:0};
  }

  async reconcileMediaAvailability():Promise<MaintenanceResult>{
    const inventory=new Map((await this.files.inventory()).filter(file=>file.kind==='original').map(file=>[file.relativePath,file]));
    const rows=await this.database.run(connection=>originals(connection,this.vaultId));let available=0,missing=0;
    await this.database.transaction(async connection=>{
      for(const row of rows){
        const path=mediaPath(row.sha256,row.extension);const file=inventory.get(path);
        const valid=!!file&&file.bytes===row.byte_size&&await this.files.verify(path,row.sha256,row.byte_size);
        if(valid)available++;else missing++;
        await connection.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at,checksum,recipe_version,width,height)
          VALUES(?,?,'original',?,?,?,1,?,?,NULL,NULL,NULL)
          ON CONFLICT(media_id,variant) DO UPDATE SET relative_path=excluded.relative_path,state=excluded.state,bytes=excluded.bytes,last_access_at=excluded.last_access_at,checksum=excluded.checksum`,
        row.id,this.vaultId,path,valid?'available':'missing',valid?row.byte_size:0,this.now().toISOString(),valid?row.sha256:null);
        if(!valid)await connection.runAsync(`UPDATE import_items SET state='retry_required',error_code='ORIGINAL_MISSING',updated_at=?
          WHERE vault_id=? AND media_id=? AND state='archived'`,this.now().toISOString(),this.vaultId,row.id);
      }
    });
    return {completed:true,detail:`${available} originals available; ${missing} integrity issues reported.`,affected:available,issues:missing};
  }

  async checkIntegrity():Promise<IntegrityReport>{
    const inventory=await this.files.inventory();const byPath=new Map(inventory.map(file=>[file.relativePath,file]));
    const originalRows=await this.database.run(connection=>originals(connection,this.vaultId));
    let verified=0,missing=0,mismatch=0,recordIssues=0;
    for(const row of originalRows){
      const expected=mediaPath(row.sha256,row.extension);const file=byPath.get(expected);
      if(row.relative_path!==expected||row.state!=='available')recordIssues++;
      if(!file){missing++;continue;}
      if(file.bytes!==row.byte_size||!await this.files.verify(expected,row.sha256,row.byte_size)){mismatch++;continue;}
      verified++;
    }
    const db=await this.database.run(async connection=>{
      const sqlite=await connection.getAllAsync<{integrity_check:string}>('PRAGMA integrity_check');
      const foreign=await connection.getAllAsync('PRAGMA foreign_key_check');
      const history=await connection.getAllAsync<{version:number;checksum:string}>('SELECT version,checksum FROM schema_migrations ORDER BY version');
      const version=number((await connection.getFirstAsync<{user_version:number}>('PRAGMA user_version'))?.user_version);
      let migrationIssues=version===migrations.length&&history.length===migrations.length?0:1;
      for(const [index,migration] of migrations.entries())if(history[index]?.version!==migration.version||history[index]?.checksum!==await this.sha256Text(migration.sql))migrationIssues++;
      const expectedCount=number((await connection.getFirstAsync<{count:number}>(`SELECT count(*) count FROM (${searchDocumentSelect}) expected WHERE vault_id=?`,this.vaultId))?.count);
      const documentCount=number((await connection.getFirstAsync<{count:number}>('SELECT count(*) count FROM search_documents WHERE vault_id=?',this.vaultId))?.count);
      const state=await connection.getFirstAsync<{index_version:number}>('SELECT index_version FROM search_index_state WHERE vault_id=?',this.vaultId);
      const projectionDiff=number((await connection.getFirstAsync<{count:number}>(`SELECT count(*) count FROM (
        SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) expected WHERE vault_id=?
        EXCEPT SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM search_documents WHERE vault_id=?
      )`,this.vaultId,this.vaultId))?.count)+number((await connection.getFirstAsync<{count:number}>(`SELECT count(*) count FROM (
        SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM search_documents WHERE vault_id=?
        EXCEPT SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) expected WHERE vault_id=?
      )`,this.vaultId,this.vaultId))?.count);
      const interrupted=number((await connection.getFirstAsync<{count:number}>(`SELECT count(*) count FROM import_items
        WHERE vault_id=? AND state IN ('selected','copying','staged','verified')`,this.vaultId))?.count);
      return {sqliteOk:sqlite.length===1&&sqlite[0].integrity_check==='ok',foreignIssues:foreign.length,migrationIssues,
        searchHealthy:state?.index_version===SEARCH_INDEX_VERSION&&expectedCount===documentCount&&projectionDiff===0,documentCount,interrupted};
    });
    const staging=new Set(inventory.filter(file=>file.kind==='staging').map(file=>file.relativePath));
    const expectedStaging=await this.database.run(connection=>connection.getAllAsync<{staging_relative_path:string;state:string}>(
      `SELECT staging_relative_path,state FROM import_items WHERE vault_id=? AND state IN ('copying','staged','verified')`,this.vaultId));
    const stagingIssues=expectedStaging.filter(row=>!staging.has(row.staging_relative_path)).length;
    const lines=[
      integrityLine('database','Database relationships',db.sqliteOk&&db.foreignIssues===0,db.sqliteOk&&db.foreignIssues===0?'SQLite and foreign keys are healthy.':`${db.foreignIssues} broken database relationships detected.`),
      integrityLine('schema','Schema and migrations',db.migrationIssues===0,db.migrationIssues===0?`Schema version ${migrations.length} is known.`:'Schema version or migration history is inconsistent.'),
      integrityLine('originals','Original photos',missing+mismatch+recordIssues===0,missing+mismatch+recordIssues===0?`${verified} original photos verified.`:`${missing} missing, ${mismatch} size/hash mismatches, ${recordIssues} file-record issues.`),
      integrityLine('search','Search index',db.searchHealthy,db.searchHealthy?`${db.documentCount} search documents are healthy.`:'Search rebuild is needed.'),
      integrityLine('imports','Import and staging state',db.interrupted+stagingIssues===0,db.interrupted+stagingIssues===0?'No interrupted imports.':`${db.interrupted} interrupted import items; ${stagingIssues} staging inconsistencies.`),
    ];
    const issues=lines.filter(line=>line.status==='issue').length;
    return {status:issues?'issues':'healthy',checkedAt:this.now().toISOString(),issues,originalsVerified:verified,documentCount:db.documentCount,lines};
  }
}
