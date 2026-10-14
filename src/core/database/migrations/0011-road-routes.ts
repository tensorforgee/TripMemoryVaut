// Confirmed generated geometry is separate from canonical Stops/Places.
export const roadRoutesSchema = `
CREATE TABLE road_route_segments (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  from_stop_id TEXT NOT NULL,
  to_stop_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version=1),
  input_json TEXT NOT NULL CHECK(json_valid(input_json) AND json_type(input_json)='object'),
  via_points_json TEXT NOT NULL CHECK(json_valid(via_points_json) AND json_type(via_points_json)='array'),
  geometry_json TEXT NOT NULL CHECK(json_valid(geometry_json) AND json_type(geometry_json)='object'),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json) AND json_type(provenance_json)='object'),
  distance_meters REAL CHECK(distance_meters IS NULL OR distance_meters>=0),
  confirmation_status TEXT NOT NULL CHECK(confirmation_status='confirmed'),
  confirmed_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK(from_stop_id<>to_stop_id),
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,trip_id,from_stop_id) REFERENCES stops(vault_id,trip_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,trip_id,to_stop_id) REFERENCES stops(vault_id,trip_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX road_routes_pair ON road_route_segments(vault_id,trip_id,from_stop_id,to_stop_id) WHERE deleted_at IS NULL;
CREATE INDEX road_routes_from ON road_route_segments(vault_id,trip_id,from_stop_id);
CREATE INDEX road_routes_to ON road_route_segments(vault_id,trip_id,to_stop_id);

-- Reordering uses temporary positions. Conservatively invalidate all generated
-- segments in that trip, even if the final reorder restores some old adjacency.
CREATE TRIGGER road_routes_stop_update AFTER UPDATE OF position,place_id,visit_confirmed,deleted_at ON stops
WHEN OLD.position IS NOT NEW.position OR OLD.place_id IS NOT NEW.place_id
  OR OLD.visit_confirmed IS NOT NEW.visit_confirmed OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN UPDATE road_route_segments SET stale=1 WHERE vault_id=OLD.vault_id AND trip_id=OLD.trip_id AND stale=0; END;
CREATE TRIGGER road_routes_stop_insert AFTER INSERT ON stops
BEGIN UPDATE road_route_segments SET stale=1 WHERE vault_id=NEW.vault_id AND trip_id=NEW.trip_id AND stale=0; END;
CREATE TRIGGER road_routes_place_update AFTER UPDATE OF latitude,longitude,deleted_at ON places
WHEN OLD.latitude IS NOT NEW.latitude OR OLD.longitude IS NOT NEW.longitude OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN UPDATE road_route_segments SET stale=1 WHERE vault_id=OLD.vault_id AND stale=0 AND
  (from_stop_id IN (SELECT id FROM stops WHERE place_id=OLD.id AND vault_id=OLD.vault_id)
   OR to_stop_id IN (SELECT id FROM stops WHERE place_id=OLD.id AND vault_id=OLD.vault_id)); END;
`;
