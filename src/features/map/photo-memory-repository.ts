import type { LocalDatabase } from '../../core/database/database';
import { uuid } from '../../domain/validation';
import { pinInput, type PinInput } from './photo-memory-model';

export type VaultPhoto = { media_id: string; original_filename: string | null; thumbnail: string | null; display: string | null; original_state: string };
export type PhotoMemoryPin = VaultPhoto & { id: string; trip_id: string; longitude: number; latitude: number; note: string | null };
const photoColumns = `m.id media_id,m.original_filename,coalesce(o.state,'missing') original_state,
  CASE WHEN th.state='available' THEN th.relative_path END thumbnail,
  CASE WHEN d.state='available' THEN d.relative_path END display`;
const photoJoins = `JOIN vaults v ON v.id=m.vault_id
  LEFT JOIN local_media_files o ON o.media_id=m.id AND o.vault_id=m.vault_id AND o.variant='original'
  LEFT JOIN local_media_files th ON th.media_id=m.id AND th.vault_id=m.vault_id AND th.variant='thumbnail'
  LEFT JOIN local_media_files d ON d.media_id=m.id AND d.vault_id=m.vault_id AND d.variant='display'`;

export class PhotoMemoryRepository {
  private listeners = new Set<() => void>();
  constructor(private database: LocalDatabase, private vaultId: string, private newId: () => string) { uuid(vaultId,'vaultId'); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) { try { fn(); } catch { /* committed */ } } }
  photos(after?: string): Promise<VaultPhoto[]> {
    if (after) uuid(after,'after');
    return this.database.run(c => c.getAllAsync<VaultPhoto>(`SELECT ${photoColumns} FROM media m ${photoJoins}
      WHERE m.vault_id=? AND m.deleted_at IS NULL AND v.deleted_at IS NULL ${after ? 'AND m.id>?' : ''}
      ORDER BY m.id LIMIT 60`,this.vaultId,...(after ? [after] : [])));
  }
  photo(mediaId: string): Promise<VaultPhoto | null> {
    uuid(mediaId,'mediaId');
    return this.database.run(c => c.getFirstAsync<VaultPhoto>(`SELECT ${photoColumns} FROM media m ${photoJoins}
      WHERE m.id=? AND m.vault_id=? AND m.deleted_at IS NULL AND v.deleted_at IS NULL`,mediaId,this.vaultId));
  }
  list(tripId: string): Promise<PhotoMemoryPin[]> {
    uuid(tripId,'tripId');
    return this.database.run(c => c.getAllAsync<PhotoMemoryPin>(`SELECT p.id,p.trip_id,p.longitude,p.latitude,p.note,${photoColumns}
      FROM photo_memory_pins p JOIN media m ON m.id=p.media_id AND m.vault_id=p.vault_id ${photoJoins}
      JOIN trips t ON t.id=p.trip_id AND t.vault_id=p.vault_id
      WHERE p.vault_id=? AND p.trip_id=? AND p.deleted_at IS NULL AND t.deleted_at IS NULL
      AND m.deleted_at IS NULL AND v.deleted_at IS NULL ORDER BY p.created_at,p.id`,this.vaultId,tripId));
  }
  async save(tripId: string, input: PinInput, id?: string): Promise<string> {
    uuid(tripId,'tripId'); const value = pinInput(input), pinId = uuid(id ?? this.newId(),'pinId');
    const now = new Date().toISOString();
    await this.database.transaction(async c => {
      if (id) {
        const r = await c.runAsync(`UPDATE photo_memory_pins SET media_id=?,longitude=?,latitude=?,note=?,updated_at=?
          WHERE id=? AND vault_id=? AND trip_id=? AND deleted_at IS NULL`,value.mediaId,...value.coordinate,value.note,now,pinId,this.vaultId,tripId);
        if (r.changes !== 1) throw new Error('Photo memory unavailable');
      } else await c.runAsync(`INSERT INTO photo_memory_pins(id,vault_id,trip_id,media_id,longitude,latitude,note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`,pinId,this.vaultId,tripId,value.mediaId,...value.coordinate,value.note,now,now);
    });
    this.changed(); return pinId;
  }
  async remove(tripId: string, id: string): Promise<void> {
    uuid(tripId,'tripId'); uuid(id,'pinId'); const now = new Date().toISOString();
    await this.database.transaction(async c => {
      const r = await c.runAsync(`UPDATE photo_memory_pins SET deleted_at=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NULL`,now,now,id,tripId,this.vaultId);
      if (r.changes !== 1) throw new Error('Photo memory unavailable');
    });
    this.changed();
  }
}
