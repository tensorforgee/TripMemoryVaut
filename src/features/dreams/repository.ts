import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { parseDateSpec, type DateSpec } from '../../domain/date-spec';
import { dreamFields, parseDream, parseDreamPatch, type CreateDream, type DreamDestination, type DreamPatch } from '../../domain/dream';
import { utcTimestamp, uuid } from '../../domain/validation';

type DreamRow = {
  id: string; vault_id: string; place_id: string; added_dates_json: string;
  note: string | null; location_text: string | null; is_archived: number;
  created_at: string; updated_at: string; deleted_at: string | null;
  name: string; latitude: number | null; longitude: number | null; dream_status: string;
};

type VisitRow = {
  id: string; dream_id: string; stop_id: string; linked_at: string;
  place_id: string; place_name: string; trip_id: string; trip_title: string;
  visit_dates_json: string;
};

export type DreamVisit = {
  id: string; dreamId: string; stopId: string; linkedAt: string;
  placeId: string; placeName: string; tripId: string; tripTitle: string;
  visitDates: DateSpec;
};

export type DreamWithVisits = DreamDestination & { visits: DreamVisit[] };
export type DreamVisitOption = {
  stopId: string; placeId: string; placeName: string; tripId: string; tripTitle: string; visitDates: DateSpec;
};

export class DreamNotFoundError extends Error {
  constructor() { super('Dream not found in the active vault'); this.name = 'DreamNotFoundError'; }
}

const dreamSelect = `SELECT d.*,p.name,p.latitude,p.longitude,
  CASE WHEN d.is_archived=1 OR d.deleted_at IS NOT NULL THEN 'archived'
    WHEN EXISTS(
      SELECT 1 FROM dream_visits dv
      JOIN stops s ON s.id=dv.stop_id AND s.vault_id=dv.vault_id
      JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
      WHERE dv.dream_id=d.id AND dv.vault_id=d.vault_id AND dv.deleted_at IS NULL
        AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
        AND t.deleted_at IS NULL AND t.status='saved') THEN 'visited'
    ELSE 'dreaming' END dream_status
  FROM dream_destinations d
  JOIN places p ON p.id=d.place_id AND p.vault_id=d.vault_id
  JOIN vaults v ON v.id=d.vault_id
  WHERE d.vault_id=? AND p.deleted_at IS NULL AND v.deleted_at IS NULL`;

const visitSelect = `SELECT dv.id,dv.dream_id,dv.stop_id,dv.linked_at,
  p.id place_id,p.name place_name,t.id trip_id,t.title trip_title,
  CASE WHEN s.dates_json IS NOT NULL THEN s.dates_json ELSE t.dates_json END visit_dates_json
  FROM dream_visits dv
  JOIN stops s ON s.id=dv.stop_id AND s.vault_id=dv.vault_id
  JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
  JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
  WHERE dv.vault_id=? AND dv.deleted_at IS NULL AND s.deleted_at IS NULL
    AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
    AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status='saved'`;

function fromRow(row: DreamRow): DreamDestination {
  if (row.is_archived !== 0 && row.is_archived !== 1) throw new Error('Invalid stored Dream archive flag');
  return parseDream({
    id: row.id, vaultId: row.vault_id, placeId: row.place_id,
    title: row.name, note: row.note, locationText: row.location_text,
    latitude: row.latitude, longitude: row.longitude,
    addedDates: JSON.parse(row.added_dates_json), isArchived: row.is_archived === 1,
    status: row.dream_status, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  });
}

function visitFromRow(row: VisitRow): DreamVisit {
  return {
    id: uuid(row.id, 'dreamVisit.id'), dreamId: uuid(row.dream_id, 'dreamVisit.dreamId'),
    stopId: uuid(row.stop_id, 'dreamVisit.stopId'), linkedAt: utcTimestamp(row.linked_at, 'dreamVisit.linkedAt'),
    placeId: uuid(row.place_id, 'dreamVisit.placeId'), placeName: row.place_name,
    tripId: uuid(row.trip_id, 'dreamVisit.tripId'), tripTitle: row.trip_title,
    visitDates: parseDateSpec(JSON.parse(row.visit_dates_json)),
  };
}

