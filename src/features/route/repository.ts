import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { parsePlaceFields, placeFields, type CreatePlace, type Place, type PlaceFields } from '../../domain/place';
import { orderedPosition, parseStopFields, stopFields, type CreateStop, type Stop, type StopFields } from '../../domain/stop';
import { keys, record, utcTimestamp, uuid } from '../../domain/validation';

type PlaceRow = { id: string; vault_id: string; name: string; latitude: number | null; longitude: number | null;
  coordinate_precision: string; source: string; provenance_json: string; aliases_json: string;
  created_at: string; updated_at: string; deleted_at: string | null };
type StopRow = { id: string; vault_id: string; trip_id: string; place_id: string; position: number;
  kind: string; visit_confirmed: number; detail_certainty: string; source: string; dates_json: string | null;
  note: string | null; lodging_label: string | null; checkout_dates_json: string | null;
  created_at: string; updated_at: string; deleted_at: string | null; place_json: string };
export type RouteStop = Stop & { place: Place };
export type TripRoute = { revision: number; stops: RouteStop[] };

function placeFromRow(row: PlaceRow): Place {
  return { ...parsePlaceFields({ name: row.name, latitude: row.latitude, longitude: row.longitude,
    coordinatePrecision: row.coordinate_precision, source: row.source, provenance: JSON.parse(row.provenance_json), aliases: JSON.parse(row.aliases_json) }),
    id: uuid(row.id, 'place.id'), vaultId: uuid(row.vault_id, 'vaultId'), createdAt: utcTimestamp(row.created_at, 'createdAt'),
    updatedAt: utcTimestamp(row.updated_at, 'updatedAt'), deletedAt: row.deleted_at === null ? null : utcTimestamp(row.deleted_at, 'deletedAt') };
}
function stopFromRow(row: StopRow): RouteStop {
  if (row.visit_confirmed !== 0 && row.visit_confirmed !== 1) throw new Error('Invalid confirmation flag');
  return { ...parseStopFields({ placeId: row.place_id, kind: row.kind, visitConfirmed: row.visit_confirmed === 1,
    detailCertainty: row.detail_certainty, source: row.source, dates: row.dates_json === null ? null : JSON.parse(row.dates_json),
    note: row.note, lodgingLabel: row.lodging_label, checkoutDates: row.checkout_dates_json === null ? null : JSON.parse(row.checkout_dates_json) }),
    id: uuid(row.id, 'stop.id'), vaultId: uuid(row.vault_id, 'vaultId'), tripId: uuid(row.trip_id, 'tripId'), position: orderedPosition(row.position),
    createdAt: utcTimestamp(row.created_at, 'createdAt'), updatedAt: utcTimestamp(row.updated_at, 'updatedAt'),
    deletedAt: row.deleted_at === null ? null : utcTimestamp(row.deleted_at, 'deletedAt'), place: placeFromRow(JSON.parse(row.place_json)) };
}
const placeSelect = `SELECT p.* FROM places p JOIN vaults v ON v.id = p.vault_id
  WHERE p.vault_id = ? AND p.deleted_at IS NULL AND v.deleted_at IS NULL`;
const stopSelect = `SELECT s.*, json_object('id',p.id,'vault_id',p.vault_id,'name',p.name,
  'latitude',p.latitude,'longitude',p.longitude,'coordinate_precision',p.coordinate_precision,
  'source',p.source,'provenance_json',p.provenance_json,'aliases_json',p.aliases_json,
  'created_at',p.created_at,'updated_at',p.updated_at,'deleted_at',p.deleted_at) AS place_json
  FROM stops s JOIN places p ON p.id = s.place_id AND p.vault_id = s.vault_id
  JOIN trips t ON t.id = s.trip_id AND t.vault_id = s.vault_id JOIN vaults v ON v.id = s.vault_id
  WHERE s.vault_id = ? AND s.trip_id = ? AND s.deleted_at IS NULL
  AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND v.deleted_at IS NULL`;
