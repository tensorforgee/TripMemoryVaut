import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { normalizeChapterTitleV1, parseChapter, parseChapterFields, type Chapter } from '../../domain/chapter';
import { keys, record, utcTimestamp, uuid } from '../../domain/validation';

type ChapterRow = { id: string; vault_id: string; name: string; description: string | null; position: number; created_at: string; updated_at: string; deleted_at: string | null };
type MembershipRow = { id: string; position: number };
export type ChapterSummary = Chapter & { tripCount: number };
export type ChapterTrip = { id: string; title: string; status: 'draft' | 'saved'; position: number };
const fromRow = (row: ChapterRow): Chapter => parseChapter({ id: row.id, vaultId: row.vault_id, title: row.name,
  description: row.description, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at });

export class ChapterNotFoundError extends Error {
  constructor() { super('Chapter not found in the active vault'); this.name = 'ChapterNotFoundError'; }
}

export class ChapterRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string, private readonly newId: () => string,
    private readonly now: () => string = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private async committed<T>(operation: Promise<T>): Promise<T> { const value = await operation; this.listeners.forEach(listener => listener()); return value; }
  private read(connection: SqlConnection, id: string, deleted = false): Promise<ChapterRow | null> {
    return connection.getFirstAsync<ChapterRow>(`SELECT * FROM chapters WHERE id=? AND vault_id=? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL`, id, this.vaultId);
  }
  private async requireTrip(connection: SqlConnection, tripId: string): Promise<void> {
    if (!await connection.getFirstAsync('SELECT id FROM trips WHERE id=? AND vault_id=? AND deleted_at IS NULL', tripId, this.vaultId)) throw new Error('Trip not found in the active vault');
  }

  async create(input: { title: string; description?: string | null }): Promise<Chapter> {
    const value = record(input, 'chapter'); keys(value, ['title', 'description'], 'chapter');
    const id = uuid(this.newId(), 'chapter.id'); const now = utcTimestamp(this.now(), 'now');
    return this.committed(this.database.transaction(async connection => {
      const next = await connection.getFirstAsync<{ position: number }>('SELECT COALESCE(MAX(position),-1)+1 position FROM chapters WHERE vault_id=? AND deleted_at IS NULL', this.vaultId);
      const fields = parseChapterFields({ title: value.title, description: value.description ?? null, position: Number(next?.position ?? 0) });
      await connection.runAsync(`INSERT INTO chapters(id,vault_id,name,normalized_name,description,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
        id, this.vaultId, fields.title, normalizeChapterTitleV1(fields.title), fields.description, fields.position, now, now);
      return fromRow((await this.read(connection, id))!);
    }));
  }

  async get(id: string): Promise<Chapter | null> { uuid(id, 'chapter.id'); return this.database.run(async c => { const row = await this.read(c, id); return row ? fromRow(row) : null; }); }
  list(search = ''): Promise<ChapterSummary[]> {
    const query = search.trim();
    return this.database.run(async connection => (await connection.getAllAsync<ChapterRow & { trip_count: number }>(`
      SELECT c.*,COUNT(DISTINCT CASE WHEN t.deleted_at IS NULL THEN t.id END) trip_count FROM chapters c
      LEFT JOIN trip_chapters tc ON tc.chapter_id=c.id AND tc.vault_id=c.vault_id AND tc.deleted_at IS NULL
      LEFT JOIN trips t ON t.id=tc.trip_id AND t.vault_id=tc.vault_id
      WHERE c.vault_id=? AND c.deleted_at IS NULL AND (?='' OR c.name LIKE '%'||?||'%')
      GROUP BY c.id ORDER BY c.position,c.name,c.id`, this.vaultId, query, query)).map(row => ({ ...fromRow(row), tripCount: Number(row.trip_count) })));
  }

  async update(id: string, patch: { title?: string; description?: string | null; position?: number }): Promise<Chapter> {
    uuid(id, 'chapter.id'); const value = record(patch, 'patch'); keys(value, ['title', 'description', 'position'], 'patch');
    return this.committed(this.database.transaction(async connection => {
      const currentRow = await this.read(connection, id); if (!currentRow) throw new ChapterNotFoundError(); const current = fromRow(currentRow);
      const fields = parseChapterFields({ title: Object.hasOwn(value, 'title') ? value.title : current.title,
        description: Object.hasOwn(value, 'description') ? value.description : current.description,
        position: Object.hasOwn(value, 'position') ? value.position : current.position });
      await connection.runAsync(`UPDATE chapters SET name=?,normalized_name=?,description=?,position=?,updated_at=? WHERE id=? AND vault_id=? AND deleted_at IS NULL`,
        fields.title, normalizeChapterTitleV1(fields.title), fields.description, fields.position, utcTimestamp(this.now(), 'now'), id, this.vaultId);
      return fromRow((await this.read(connection, id))!);
    }));
  }

  remove(id: string): Promise<void> { return this.setRemoved(id, true); }
  restore(id: string): Promise<void> { return this.setRemoved(id, false); }
  private setRemoved(id: string, removed: boolean): Promise<void> {
    uuid(id, 'chapter.id'); return this.committed(this.database.transaction(async connection => {
      const row = await this.read(connection, id, !removed); if (!row) throw new ChapterNotFoundError(); const now = utcTimestamp(this.now(), 'now');
      if (removed) {
        await connection.runAsync('UPDATE chapters SET deleted_at=?,updated_at=? WHERE id=? AND vault_id=?', now, now, id, this.vaultId);
        await connection.runAsync(`UPDATE trip_chapters SET deleted_at=COALESCE(deleted_at,?),updated_at=?,deleted_by_chapter=1
          WHERE chapter_id=? AND vault_id=? AND (deleted_at IS NULL OR deleted_by_trip=1 OR deleted_by_chapter=1)`, now, now, id, this.vaultId);
      } else {
        await connection.runAsync('UPDATE chapters SET deleted_at=NULL,updated_at=? WHERE id=? AND vault_id=?', now, id, this.vaultId);
        await connection.runAsync(`UPDATE trip_chapters SET deleted_by_chapter=0,
          deleted_at=CASE WHEN deleted_by_trip=0 AND EXISTS(SELECT 1 FROM trips t WHERE t.id=trip_chapters.trip_id AND t.vault_id=? AND t.deleted_at IS NULL) THEN NULL ELSE deleted_at END,
          updated_at=? WHERE chapter_id=? AND vault_id=? AND deleted_by_chapter=1`, this.vaultId, now, id, this.vaultId);
      }
    }));
  }

  attachTrip(tripId: string, chapterId: string): Promise<string> {
    uuid(tripId, 'trip.id'); uuid(chapterId, 'chapter.id');
    return this.committed(this.database.transaction(async connection => {
      await this.requireTrip(connection, tripId); if (!await this.read(connection, chapterId)) throw new ChapterNotFoundError();
      const current = await connection.getFirstAsync<MembershipRow>(`SELECT id,position FROM trip_chapters WHERE vault_id=? AND trip_id=? AND chapter_id=? ORDER BY updated_at DESC,id DESC LIMIT 1`, this.vaultId, tripId, chapterId);
      if (current) {
        const active = await connection.getFirstAsync('SELECT id FROM trip_chapters WHERE id=? AND deleted_at IS NULL', current.id);
        if (!active) {
          const next = await connection.getFirstAsync<{ position: number }>('SELECT COALESCE(MAX(position),-1)+1 position FROM trip_chapters WHERE chapter_id=? AND deleted_at IS NULL', chapterId);
          await connection.runAsync(`UPDATE trip_chapters SET deleted_at=NULL,deleted_by_trip=0,deleted_by_chapter=0,position=?,updated_at=? WHERE id=?`, Number(next?.position ?? 0), utcTimestamp(this.now(), 'now'), current.id);
        }
        return current.id;
      }
      const next = await connection.getFirstAsync<{ position: number }>('SELECT COALESCE(MAX(position),-1)+1 position FROM trip_chapters WHERE chapter_id=? AND deleted_at IS NULL', chapterId);
      const id = uuid(this.newId(), 'tripChapter.id'); const now = utcTimestamp(this.now(), 'now');
      await connection.runAsync(`INSERT INTO trip_chapters(id,vault_id,trip_id,chapter_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
        id, this.vaultId, tripId, chapterId, Number(next?.position ?? 0), now, now); return id;
    }));
  }

  detachTrip(tripId: string, chapterId: string): Promise<void> {
    uuid(tripId, 'trip.id'); uuid(chapterId, 'chapter.id'); return this.committed(this.database.transaction(async connection => {
      await this.requireTrip(connection, tripId); const now = utcTimestamp(this.now(), 'now');
      await connection.runAsync(`UPDATE trip_chapters SET deleted_at=?,updated_at=?,deleted_by_trip=0,deleted_by_chapter=0
        WHERE vault_id=? AND trip_id=? AND chapter_id=? AND deleted_at IS NULL`, now, now, this.vaultId, tripId, chapterId);
    }));
  }

  async listForTrip(tripId: string): Promise<Chapter[]> {
    uuid(tripId, 'trip.id'); return this.database.run(async connection => { await this.requireTrip(connection, tripId);
      return (await connection.getAllAsync<ChapterRow>(`SELECT c.* FROM chapters c JOIN trip_chapters tc ON tc.chapter_id=c.id AND tc.vault_id=c.vault_id
        WHERE tc.trip_id=? AND tc.vault_id=? AND tc.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.position,c.name,c.id`, tripId, this.vaultId)).map(fromRow);
    });
  }

  async listTrips(chapterId: string): Promise<ChapterTrip[]> {
    uuid(chapterId, 'chapter.id'); return this.database.run(async connection => { if (!await this.read(connection, chapterId)) throw new ChapterNotFoundError();
      return connection.getAllAsync<ChapterTrip>(`SELECT t.id,t.title,t.status,tc.position FROM trips t JOIN trip_chapters tc ON tc.trip_id=t.id AND tc.vault_id=t.vault_id
        WHERE tc.chapter_id=? AND tc.vault_id=? AND tc.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY tc.position,t.title,t.id`, chapterId, this.vaultId);
    });
  }
}