export class DreamRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string, private readonly newId: () => string,
    private readonly now: () => string = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private async committed<T>(operation: Promise<T>): Promise<T> {
    const result = await operation; this.listeners.forEach(listener => listener()); return result;
  }
  private timestamp(): string { return utcTimestamp(this.now(), 'now'); }

  private async read(connection: SqlConnection, id: string, includeRemoved = false): Promise<DreamDestination | null> {
    const row = await connection.getFirstAsync<DreamRow>(`${dreamSelect} AND d.id=? AND d.deleted_at IS ${includeRemoved ? 'NOT ' : ''}NULL`, this.vaultId, uuid(id, 'dream.id'));
    return row ? fromRow(row) : null;
  }

  private async visits(connection: SqlConnection, dreamIds: string[]): Promise<Map<string, DreamVisit[]>> {
    const result = new Map<string, DreamVisit[]>();
    if (!dreamIds.length) return result;
    const placeholders = dreamIds.map(() => '?').join(',');
    const rows = await connection.getAllAsync<VisitRow>(`${visitSelect} AND dv.dream_id IN (${placeholders})
      ORDER BY dv.linked_at,dv.id`, this.vaultId, ...dreamIds);
    for (const row of rows) {
      const value = visitFromRow(row); result.set(value.dreamId, [...(result.get(value.dreamId) ?? []), value]);
    }
    return result;
  }

  async create(input: CreateDream): Promise<DreamWithVisits> {
    const fields = dreamFields(input); const now = this.timestamp();
    const placeId = uuid(this.newId(), 'place.id'); const dreamId = uuid(this.newId(), 'dream.id');
    const addedDates: DateSpec = { start: { precision: 'day', value: now.slice(0, 10) }, end: null, certainty: 'exact', source: 'user' };
    return this.committed(this.database.transaction(async connection => {
      await connection.runAsync(`INSERT INTO places(id,vault_id,name,latitude,longitude,coordinate_precision,source,provenance_json,aliases_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, placeId, this.vaultId, fields.title, fields.latitude, fields.longitude,
      fields.latitude === null ? 'unknown' : 'point', 'user', '{}', '[]', now, now);
      await connection.runAsync(`INSERT INTO dream_destinations(id,vault_id,place_id,added_dates_json,note,location_text,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`, dreamId, this.vaultId, placeId, JSON.stringify(addedDates), fields.note, fields.locationText, now, now);
      return { ...(await this.read(connection, dreamId))!, visits: [] };
    }));
  }

  async get(id: string): Promise<DreamWithVisits | null> {
    return this.database.run(async connection => {
      const dream = await this.read(connection, id); if (!dream) return null;
      return { ...dream, visits: (await this.visits(connection, [dream.id])).get(dream.id) ?? [] };
    });
  }

  async getRemoved(id: string): Promise<DreamDestination | null> {
    return this.database.run(connection => this.read(connection, id, true));
  }

  async listActive(): Promise<DreamWithVisits[]> {
    return this.database.run(async connection => {
      const rows = await connection.getAllAsync<DreamRow>(`${dreamSelect} AND d.deleted_at IS NULL AND d.is_archived=0
        ORDER BY CASE WHEN dream_status='dreaming' THEN 0 ELSE 1 END,p.name COLLATE NOCASE,d.created_at,d.id`, this.vaultId);
      const dreams = rows.map(fromRow); const visits = await this.visits(connection, dreams.map(dream => dream.id));
      return dreams.map(dream => ({ ...dream, visits: visits.get(dream.id) ?? [] }));
    });
  }

  async listArchived(): Promise<DreamWithVisits[]> {
    return this.database.run(async connection => {
      const rows = await connection.getAllAsync<DreamRow>(`${dreamSelect} AND d.deleted_at IS NULL AND d.is_archived=1
        ORDER BY d.updated_at DESC,p.name COLLATE NOCASE,d.id`, this.vaultId);
      const dreams = rows.map(fromRow); const visits = await this.visits(connection, dreams.map(dream => dream.id));
      return dreams.map(dream => ({ ...dream, visits: visits.get(dream.id) ?? [] }));
    });
  }

  async update(id: string, patch: DreamPatch): Promise<DreamWithVisits> {
    return this.committed(this.database.transaction(async connection => {
      const current = await this.read(connection, id); if (!current) throw new DreamNotFoundError();
      const fields = parseDreamPatch(patch, current); const now = this.timestamp();
      await connection.runAsync(`UPDATE places SET name=?,latitude=?,longitude=?,coordinate_precision=?,updated_at=?
        WHERE id=? AND vault_id=? AND deleted_at IS NULL`, fields.title, fields.latitude, fields.longitude,
      fields.latitude === null ? 'unknown' : 'point', now, current.placeId, this.vaultId);
      await connection.runAsync(`UPDATE dream_destinations SET note=?,location_text=?,updated_at=?
        WHERE id=? AND vault_id=? AND deleted_at IS NULL`, fields.note, fields.locationText, now, id, this.vaultId);
      const dream = (await this.read(connection, id))!;
      return { ...dream, visits: (await this.visits(connection, [id])).get(id) ?? [] };
    }));
  }

  archive(id: string): Promise<void> { return this.setArchived(id, true); }
  unarchive(id: string): Promise<void> { return this.setArchived(id, false); }
  private setArchived(id: string, archived: boolean): Promise<void> {
    return this.committed(this.database.transaction(async connection => {
      const current = await this.read(connection, id); if (!current) throw new DreamNotFoundError();
      const result = await connection.runAsync(`UPDATE dream_destinations SET is_archived=?,updated_at=?
        WHERE id=? AND vault_id=? AND deleted_at IS NULL AND is_archived=?`, Number(archived), this.timestamp(), id, this.vaultId, Number(!archived));
      if (result.changes !== 1) throw new DreamNotFoundError();
    }));
  }

  remove(id: string): Promise<void> { return this.setRemoved(id, true); }
  restore(id: string): Promise<void> { return this.setRemoved(id, false); }
  private setRemoved(id: string, removed: boolean): Promise<void> {
    uuid(id, 'dream.id');
    return this.committed(this.database.transaction(async connection => {
      const now = this.timestamp();
      const result = await connection.runAsync(`UPDATE dream_destinations SET deleted_at=?,updated_at=?
        WHERE id=? AND vault_id=? AND deleted_at IS ${removed ? '' : 'NOT '}NULL`, removed ? now : null, now, id, this.vaultId);
      if (result.changes !== 1) throw new DreamNotFoundError();
      if (removed) {
        await connection.runAsync(`UPDATE dream_visits SET deleted_at=COALESCE(deleted_at,?),updated_at=?,deleted_by_dream=1
          WHERE dream_id=? AND vault_id=? AND (deleted_at IS NULL OR deleted_by_dream=1 OR deleted_by_stop=1)`, now, now, id, this.vaultId);
      } else {
        await connection.runAsync(`UPDATE dream_visits SET deleted_by_dream=0,
          deleted_at=CASE WHEN deleted_by_stop=0 AND EXISTS(
            SELECT 1 FROM stops s JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
            WHERE s.id=dream_visits.stop_id AND s.vault_id=? AND s.deleted_at IS NULL
              AND s.visit_confirmed=1 AND s.kind IN ('visit','stay') AND t.deleted_at IS NULL AND t.status='saved')
            THEN NULL ELSE deleted_at END,updated_at=?
          WHERE dream_id=? AND vault_id=? AND deleted_by_dream=1`, this.vaultId, now, id, this.vaultId);
      }
    }));
  }

  async listVisitOptions(dreamId: string): Promise<DreamVisitOption[]> {
    uuid(dreamId, 'dream.id');
    return this.database.run(async connection => {
      if (!await this.read(connection, dreamId)) throw new DreamNotFoundError();
      const rows = await connection.getAllAsync<Omit<VisitRow, 'id' | 'dream_id' | 'linked_at'> & { stop_id: string }>(`
        SELECT s.id stop_id,p.id place_id,p.name place_name,t.id trip_id,t.title trip_title,
          CASE WHEN s.dates_json IS NOT NULL THEN s.dates_json ELSE t.dates_json END visit_dates_json
        FROM stops s JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
        JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
        WHERE s.vault_id=? AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
          AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status='saved'
          AND NOT EXISTS(SELECT 1 FROM dream_visits dv WHERE dv.dream_id=? AND dv.stop_id=s.id AND dv.deleted_at IS NULL)
        ORDER BY t.sort_date IS NULL,t.sort_date DESC,t.title COLLATE NOCASE,p.name COLLATE NOCASE,s.position,s.id`, this.vaultId, dreamId);
      return rows.map(row => ({ stopId: uuid(row.stop_id, 'stop.id'), placeId: uuid(row.place_id, 'place.id'), placeName: row.place_name,
        tripId: uuid(row.trip_id, 'trip.id'), tripTitle: row.trip_title, visitDates: parseDateSpec(JSON.parse(row.visit_dates_json)) }));
    });
  }

  linkVisit(dreamId: string, stopId: string): Promise<DreamVisit> {
    uuid(dreamId, 'dream.id'); uuid(stopId, 'stop.id');
    return this.committed(this.database.transaction(async connection => {
      const dream = await this.read(connection, dreamId); if (!dream || dream.isArchived) throw new DreamNotFoundError();
      const eligible = await connection.getFirstAsync<{ id: string }>(`SELECT s.id FROM stops s
        JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
        WHERE s.id=? AND s.vault_id=? AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
          AND t.deleted_at IS NULL AND t.status='saved' AND p.deleted_at IS NULL`, stopId, this.vaultId);
      if (!eligible) throw new Error('Choose a confirmed visit or stay from a saved Trip in this vault');
      const existing = await connection.getFirstAsync<{ id: string; deleted_at: string | null }>(`SELECT id,deleted_at FROM dream_visits
        WHERE dream_id=? AND stop_id=? AND vault_id=? ORDER BY updated_at DESC,id DESC LIMIT 1`, dreamId, stopId, this.vaultId);
      const now = this.timestamp(); let id: string;
      if (existing) {
        id = existing.id;
        if (existing.deleted_at !== null) await connection.runAsync(`UPDATE dream_visits SET linked_at=?,updated_at=?,deleted_at=NULL,deleted_by_dream=0,deleted_by_stop=0 WHERE id=?`, now, now, id);
      } else {
        id = uuid(this.newId(), 'dreamVisit.id');
        await connection.runAsync(`INSERT INTO dream_visits(id,vault_id,dream_id,stop_id,linked_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)`, id, this.vaultId, dreamId, stopId, now, now, now);
      }
      const row = await connection.getFirstAsync<VisitRow>(`${visitSelect} AND dv.id=?`, this.vaultId, id);
      if (!row) throw new Error('Dream visit could not be read after linking');
      return visitFromRow(row);
    }));
  }

  unlinkVisit(dreamId: string, visitId: string): Promise<void> {
    uuid(dreamId, 'dream.id'); uuid(visitId, 'dreamVisit.id');
    return this.committed(this.database.transaction(async connection => {
      if (!await this.read(connection, dreamId)) throw new DreamNotFoundError(); const now = this.timestamp();
      const result = await connection.runAsync(`UPDATE dream_visits SET deleted_at=?,updated_at=?,deleted_by_dream=0,deleted_by_stop=0
        WHERE id=? AND dream_id=? AND vault_id=? AND deleted_at IS NULL`, now, now, visitId, dreamId, this.vaultId);
      if (result.changes !== 1) throw new Error('Dream visit link not found');
    }));
  }
}
