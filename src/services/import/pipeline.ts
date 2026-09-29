import { parseMedia } from '../../domain/media';
import { mediaPath, type MediaFiles } from '../../core/media/files';
import { MediaRepository, type ImportItem } from '../../features/media/repository';

export function importError(error: unknown): string {
  const s=String(error);
  for(const code of ['UNSUPPORTED_FORMAT','UNSUPPORTED_ANIMATION','SIZE_LIMIT','PIXEL_LIMIT','CORRUPT_IMAGE','ORIGINAL_CONFLICT','STAGING_INVALID','NATIVE_MEDIA_UNAVAILABLE','ANDROID_9_REQUIRED']) if(s.includes(code)) return code;
  if (/space|ENOSPC/i.test(s)) return 'STORAGE_FULL';
  if (/SOURCE_UNAVAILABLE|ENOENT|No such file|Permission|FileNotFound/i.test(s)) return 'SOURCE_UNAVAILABLE';
  return 'IMPORT_FAILED';
}
export class ImportPipeline {
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly repository: MediaRepository, readonly files: MediaFiles) {}
  // A single worker also bounds native decoder concurrency. All callers share this service.
  run(retry = false): Promise<void> {
    const work=this.queue.then(()=>this.process(retry));
    this.queue=work.catch(()=>undefined); return work;
  }
  async gallery(tripId: string, after?: {position:number;id:string}) {
    const photos=await this.repository.gallery(tripId,after);
    // Check only the visible page. Startup never stats the entire completed archive.
    for(const asset of await this.repository.assets(false,photos.map(p=>p.media_id))) {
      await this.repository.availability(asset.id,await this.files.exists(asset.relative_path));
      const photo=photos.find(p=>p.media_id===asset.id)!;
      for(const variant of ['display','thumbnail'] as const){
        const path=photo[variant];
        if(path&&!await this.files.exists(path))await this.repository.derivative(asset.id,variant,path,null);
      }
    }
    return this.repository.gallery(tripId,after);
  }
  private async process(retry: boolean) {
    for(let item of await this.repository.items()) {
      let committed = false;
      if(item.state==='archived' || item.state==='unsupported') continue;
      if((item.state==='failed' || item.state==='retry_required') && !retry) continue;
      try {
        if(item.state==='copying') { // .part may be truncated: never promote it after a crash.
          await this.repository.state(item.id,'retry_required','INTERRUPTED_COPY');
          item={...item,state:'retry_required',error_code:'INTERRUPTED_COPY'};
        }
        if(item.state==='failed' || item.state==='retry_required') {
          // Failed/interrupted copy is never trusted just because its .part decodes.
          const safeNext=item.evidence_json?'verified':'selected';
          await this.repository.state(item.id,safeNext); item={...item,state:safeNext};
        }
        if(item.state==='selected') {
          if(!item.source_uri) { await this.repository.state(item.id,'retry_required','SOURCE_UNAVAILABLE'); continue; }
          await this.repository.state(item.id,'copying');
          await this.files.copy(item.source_uri,item.staging_relative_path);
          await this.repository.state(item.id,'staged'); item={...item,state:'staged'};
        }
        let evidence=item.evidence_json ? parseMedia(JSON.parse(item.evidence_json)) : null;
        if(item.state==='staged') {
          evidence=parseMedia({...await this.files.inspect(item.staging_relative_path),originalFilename:item.original_filename,sourceFidelity:'picker_representation'});
          await this.repository.verified(item.id,evidence); item={...item,state:'verified',evidence_json:JSON.stringify(evidence)};
        }
        if(!evidence) throw new Error('Missing verified evidence');
        const final=mediaPath(evidence.sha256,evidence.extension);
        await this.files.publish(item.staging_relative_path,final,evidence.sha256,evidence.byteSize);
        // publish checks both reused final files and new staged bytes; immutable originals are never replaced.
        const id=await this.repository.archive(item,evidence);
        committed = true;
        try { await this.files.removeStaging(item.staging_relative_path); } catch { /* safe leftover, not an archive failure */ }
        await this.derivatives(id,evidence.sha256,evidence.extension);
      } catch(error) {
        // A later bookkeeping failure must never demote an archived original.
        if (committed) throw error;
        const code=importError(error);
        await this.repository.state(item.id,code.startsWith('UNSUPPORTED')?'unsupported':code==='SOURCE_UNAVAILABLE'?'retry_required':'failed',code);
      }
    }
    // A killed derivative write can leave an archived item with no derivative row.
    // Reconcile originals in the background worker, never by blocking database startup.
    for(const asset of await this.repository.assets(!retry)) {
      const exists=await this.files.exists(asset.relative_path);
      await this.repository.availability(asset.id,exists);
      if(exists) await this.derivatives(asset.id,asset.sha256,asset.extension);
    }
    await this.repository.finishBatches();
  }
  private async derivatives(id: string, hash: string, extension: string) {
    for(const variant of ['display','thumbnail'] as const) {
      const path=mediaPath(hash,extension,variant);
      try {
        // Re-register an orphan derivative by regenerating it; no original rewrite.
        const registered=await this.repository.database.run(c=>c.getFirstAsync<{state:string}>(`SELECT state FROM local_media_files WHERE media_id=? AND vault_id=? AND variant=?`,id,this.repository.vaultId,variant));
        if(registered?.state==='available' && await this.files.exists(path)) continue;
        const data=await this.files.derive(mediaPath(hash,extension),path,variant==='display'?2048:320);
        await this.repository.derivative(id,variant,path,data);
      } catch { await this.repository.derivative(id,variant,path,null); }
    }
  }
}
