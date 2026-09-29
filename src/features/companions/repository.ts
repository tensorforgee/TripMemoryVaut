import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { parseCompanion, parseCompanionFields, type Companion } from '../../domain/companion';
import { keys, record, utcTimestamp, uuid } from '../../domain/validation';

type CompanionRow = { id: string; vault_id: string; label: string; note: string | null; created_at: string; updated_at: string; deleted_at: string | null };
type MembershipRow = { id: string };
export type CompanionSummary = Companion & { tripCount: number };
export type CompanionTrip = { id: string; title: string; status: 'draft' | 'saved' };

const fromRow = (row: CompanionRow): Companion => parseCompanion({ id: row.id, vaultId: row.vault_id, displayName: row.label,
  note: row.note, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at });

export class CompanionNotFoundError extends Error {
  constructor() { super('Companion not found in the active vault'); this.name = 'CompanionNotFoundError'; }
}

export class CompanionRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string, private readonly newId: () => string,
    private readonly now: () => string = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private async committed<T>(operation: Promise<T>): Promise<T> { const value = await operation; this.listeners.forEach(listener => listener()); return value; }
  private read(connection: SqlConnection, id: string, deleted = false): Promise<CompanionRow | null> {
    return connection.getFirstAsync<CompanionRow>(`SELECT * FROM companions WHERE id=? AND vault_id=? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL`, id, this.vaultId);
  }
  private async requireTrip(connection: SqlConnection, tripId: string): Promise<void> {
    if (!await connection.getFirstAsync('SELECT id FROM trips WHERE id=? AND vault_id=? AND deleted_at IS NULL', tripId, this.vaultId)) {
      throw new Error('Trip not found in the active vault');
    }
  }

  async create(input: { displayName: string; note?: string | null }): Promise<Companion> {
    const value = record(input, 'companion'); keys(value, ['displayName', 'note'], 'companion');
    const fields = parseCompanionFields({ displayName: value.displayName, note: value.note ?? null });
    const id = uuid(this.newId(), 'companion.id'); const now = utcTimestamp(this.now(), 'now');
    return this.committed(this.database.transaction(async connection => {
      await connection.runAsync('INSERT INTO companions(id,vault_id,label,note,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        id, this.vaultId, fields.displayName, fields.note, now, now);
      return fromRow((await this.read(connection, id))!);
    }));
  }

  async get(id: string): Promise<Companion | null> { uuid(id, 'companion.id'); return this.database.run(async c => { const row = await this.read(c, id); return row ? fromRow(row) : null; }); }

  list(search = ''): Promise<CompanionSummary[]> {
    const query = search.trim();
    return this.database.run(async connection => (await connection.getAllAsync<CompanionRow & { trip_count: number }>(`
      SELECT c.*,COUNT(DISTINCT CASE WHEN t.deleted_at IS NULL THEN t.id END) trip_count
      FROM companions c
      LEFT JOIN trip_companions tc ON tc.companion_id=c.id AND tc.vault_id=c.vault_id AND tc.deleted_at IS NULL
      LEFT JOIN trips t ON t.id=tc.trip_id AND t.vault_id=tc.vault_id
      WHERE c.vault_id=? AND c.deleted_at IS NULL AND (?='' OR c.label LIKE '%'||?||'%')
      GROUP BY c.id ORDER BY c.label,c.created_at,c.id`, this.vaultId, query, query)).map(row => ({ ...fromRow(row), tripCount: Number(row.trip_count) })));
  }

  async update(id: string, patch: { displayName?: string; note?: string | null }): Promise<Companion> {
    uuid(id, 'companion.id'); const value = record(patch, 'patch'); keys(value, ['displayName', 'note'], 'patch');
    return this.committed(this.database.transaction(async connection => {
      const currentRow = await this.read(connection, id); if (!currentRow) throw new CompanionNotFoundError();
      const current = fromRow(currentRow); const fields = parseCompanionFields({
        displayName: Object.hasOwn(value, 'displayName') ? value.displayName : current.displayName,
        note: Object.hasOwn(value, 'note') ? value.note : current.note,
      });
      await connection.runAsync('UPDATE companions SET label=?,note=?,updated_at=? WHERE id=? AND vault_id=? AND deleted_at IS NULL',
        fields.displayName, fields.note, utcTimestamp(this.now(), 'now'), id, this.vaultId);
      return fromRow((await this.read(connection, id))!);
    }));
  }

  remove(id: string): Promise<void> { return this.setRemoved(id, true); }
  restore(id: string): Promise<void> { return this.setRemoved(id, false); }
  private setRemoved(id: string, removed: boolean): Promise<void> {
    uuid(id, 'companion.id');
    return this.committed(this.database.transaction(async connection => {
      const row = await this.read(connection, id, !removed); if (!row) throw new CompanionNotFoundError();
      const now = utcTimestamp(this.now(), 'now');
      if (removed) {
        await connection.runAsync('UPDATE companions SET deleted_at=?,updated_at=? WHERE id=? AND vault_id=?', now, now, id, this.vaultId);
        await connection.runAsync(`UPDATE trip_companions SET deleted_at=COALESCE(deleted_at,?),updated_at=?,deleted_by_companion=1
          WHERE companion_id=? AND vault_id=? AND (deleted_at IS NULL OR deleted_by_trip=1 OR deleted_by_companion=1)`, now, now, id, this.vaultId);
      } else {
        await connection.runAsync('UPDATE companions SET deleted_at=NULL,updated_at=? WHERE id=? AND vault_id=?', now, id, this.vaultId);
        await connection.runAsync(`UPDATE trip_companions SET deleted_by_companion=0,
          deleted_at=CASE WHEN deleted_by_trip=0 AND EXISTS(SELECT 1 FROM trips t WHERE t.id=trip_companions.trip_id AND t.vault_id=? AND t.deleted_at IS NULL) THEN NULL ELSE deleted_at END,
          updated_at=? WHERE companion_id=? AND vault_id=? AND deleted_by_companion=1`, this.vaultId, now, id, this.vaultId);
      }
    }));
  }

  attachToTrip(tripId: string, companionId: string): Promise<string> {
    uuid(tripId, 'trip.id'); uuid(companionId, 'companion.id');
    return this.committed(this.database.transaction(async connection => {
      await this.requireTrip(connection, tripId); if (!await this.read(connection, companionId)) throw new CompanionNotFoundError();
      const current = await connection.getFirstAsync<MembershipRow>(`SELECT id FROM trip_companions
        WHERE vault_id=? AND trip_id=? AND companion_id=? ORDER BY updated_at DESC,id DESC LIMIT 1`, this.vaultId, tripId, companionId);
      if (current) {
        const active = await connection.getFirstAsync('SELECT id FROM trip_companions WHERE id=? AND deleted_at IS NULL', current.id);
        if (!active) await connection.runAsync(`UPDATE trip_companions SET deleted_at=NULL,deleted_by_trip=0,deleted_by_companion=0,updated_at=? WHERE id=?`, utcTimestamp(this.now(), 'now'), current.id);
        return current.id;
      }
      const id = uuid(this.newId(), 'tripCompanion.id'); const now = utcTimestamp(this.now(), 'now');
      await connection.runAsync(`INSERT INTO trip_companions(id,vault_id,trip_id,companion_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
        id, this.vaultId, tripId, companionId, now, now); return id;
    }));
  }

  detachFromTrip(tripId: string, companionId: string): Promise<void> {
    uuid(tripId, 'trip.id'); uuid(companionId, 'companion.id');
    return this.committed(this.database.transaction(async connection => {
      await this.requireTrip(connection, tripId); const now = utcTimestamp(this.now(), 'now');
      await connection.runAsync(`UPDATE trip_companions SET deleted_at=?,updated_at=?,deleted_by_trip=0,deleted_by_companion=0
        WHERE vault_id=? AND trip_id=? AND companion_id=? AND deleted_at IS NULL`, now, now, this.vaultId, tripId, companionId);
    }));
  }

  async listForTrip(tripId: string): Promise<Companion[]> {
    uuid(tripId, 'trip.id'); return this.database.run(async connection => {
      await this.requireTrip(connection, tripId);
      return (await connection.getAllAsync<CompanionRow>(`SELECT c.* FROM companions c JOIN trip_companions tc
        ON tc.companion_id=c.id AND tc.vault_id=c.vault_id WHERE tc.trip_id=? AND tc.vault_id=?
        AND tc.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.label,c.id`, tripId, this.vaultId)).map(fromRow);
    });
  }

  async listTrips(companionId: string): Promise<CompanionTrip[]> {
    uuid(companionId, 'companion.id'); return this.database.run(async connection => {
      if (!await this.read(connection, companionId)) throw new CompanionNotFoundError();
      return connection.getAllAsync<CompanionTrip>(`SELECT t.id,t.title,t.status FROM trips t JOIN trip_companions tc
        ON tc.trip_id=t.id AND tc.vault_id=t.vault_id WHERE tc.companion_id=? AND tc.vault_id=?
        AND tc.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.sort_date IS NULL,t.sort_date DESC,t.title,t.id`, companionId, this.vaultId);
    });
  }
}
