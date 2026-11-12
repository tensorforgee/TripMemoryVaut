import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { memoryInput, type Memory, type MemoryInput } from '../../domain/memory';
import { uuid } from '../../domain/validation';

type Row = { id: string; trip_id: string; title: string; body: string; dates_json: string | null; day_id: string | null; stop_id: string | null; created_at: string; updated_at: string };
export class MemoryRepository {
  private listeners = new Set<() => void>();
  constructor(private database: LocalDatabase, private vaultId: string, private newId: () => string) { uuid(vaultId, 'vaultId'); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) { try { fn(); } catch { /* committed */ } } }
  private async activeTrip(c: SqlConnection, tripId: string) {
    uuid(tripId, 'tripId');
    if (!await c.getFirstAsync(`SELECT t.id FROM trips t JOIN vaults v ON v.id=t.vault_id WHERE t.id=? AND t.vault_id=? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`, tripId, this.vaultId)) throw new Error('Trip unavailable. It may be in Trash.');
  }
  list(tripId: string): Promise<Memory[]> {
    uuid(tripId, 'tripId');
    return this.database.run(async c => {
      const rows = await c.getAllAsync<Row>(`SELECT n.* FROM memories n JOIN trips t ON t.id=n.trip_id AND t.vault_id=n.vault_id JOIN vaults v ON v.id=n.vault_id
        WHERE n.vault_id=? AND n.trip_id=? AND n.deleted_at IS NULL AND t.deleted_at IS NULL AND v.deleted_at IS NULL ORDER BY n.created_at,n.id`, this.vaultId, tripId);
      const links = await c.getAllAsync<{ memory_id: string; media_id: string }>(`SELECT a.memory_id,a.media_id FROM memory_media a JOIN memories n ON n.id=a.memory_id AND n.vault_id=a.vault_id
        WHERE n.vault_id=? AND n.trip_id=? AND a.deleted_at IS NULL ORDER BY a.created_at,a.id`, this.vaultId, tripId);
      return rows.map(row => ({ id: row.id, tripId: row.trip_id, title: row.title, body: row.body,
        dates: row.dates_json === null ? null : JSON.parse(row.dates_json), dayId: row.day_id, stopId: row.stop_id,
        createdAt: row.created_at, updatedAt: row.updated_at, mediaIds: links.filter(a => a.memory_id === row.id).map(a => a.media_id) }));
    });
  }
  async save(tripId: string, input: MemoryInput, id?: string): Promise<string> {
    const value = memoryInput(input), memoryId = uuid(id ?? this.newId(), 'memoryId'), now = new Date().toISOString();
    await this.database.transaction(async c => {
      await this.activeTrip(c, tripId);
      const fields = [value.title,value.body,value.dates === null ? null : JSON.stringify(value.dates),value.dayId,value.stopId,now];
      if (id) {
        const r = await c.runAsync(`UPDATE memories SET title=?,body=?,dates_json=?,day_id=?,stop_id=?,updated_at=? WHERE id=? AND vault_id=? AND trip_id=? AND deleted_at IS NULL`, ...fields,memoryId,this.vaultId,tripId);
        if (r.changes !== 1) throw new Error('Memory unavailable. Reopen the trip.');
      } else await c.runAsync(`INSERT INTO memories(title,body,dates_json,day_id,stop_id,updated_at,id,vault_id,trip_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, ...fields,memoryId,this.vaultId,tripId,now);
      const existing = await c.getAllAsync<{ id: string; media_id: string }>('SELECT id,media_id FROM memory_media WHERE memory_id=? AND vault_id=? AND deleted_at IS NULL',memoryId,this.vaultId);
      for (const link of existing) if (!value.mediaIds.includes(link.media_id)) await c.runAsync('UPDATE memory_media SET deleted_at=?,updated_at=? WHERE id=?',now,now,link.id);
      for (const mediaId of value.mediaIds) if (!existing.some(a => a.media_id === mediaId)) {
        await c.runAsync('INSERT INTO memory_media(id,vault_id,memory_id,media_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',uuid(this.newId(),'attachmentId'),this.vaultId,memoryId,mediaId,now,now);
      }
      await c.runAsync('DELETE FROM memory_drafts WHERE vault_id=? AND trip_id=?',this.vaultId,tripId);
    });
    this.changed(); return memoryId;
  }
  async remove(tripId: string, id: string): Promise<void> {
    uuid(id, 'memoryId'); const now = new Date().toISOString();
    await this.database.transaction(async c => {
      await this.activeTrip(c, tripId);
      const r = await c.runAsync('UPDATE memories SET deleted_at=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NULL',now,now,id,tripId,this.vaultId);
      if (r.changes !== 1) throw new Error('Memory unavailable');
      await c.runAsync('UPDATE memory_media SET deleted_at=?,updated_at=? WHERE memory_id=? AND vault_id=? AND deleted_at IS NULL',now,now,id,this.vaultId);
    });
    this.changed();
  }
  draft(tripId: string): Promise<string | null> {
    return this.database.run(async c => { await this.activeTrip(c,tripId); return (await c.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM memory_drafts WHERE vault_id=? AND trip_id=?',this.vaultId,tripId))?.payload_json ?? null; });
  }
  saveDraft(tripId: string, payload: string): Promise<void> {
    JSON.parse(payload);
    return this.database.transaction(async c => {
      await this.activeTrip(c,tripId);
      await c.runAsync(`INSERT INTO memory_drafts(vault_id,trip_id,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(vault_id,trip_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`,this.vaultId,tripId,payload,new Date().toISOString());
    });
  }
  discardDraft(tripId: string): Promise<void> {
    return this.database.transaction(async c => { await this.activeTrip(c,tripId); await c.runAsync('DELETE FROM memory_drafts WHERE vault_id=? AND trip_id=?',this.vaultId,tripId); });
  }
}
