import { dateSortKey, unknownDates } from '../../domain/date-spec';
import { parseTrip, parseTripFields, parseTripPatch, type CreateTripDraft, type Trip, type TripFields, type TripPatch } from '../../domain/trip';
import { keys, record, utcTimestamp, uuid, ValidationError } from '../../domain/validation';
import type { LocalDatabase, SqlConnection } from '../../core/database/database';

type TripRow = {
  id: string; vault_id: string; title: string; status: string; dates_json: string;
  duration_estimate_days: number | null; summary: string | null; is_favourite: number;
  created_at: string; updated_at: string; deleted_at: string | null;
};

function fromRow(row: TripRow): Trip {
  if (row.is_favourite !== 0 && row.is_favourite !== 1) throw new Error('Invalid stored favourite flag');
  return parseTrip({
    id: row.id, vaultId: row.vault_id, title: row.title, status: row.status, dates: JSON.parse(row.dates_json),
    durationEstimateDays: row.duration_estimate_days, summary: row.summary, isFavourite: row.is_favourite === 1,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  });
}

const activeTrip = `SELECT t.* FROM trips t JOIN vaults v ON v.id = t.vault_id
  WHERE t.vault_id = ? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`;

export class TripNotFoundError extends Error {
  constructor() { super('Trip not found in the active vault'); this.name = 'TripNotFoundError'; }
}

export class TripRepository {
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private async committed<T>(operation: Promise<T>): Promise<T> {
    const result = await operation;
    for (const listener of this.listeners) listener();
    return result;
  }
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string,
    private readonly newId: () => string, private readonly now: () => string = () => new Date().toISOString()) {
    uuid(vaultId, 'vaultId');
  }

  private async read(connection: SqlConnection, id: string): Promise<Trip | null> {
    const row = await connection.getFirstAsync<TripRow>(`${activeTrip} AND t.id = ?`, this.vaultId, id);
    return row ? fromRow(row) : null;
  }

  async createTripDraft(input: CreateTripDraft): Promise<Trip> {
    const value = record(input, 'draft');
    keys(value, ['title', 'dates', 'summary', 'durationEstimateDays', 'isFavourite'], 'draft');
    const fields = parseTripFields({ dates: unknownDates(), summary: null, durationEstimateDays: null, isFavourite: false, ...value, status: 'draft' });
    const id = uuid(this.newId(), 'trip.id');
    const now = utcTimestamp(this.now(), 'now');
    const sort = dateSortKey(fields.dates);
    return this.committed(this.database.transaction(async connection => {
      await connection.runAsync(`INSERT INTO trips(id, vault_id, title, status, dates_json, sort_date, sort_precision,
        duration_estimate_days, summary, is_favourite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, this.vaultId, fields.title, fields.status, JSON.stringify(fields.dates), sort.sortDate, sort.sortPrecision,
      fields.durationEstimateDays, fields.summary, Number(fields.isFavourite), now, now);
      return (await this.read(connection, id))!;
    }));
  }

  getTripById(id: string): Promise<Trip | null> {
    uuid(id, 'trip.id');
    return this.database.run(connection => this.read(connection, id));
  }

  listTrips(options: { status?: TripFields['status']; limit?: number; offset?: number } = {}): Promise<Trip[]> {
    const { status, limit = 50, offset = 0 } = options;
    if (status !== undefined && status !== 'draft' && status !== 'saved') throw new ValidationError('status', 'is invalid');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new ValidationError('pagination', 'requires limit 1–100 and a nonnegative offset');
    }
    return this.database.run(async connection => {
      const rows = await connection.getAllAsync<TripRow>(`${activeTrip}${status ? ' AND t.status = ?' : ''}
        ORDER BY t.sort_date IS NULL, t.sort_date DESC, t.id ASC LIMIT ? OFFSET ?`,
      this.vaultId, ...(status ? [status] : []), limit, offset);
      return rows.map(fromRow);
    });
  }

  updateBasicTripFields(id: string, patch: TripPatch): Promise<Trip> {
    uuid(id, 'trip.id');
    return this.committed(this.database.transaction(async connection => {
      const current = await this.read(connection, id);
      if (!current) throw new TripNotFoundError();
      const fields = parseTripPatch(patch, current);
      const sort = dateSortKey(fields.dates);
      await connection.runAsync(`UPDATE trips SET title = ?, status = ?, dates_json = ?, sort_date = ?, sort_precision = ?,
        duration_estimate_days = ?, summary = ?, is_favourite = ?, updated_at = ? WHERE id = ? AND vault_id = ? AND deleted_at IS NULL`,
      fields.title, fields.status, JSON.stringify(fields.dates), sort.sortDate, sort.sortPrecision,
      fields.durationEstimateDays, fields.summary, Number(fields.isFavourite), utcTimestamp(this.now(), 'now'), id, this.vaultId);
      return (await this.read(connection, id))!;
    }));
  }

  listDeletedTrips(limit = 50, offset = 0): Promise<Trip[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new ValidationError('pagination', 'requires limit 1–100 and a nonnegative offset');
    }
    return this.database.run(async connection => (await connection.getAllAsync<TripRow>(
      `SELECT t.* FROM trips t JOIN vaults v ON v.id = t.vault_id
       WHERE t.vault_id = ? AND t.deleted_at IS NOT NULL AND v.deleted_at IS NULL
       ORDER BY t.deleted_at DESC, t.id ASC LIMIT ? OFFSET ?`, this.vaultId, limit, offset)).map(fromRow));
  }

  trashTrip(id: string): Promise<void> { return this.setDeleted(id, true); }
  restoreTrip(id: string): Promise<void> { return this.setDeleted(id, false); }

  private setDeleted(id: string, deleted: boolean): Promise<void> {
    uuid(id, 'trip.id');
    return this.committed(this.database.transaction(async connection => {
      const now = utcTimestamp(this.now(), 'now');
      const result = await connection.runAsync(`UPDATE trips SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND vault_id = ? AND deleted_at IS ${deleted ? '' : 'NOT '}NULL
        AND EXISTS (SELECT 1 FROM vaults WHERE id = ? AND deleted_at IS NULL)`,
      deleted ? now : null, now, id, this.vaultId, this.vaultId);
      if (result.changes !== 1) throw new TripNotFoundError();
      if (deleted) {
        await connection.runAsync(`UPDATE stops SET deleted_at=?,updated_at=?,deleted_by_trip=1
          WHERE trip_id=? AND vault_id=? AND deleted_at IS NULL`, now, now, id, this.vaultId);
      } else {
        await connection.runAsync(`UPDATE stops SET deleted_at=NULL,updated_at=?,deleted_by_trip=0
          WHERE trip_id=? AND vault_id=? AND deleted_by_trip=1`, now, id, this.vaultId);
      }
    }));
  }
}
