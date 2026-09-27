// Immutable after release. Only the local Places/Stops vertical slice.
export const placesStopsSchema = `
ALTER TABLE trips ADD COLUMN order_revision INTEGER NOT NULL DEFAULT 0 CHECK (order_revision >= 0);

CREATE TABLE places (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  latitude REAL,
  longitude REAL,
  coordinate_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (coordinate_precision IN ('unknown','point','area')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','exif','provider','import')),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(vault_id, id),
  CHECK ((latitude IS NULL AND longitude IS NULL AND coordinate_precision = 'unknown') OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
) STRICT;
CREATE INDEX places_vault_name ON places(vault_id, name, id);
CREATE INDEX places_coordinates ON places(vault_id, latitude, longitude);

CREATE TABLE stops (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  trip_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0 AND position <= 9007199254740991),
  kind TEXT NOT NULL DEFAULT 'visit' CHECK (kind IN ('visit','stay','transit')),
  visit_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (visit_confirmed IN (0,1)),
  detail_certainty TEXT NOT NULL DEFAULT 'unknown' CHECK (detail_certainty IN ('exact','approximate','unknown')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','photo_suggestion','import')),
  dates_json TEXT CHECK (dates_json IS NULL OR (json_valid(dates_json) AND json_type(dates_json) = 'object')),
  note TEXT CHECK (note IS NULL OR length(trim(note)) > 0),
  lodging_label TEXT CHECK (lodging_label IS NULL OR length(trim(lodging_label)) > 0),
  checkout_dates_json TEXT CHECK (checkout_dates_json IS NULL OR (json_valid(checkout_dates_json) AND json_type(checkout_dates_json) = 'object')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_trip INTEGER NOT NULL DEFAULT 0 CHECK (deleted_by_trip IN (0,1)),
  CHECK (deleted_by_trip = 0 OR deleted_at IS NOT NULL),
  CHECK (kind = 'stay' OR (lodging_label IS NULL AND checkout_dates_json IS NULL)),
  UNIQUE(vault_id, trip_id, id),
  FOREIGN KEY(vault_id, trip_id) REFERENCES trips(vault_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id, place_id) REFERENCES places(vault_id, id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX stops_active_position ON stops(trip_id, position) WHERE deleted_at IS NULL;
CREATE INDEX stops_trip_order ON stops(trip_id, deleted_at, position, id);
CREATE INDEX stops_place ON stops(place_id, deleted_at, trip_id);
CREATE INDEX stops_vault_trip ON stops(vault_id, trip_id);
CREATE INDEX stops_vault_place ON stops(vault_id, place_id);

CREATE TRIGGER places_live_vault_insert BEFORE INSERT ON places
WHEN NOT EXISTS (SELECT 1 FROM vaults WHERE id = NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Place requires an active vault'); END;
CREATE TRIGGER places_live_vault_update BEFORE UPDATE ON places
WHEN NOT EXISTS (SELECT 1 FROM vaults WHERE id = NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Place requires an active vault'); END;
CREATE TRIGGER places_referenced_delete BEFORE UPDATE OF deleted_at ON places
WHEN NEW.deleted_at IS NOT NULL AND EXISTS
  (SELECT 1 FROM stops WHERE place_id = OLD.id AND (deleted_at IS NULL OR deleted_by_trip = 1))
BEGIN SELECT RAISE(ABORT, 'Place is referenced by active or recoverable trip stops'); END;

CREATE TRIGGER stops_live_parents_insert BEFORE INSERT ON stops
WHEN NOT EXISTS (SELECT 1 FROM trips t JOIN vaults v ON v.id = t.vault_id
  JOIN places p ON p.vault_id = t.vault_id AND p.id = NEW.place_id
  WHERE t.id = NEW.trip_id AND t.vault_id = NEW.vault_id
  AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Stop requires an active trip and place in the same vault'); END;
CREATE TRIGGER stops_live_parents_update BEFORE UPDATE ON stops
WHEN NEW.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM trips t JOIN vaults v ON v.id = t.vault_id
  JOIN places p ON p.vault_id = t.vault_id AND p.id = NEW.place_id
  WHERE t.id = NEW.trip_id AND t.vault_id = NEW.vault_id
  AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Stop requires an active trip and place in the same vault'); END;
`;
