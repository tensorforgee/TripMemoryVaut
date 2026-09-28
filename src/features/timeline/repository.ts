import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { orderedPosition } from '../../domain/stop';
import { parseTripDayFields, type TripDay, type TripDayFields } from '../../domain/trip-day';
import { keys, record, utcTimestamp, uuid } from '../../domain/validation';

type Row = { id: string; vault_id: string; trip_id: string; position: number; label: string | null;
  dates_json: string | null; created_at: string; updated_at: string; deleted_at: string | null };
function fromRow(row: Row): TripDay {
  return { ...parseTripDayFields({ label: row.label, dates: row.dates_json === null ? null : JSON.parse(row.dates_json) }),
    id: uuid(row.id, 'day.id'), vaultId: uuid(row.vault_id, 'vaultId'), tripId: uuid(row.trip_id, 'tripId'),
    position: orderedPosition(row.position), createdAt: utcTimestamp(row.created_at, 'createdAt'),
    updatedAt: utcTimestamp(row.updated_at, 'updatedAt'), deletedAt: row.deleted_at === null ? null : utcTimestamp(row.deleted_at, 'deletedAt') };
}
export class TimelineRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string,
    private readonly newId: () => string, private readonly now: () => string = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private timestamp() { return utcTimestamp(this.now(), 'now'); }
  private async activeTrip(c: SqlConnection, tripId: string): Promise<number> {
    const row = await c.getFirstAsync<{ order_revision: number }>(`SELECT t.order_revision FROM trips t JOIN vaults v ON v.id=t.vault_id
      WHERE t.id=? AND t.vault_id=? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`, uuid(tripId, 'tripId'), this.vaultId);
    if (!row) throw new Error('Trip unavailable. It may be in Trash.');
    return orderedPosition(row.order_revision);
  }
  private async write<T>(tripId: string, task: (c: SqlConnection) => Promise<T>): Promise<T> {
    const result = await this.database.transaction(async c => {
      await this.activeTrip(c, tripId);
      const result = await task(c);
      await c.runAsync('UPDATE trips SET order_revision=order_revision+1,updated_at=? WHERE id=? AND vault_id=?', this.timestamp(), tripId, this.vaultId);
      return result;
    });
    for (const listener of this.listeners) listener();
    return result;
  }
  private async rows(c: SqlConnection, tripId: string): Promise<TripDay[]> {
    return (await c.getAllAsync<Row>('SELECT * FROM trip_days WHERE vault_id=? AND trip_id=? AND deleted_at IS NULL ORDER BY position,id', this.vaultId, tripId)).map(fromRow);
  }
  getTimeline(tripId: string): Promise<{ revision: number; days: TripDay[] }> {
    return this.database.run(async c => ({ revision: await this.activeTrip(c, tripId), days: await this.rows(c, tripId) }));
  }
  async listTripDays(tripId: string): Promise<TripDay[]> { return (await this.getTimeline(tripId)).days; }
  private async read(c: SqlConnection, tripId: string, id: string): Promise<TripDay> {
    const row = await c.getFirstAsync<Row>('SELECT * FROM trip_days WHERE vault_id=? AND trip_id=? AND id=? AND deleted_at IS NULL', this.vaultId, tripId, uuid(id, 'dayId'));
    if (!row) throw new Error('Section unavailable in this trip');
    return fromRow(row);
  }
  private async nextPosition(c: SqlConnection, tripId: string) {
    const row = await c.getFirstAsync<{ position: number }>('SELECT COALESCE(MAX(position),-1)+1 AS position FROM trip_days WHERE trip_id=? AND deleted_at IS NULL', tripId);
    return orderedPosition(row!.position);
  }
  createTripDay(tripId: string, input: Partial<TripDayFields> = {}): Promise<TripDay> {
    const fields = parseTripDayFields({ label: null, dates: null, ...input });
    return this.write(tripId, async c => {
      const id = uuid(this.newId(), 'day.id');
      const timestamp = this.timestamp();
      await c.runAsync('INSERT INTO trip_days(id,vault_id,trip_id,position,label,dates_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        id,this.vaultId,tripId,await this.nextPosition(c, tripId),fields.label,fields.dates === null ? null : JSON.stringify(fields.dates),timestamp,timestamp);
      return this.read(c, tripId, id);
    });
  }
  updateTripDay(tripId: string, id: string, patch: Partial<TripDayFields>): Promise<TripDay> {
    return this.write(tripId, async c => {
      const current = await this.read(c, tripId, id);
      const value = record(patch, 'tripDay'); keys(value, ['label', 'dates'], 'tripDay');
      const fields = parseTripDayFields({ label: current.label, dates: current.dates, ...value });
      await c.runAsync('UPDATE trip_days SET label=?,dates_json=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=?',
        fields.label,fields.dates === null ? null : JSON.stringify(fields.dates),this.timestamp(),id,tripId,this.vaultId);
      return this.read(c, tripId, id);
    });
  }
  private async position(c: SqlConnection, tripId: string, ids: string[]) {
    const temporary = orderedPosition(await this.nextPosition(c, tripId) + ids.length);
    orderedPosition(temporary + ids.length);
    for (const [index, id] of ids.entries()) await c.runAsync('UPDATE trip_days SET position=? WHERE id=? AND trip_id=? AND vault_id=?', temporary+index,id,tripId,this.vaultId);
    for (const [index, id] of ids.entries()) await c.runAsync('UPDATE trip_days SET position=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=?', index,this.timestamp(),id,tripId,this.vaultId);
  }
  reorderTripDays(tripId: string, ids: string[], expectedRevision: number): Promise<void> {
    return this.write(tripId, async c => {
      if (await this.activeTrip(c, tripId) !== orderedPosition(expectedRevision)) throw new Error('Timeline changed. Reload before reordering.');
      const current = await this.rows(c, tripId);
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== current.length || ids.some(id => !current.some(day => day.id === id))) {
        throw new Error('Reorder must include every active section exactly once');
      }
      await this.position(c, tripId, ids);
    });
  }
  removeTripDay(tripId: string, id: string): Promise<void> {
    return this.write(tripId, async c => {
      await this.read(c, tripId, id);
      const timestamp = this.timestamp();
      // Include removed Stops so they can later be restored safely at trip level.
      await c.runAsync('UPDATE stops SET day_id=NULL,updated_at=? WHERE day_id=? AND trip_id=? AND vault_id=?', timestamp,id,tripId,this.vaultId);
      await c.runAsync('UPDATE trip_days SET deleted_at=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=?', timestamp,timestamp,id,tripId,this.vaultId);
      await this.position(c, tripId, (await this.rows(c, tripId)).map(day => day.id));
    });
  }
  restoreTripDay(tripId: string, id: string): Promise<void> {
    return this.write(tripId, async c => {
      const result = await c.runAsync('UPDATE trip_days SET deleted_at=NULL,position=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NOT NULL',
        await this.nextPosition(c, tripId),this.timestamp(),uuid(id, 'dayId'),tripId,this.vaultId);
      if (result.changes !== 1) throw new Error('Removed section unavailable');
    });
  }
  assignStop(tripId: string, stopId: string, dayId: string | null): Promise<void> {
    return this.write(tripId, async c => {
      if (dayId !== null) await this.read(c, tripId, dayId);
      const result = await c.runAsync('UPDATE stops SET day_id=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NULL',
        dayId,this.timestamp(),uuid(stopId, 'stopId'),tripId,this.vaultId);
      if (result.changes !== 1) throw new Error('Stop unavailable in this trip');
    });
  }
  moveStop(tripId: string, stopId: string, dayId: string): Promise<void> { return this.assignStop(tripId, stopId, dayId); }
  unassignStop(tripId: string, stopId: string): Promise<void> { return this.assignStop(tripId, stopId, null); }
}
