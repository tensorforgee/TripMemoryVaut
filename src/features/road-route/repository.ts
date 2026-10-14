import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { utcTimestamp, uuid } from '../../domain/validation';
import { canonicalCoordinate } from '../map/model';
import { parseProposal, sameInput, type RoadProposal, type SavedRoadRoute, type SegmentInput } from './model';

export type RoadRouteRow = { id: string; vault_id: string; trip_id: string; from_stop_id: string; to_stop_id: string;
  version: number; input_json: string; via_points_json: string; geometry_json: string; provenance_json: string;
  distance_meters: number | null; confirmation_status: string; confirmed_at: string; stale: number;
  created_at: string; updated_at: string; deleted_at: string | null };

export function roadRouteFromRow(row: RoadRouteRow): SavedRoadRoute {
  if (row.version !== 1 || row.confirmation_status !== 'confirmed' || ![0,1].includes(row.stale)) throw new Error('Invalid saved road route status/version.');
  uuid(row.vault_id, 'route vault'); uuid(row.from_stop_id, 'from Stop'); uuid(row.to_stop_id, 'to Stop');
  utcTimestamp(row.created_at, 'createdAt'); utcTimestamp(row.updated_at, 'updatedAt');
  if (row.deleted_at !== null) utcTimestamp(row.deleted_at, 'deletedAt');
  const proposal = parseProposal({ input: JSON.parse(row.input_json), viaPoints: JSON.parse(row.via_points_json),
    geometry: JSON.parse(row.geometry_json), provenance: JSON.parse(row.provenance_json), distanceMeters: row.distance_meters });
  if (proposal.input.fromStopId !== row.from_stop_id || proposal.input.toStopId !== row.to_stop_id) throw new Error('Road segment identity mismatch.');
  return { ...proposal, id: uuid(row.id, 'route id'), tripId: uuid(row.trip_id, 'tripId'),
    confirmedAt: utcTimestamp(row.confirmed_at, 'confirmedAt'), updatedAt: row.updated_at, stale: row.stale === 1 };
}

// Used inside the save transaction, never a separate preflight read that can race
// a Stop edit. Adjacency includes unknown and unconfirmed Stops as real gaps.
async function currentInput(c: SqlConnection, vaultId: string, tripId: string, input: SegmentInput): Promise<boolean> {
  const rows = await c.getAllAsync<{id:string; latitude:number|null; longitude:number|null; visit_confirmed:number}>(`
    SELECT s.id,p.latitude,p.longitude,s.visit_confirmed FROM stops s
    JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
    JOIN vaults v ON v.id=t.vault_id
    JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
    WHERE s.vault_id=? AND s.trip_id=? AND s.deleted_at IS NULL AND t.deleted_at IS NULL
    AND p.deleted_at IS NULL AND v.deleted_at IS NULL ORDER BY s.position,s.id`, vaultId, tripId);
  const index = rows.findIndex(row => row.id === input.fromStopId), a = rows[index], b = rows[index + 1];
  if (!a || !b || !a.visit_confirmed || !b.visit_confirmed) return false;
  const from = canonicalCoordinate(a.latitude, a.longitude), to = canonicalCoordinate(b.latitude, b.longitude);
  return !!from && !!to && sameInput(input, { fromStopId:a.id, toStopId:b.id, from, to });
}

export async function roadRouteIntegrity(c: SqlConnection, vaultId: string): Promise<number> {
  const rows = await c.getAllAsync<RoadRouteRow & { trip_deleted: string|null }>(`SELECT r.*,t.deleted_at AS trip_deleted FROM road_route_segments r
    JOIN trips t ON t.id=r.trip_id AND t.vault_id=r.vault_id WHERE r.vault_id=?`, vaultId);
  let issues = 0;
  for (const row of rows) {
    try {
      const route = roadRouteFromRow(row);
      if (!route.stale && row.deleted_at === null && row.trip_deleted === null && !await currentInput(c, vaultId, route.tripId, route.input)) issues++;
    } catch { issues++; }
  }
  return issues;
}

export class RoadRouteRepository {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string,
    private readonly newId: () => string, private readonly now = () => new Date().toISOString()) { uuid(vaultId, 'vaultId'); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  list(tripId: string): Promise<SavedRoadRoute[]> {
    uuid(tripId, 'tripId');
    return this.database.run(async c => (await c.getAllAsync<RoadRouteRow>(`SELECT r.* FROM road_route_segments r
      JOIN trips t ON t.id=r.trip_id AND t.vault_id=r.vault_id JOIN vaults v ON v.id=t.vault_id
      WHERE r.vault_id=? AND r.trip_id=? AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND v.deleted_at IS NULL
      ORDER BY r.created_at,r.id`, this.vaultId, tripId)).map(roadRouteFromRow));
  }
  async confirm(tripId: string, proposal: RoadProposal, expectedId: string | null, expectedUpdatedAt: string | null = null): Promise<void> {
    uuid(tripId, 'tripId'); const p = parseProposal(proposal);
    await this.database.transaction(async c => {
      if (!await currentInput(c, this.vaultId, tripId, p.input)) throw new Error('Stops changed. Discard this proposal and generate again.');
      const current = await c.getFirstAsync<RoadRouteRow>(`SELECT * FROM road_route_segments
        WHERE vault_id=? AND trip_id=? AND from_stop_id=? AND to_stop_id=? AND deleted_at IS NULL`, this.vaultId, tripId, p.input.fromStopId, p.input.toStopId);
      const payload = [JSON.stringify(p.input), JSON.stringify(p.viaPoints), JSON.stringify(p.geometry), JSON.stringify(p.provenance), p.distanceMeters] as const;
      // Replaying the same confirmation is a no-op; it cannot clear invalidation.
      if (current && current.stale === 0 && current.input_json === payload[0] && current.via_points_json === payload[1]
        && current.geometry_json === payload[2] && current.provenance_json === payload[3] && current.distance_meters === payload[4]) return;
      if ((current?.id ?? null) !== expectedId || (current && expectedUpdatedAt !== null && current.updated_at !== expectedUpdatedAt))
        throw new Error('Saved road route changed. Reload before replacing it.');
      const now = utcTimestamp(this.now(), 'now');
      if (current) await c.runAsync(`UPDATE road_route_segments SET input_json=?,via_points_json=?,geometry_json=?,provenance_json=?,distance_meters=?,
        confirmed_at=?,updated_at=?,stale=0 WHERE id=? AND vault_id=?`, ...payload, now, now, current.id, this.vaultId);
      else await c.runAsync(`INSERT INTO road_route_segments(id,vault_id,trip_id,from_stop_id,to_stop_id,version,input_json,via_points_json,geometry_json,provenance_json,
        distance_meters,confirmation_status,confirmed_at,stale,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,1,?,?,?,?,?,'confirmed',?,0,?,?,NULL)`,
        uuid(this.newId(), 'route id'), this.vaultId, tripId, p.input.fromStopId, p.input.toStopId, ...payload, now, now, now);
    });
    for (const listener of this.listeners) listener();
  }
}