const jsonDate = (date: StopFields['dates']) => date === null ? null : JSON.stringify(date);

// One small repository owns the Place/Stop workflow so create-place + add-stop is atomic.
export class RouteRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string,
    private readonly newId: () => string, private readonly now: () => string = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private async write<T>(task: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const result = await this.database.transaction(task);
    for (const listener of this.listeners) listener();
    return result;
  }
  private timestamp() { return utcTimestamp(this.now(), 'now'); }
  private async activeTrip(connection: SqlConnection, tripId: string): Promise<number> {
    uuid(tripId, 'tripId');
    const trip = await connection.getFirstAsync<{ order_revision: number }>(`SELECT t.order_revision FROM trips t JOIN vaults v ON v.id = t.vault_id
      WHERE t.id = ? AND t.vault_id = ? AND t.deleted_at IS NULL AND v.deleted_at IS NULL`, tripId, this.vaultId);
    if (!trip) throw new Error('Trip unavailable. It may be in Trash.');
    return orderedPosition(trip.order_revision);
  }
  private async touchTrip(connection: SqlConnection, tripId: string) {
    await connection.runAsync('UPDATE trips SET order_revision = order_revision + 1, updated_at = ? WHERE id = ? AND vault_id = ?', this.timestamp(), tripId, this.vaultId);
  }
  private async readPlace(connection: SqlConnection, id: string): Promise<Place | null> {
    const row = await connection.getFirstAsync<PlaceRow>(`${placeSelect} AND p.id = ?`, this.vaultId, uuid(id, 'placeId'));
    return row ? placeFromRow(row) : null;
  }
  getPlace(id: string): Promise<Place | null> { return this.database.run(connection => this.readPlace(connection, id)); }
  listPlaces(query = '', limit = 50, offset = 0): Promise<Place[]> {
    if (typeof query !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid local place query');
    const pattern = `%${query.trim().replace(/[!%_]/g, value => `!${value}`)}%`;
    return this.database.run(async connection => (await connection.getAllAsync<PlaceRow>(`${placeSelect}
      AND p.name LIKE ? ESCAPE '!' ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`, this.vaultId, pattern, limit, offset)).map(placeFromRow));
  }
  private async insertPlace(connection: SqlConnection, input: CreatePlace): Promise<Place> {
    const fields = placeFields(input);
    const id = uuid(this.newId(), 'place.id');
    const timestamp = this.timestamp();
    await connection.runAsync(`INSERT INTO places(id,vault_id,name,latitude,longitude,coordinate_precision,source,provenance_json,aliases_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, this.vaultId, fields.name, fields.latitude, fields.longitude, fields.coordinatePrecision,
    fields.source, JSON.stringify(fields.provenance), JSON.stringify(fields.aliases), timestamp, timestamp);
    return (await this.readPlace(connection, id))!;
  }
  createPlace(input: CreatePlace): Promise<Place> { return this.write(connection => this.insertPlace(connection, input)); }
  updatePlace(id: string, patch: Partial<PlaceFields>): Promise<Place> {
    return this.write(async connection => {
      const current = await this.readPlace(connection, id);
      if (!current) throw new Error('Place unavailable');
      const value = record(patch, 'place');
      keys(value, ['name','latitude','longitude','coordinatePrecision','source','provenance','aliases'], 'place');
      const { id: _id, vaultId: _vault, createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...before } = current;
      const fields = parsePlaceFields({ ...before, ...value });
      await connection.runAsync(`UPDATE places SET name=?,latitude=?,longitude=?,coordinate_precision=?,source=?,provenance_json=?,aliases_json=?,updated_at=?
        WHERE id=? AND vault_id=? AND deleted_at IS NULL`, fields.name, fields.latitude, fields.longitude, fields.coordinatePrecision,
      fields.source, JSON.stringify(fields.provenance), JSON.stringify(fields.aliases), this.timestamp(), id, this.vaultId);
      return (await this.readPlace(connection, id))!;
    });
  }
  trashPlace(id: string): Promise<void> {
    return this.write(async connection => {
      if (!await this.readPlace(connection, id)) throw new Error('Place unavailable');
      // The schema also rejects references from recoverable trashed trips.
      const timestamp = this.timestamp();
      await connection.runAsync('UPDATE places SET deleted_at=?,updated_at=? WHERE id=? AND vault_id=?', timestamp, timestamp, id, this.vaultId);
    });
  }
  private async readStops(connection: SqlConnection, tripId: string): Promise<RouteStop[]> {
    return (await connection.getAllAsync<StopRow>(`${stopSelect} ORDER BY s.position,s.id`, this.vaultId, tripId)).map(stopFromRow);
  }
  getRoute(tripId: string): Promise<TripRoute> {
    return this.database.run(async connection => ({ revision: await this.activeTrip(connection, tripId), stops: await this.readStops(connection, tripId) }));
  }
  async listStops(tripId: string): Promise<RouteStop[]> { return (await this.getRoute(tripId)).stops; }
  private async readStop(connection: SqlConnection, tripId: string, id: string): Promise<RouteStop> {
    uuid(id, 'stopId');
    const row = await connection.getFirstAsync<StopRow>(`${stopSelect} AND s.id = ?`, this.vaultId, tripId, id);
    if (!row) throw new Error('Stop unavailable in this trip');
    return stopFromRow(row);
  }
  getStop(tripId: string, id: string): Promise<RouteStop> {
    return this.database.run(async connection => { await this.activeTrip(connection, tripId); return this.readStop(connection, tripId, id); });
  }
  private async insertStop(connection: SqlConnection, tripId: string, input: CreateStop): Promise<RouteStop> {
    await this.activeTrip(connection, tripId);
    const fields = stopFields(input);
    if (!await this.readPlace(connection, fields.placeId)) throw new Error('Place unavailable in this vault');
    const row = await connection.getFirstAsync<{ position: number }>('SELECT COALESCE(MAX(position),-1)+1 AS position FROM stops WHERE trip_id=? AND deleted_at IS NULL', tripId);
    const position = orderedPosition(row!.position);
    const id = uuid(this.newId(), 'stop.id');
    const timestamp = this.timestamp();
    await connection.runAsync(`INSERT INTO stops(id,vault_id,trip_id,place_id,position,kind,visit_confirmed,detail_certainty,source,dates_json,note,lodging_label,checkout_dates_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id,this.vaultId,tripId,fields.placeId,position,fields.kind,Number(fields.visitConfirmed),fields.detailCertainty,
    fields.source,jsonDate(fields.dates),fields.note,fields.lodgingLabel,jsonDate(fields.checkoutDates),timestamp,timestamp);
    await this.touchTrip(connection, tripId);
    return this.readStop(connection, tripId, id);
  }
  addStop(tripId: string, input: CreateStop): Promise<RouteStop> { return this.write(connection => this.insertStop(connection, tripId, input)); }
  createPlaceAndAddStop(tripId: string, place: CreatePlace, input: Omit<CreateStop, 'placeId'> = {}): Promise<RouteStop> {
    return this.write(async connection => {
      await this.activeTrip(connection, tripId);
      const created = await this.insertPlace(connection, place);
      return this.insertStop(connection, tripId, { ...input, placeId: created.id });
    });
  }
  editStop(tripId: string, id: string, patch: Partial<StopFields>): Promise<RouteStop> {
    return this.write(async connection => {
      await this.activeTrip(connection, tripId);
      const current = await this.readStop(connection, tripId, id);
      const value = record(patch, 'stop');
      keys(value, ['placeId','kind','visitConfirmed','detailCertainty','source','dates','note','lodgingLabel','checkoutDates'], 'stop');
      const { id: _id, vaultId: _vault, tripId: _trip, position: _position, createdAt: _created, updatedAt: _updated, deletedAt: _deleted, place: _place, ...before } = current;
      const fields = parseStopFields({ ...before, ...value });
      if (!await this.readPlace(connection, fields.placeId)) throw new Error('Place unavailable in this vault');
      await connection.runAsync(`UPDATE stops SET place_id=?,kind=?,visit_confirmed=?,detail_certainty=?,source=?,dates_json=?,note=?,lodging_label=?,checkout_dates_json=?,updated_at=?
        WHERE id=? AND trip_id=? AND vault_id=?`, fields.placeId,fields.kind,Number(fields.visitConfirmed),fields.detailCertainty,fields.source,jsonDate(fields.dates),
      fields.note,fields.lodgingLabel,jsonDate(fields.checkoutDates),this.timestamp(),id,tripId,this.vaultId);
      await this.touchTrip(connection, tripId);
      return this.readStop(connection, tripId, id);
    });
  }
  private async positionStops(connection: SqlConnection, tripId: string, ids: string[]): Promise<void> {
    const row = await connection.getFirstAsync<{ maximum: number }>('SELECT COALESCE(MAX(position),-1) AS maximum FROM stops WHERE trip_id=? AND deleted_at IS NULL', tripId);
    const temporaryStart = orderedPosition(row!.maximum + ids.length + 1);
    orderedPosition(temporaryStart + ids.length);
    const timestamp = this.timestamp();
    // Disjoint temporary values satisfy the active-position unique index at every statement.
    for (const [index, id] of ids.entries()) await connection.runAsync('UPDATE stops SET position=? WHERE id=? AND trip_id=? AND vault_id=?', temporaryStart + index, id, tripId, this.vaultId);
    for (const [index, id] of ids.entries()) await connection.runAsync('UPDATE stops SET position=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=?', index, timestamp, id, tripId, this.vaultId);
  }
  reorderStops(tripId: string, orderedIds: string[], expectedRevision: number): Promise<void> {
    return this.write(async connection => {
      const revision = await this.activeTrip(connection, tripId);
      if (revision !== orderedPosition(expectedRevision)) throw new Error('Route changed. Reload it before reordering.');
      const current = await this.readStops(connection, tripId);
      if (!Array.isArray(orderedIds) || orderedIds.length !== current.length || new Set(orderedIds).size !== current.length
        || orderedIds.some(id => !current.some(stop => stop.id === id))) throw new Error('Reorder must include every active stop in this trip exactly once');
      await this.positionStops(connection, tripId, orderedIds);
      await this.touchTrip(connection, tripId);
    });
  }
  removeStop(tripId: string, id: string): Promise<void> {
    return this.write(async connection => {
      await this.activeTrip(connection, tripId);
      await this.readStop(connection, tripId, id);
      const timestamp = this.timestamp();
      await connection.runAsync('UPDATE stops SET deleted_at=?,updated_at=?,deleted_by_trip=0 WHERE id=? AND trip_id=? AND vault_id=?', timestamp,timestamp,id,tripId,this.vaultId);
      await this.positionStops(connection, tripId, (await this.readStops(connection, tripId)).map(stop => stop.id));
      await this.touchTrip(connection, tripId);
    });
  }
  restoreStop(tripId: string, id: string): Promise<void> {
    uuid(id, 'stopId');
    return this.write(async connection => {
      await this.activeTrip(connection, tripId);
      const row = await connection.getFirstAsync<{ maximum: number }>('SELECT COALESCE(MAX(position),-1) AS maximum FROM stops WHERE trip_id=? AND deleted_at IS NULL', tripId);
      const result = await connection.runAsync(`UPDATE stops SET deleted_at=NULL,position=?,updated_at=? WHERE id=? AND trip_id=? AND vault_id=? AND deleted_at IS NOT NULL AND deleted_by_trip=0`,
        orderedPosition(row!.maximum + 1),this.timestamp(),id,tripId,this.vaultId);
      if (result.changes !== 1) throw new Error('Removed stop unavailable');
      await this.touchTrip(connection, tripId);
    });
  }
}
