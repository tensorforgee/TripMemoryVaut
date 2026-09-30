// Step 10: private Dream Places and explicit fulfilled-visit links.
export const dreamPlacesSchema = `
CREATE UNIQUE INDEX stops_vault_id ON stops(vault_id,id);

CREATE TABLE dream_destinations (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  place_id TEXT NOT NULL,
  added_dates_json TEXT NOT NULL CHECK(json_valid(added_dates_json) AND json_type(added_dates_json)='object'),
  note TEXT CHECK(note IS NULL OR length(trim(note)) > 0),
  location_text TEXT CHECK(location_text IS NULL OR length(trim(location_text)) > 0),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,place_id) REFERENCES places(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX dream_destinations_active_place ON dream_destinations(vault_id,place_id) WHERE deleted_at IS NULL;
CREATE INDEX dream_destinations_vault_status ON dream_destinations(vault_id,is_archived,deleted_at,created_at,id);
CREATE INDEX dream_destinations_place ON dream_destinations(place_id,deleted_at);

CREATE TABLE dream_visits (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  dream_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_dream INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_dream IN (0,1)),
  deleted_by_stop INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_stop IN (0,1)),
  CHECK((deleted_by_dream=0 AND deleted_by_stop=0) OR deleted_at IS NOT NULL),
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,dream_id) REFERENCES dream_destinations(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,stop_id) REFERENCES stops(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX dream_visits_active_pair ON dream_visits(dream_id,stop_id) WHERE deleted_at IS NULL;
CREATE INDEX dream_visits_dream ON dream_visits(dream_id,deleted_at,linked_at,id);
CREATE INDEX dream_visits_stop ON dream_visits(stop_id,deleted_at,dream_id);
CREATE INDEX dream_visits_vault_dream ON dream_visits(vault_id,dream_id);
CREATE INDEX dream_visits_vault_stop ON dream_visits(vault_id,stop_id);

CREATE TRIGGER dream_destinations_live_insert BEFORE INSERT ON dream_destinations
WHEN NOT EXISTS(
  SELECT 1 FROM places p JOIN vaults v ON v.id=p.vault_id
  WHERE p.id=NEW.place_id AND p.vault_id=NEW.vault_id AND p.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Dream requires an active Place in the same vault'); END;
CREATE TRIGGER dream_destinations_live_update BEFORE UPDATE ON dream_destinations
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM places p JOIN vaults v ON v.id=p.vault_id
  WHERE p.id=NEW.place_id AND p.vault_id=NEW.vault_id AND p.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Dream requires an active Place in the same vault'); END;

CREATE TRIGGER dream_visits_live_insert BEFORE INSERT ON dream_visits
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM dream_destinations d
  JOIN stops s ON s.vault_id=d.vault_id
  JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
  JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
  JOIN vaults v ON v.id=d.vault_id
  WHERE d.id=NEW.dream_id AND s.id=NEW.stop_id AND d.vault_id=NEW.vault_id
    AND d.deleted_at IS NULL AND d.is_archived=0 AND s.deleted_at IS NULL
    AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
    AND t.deleted_at IS NULL AND t.status='saved' AND p.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Dream visit requires active same-vault Dream and confirmed saved-Trip Stop'); END;
CREATE TRIGGER dream_visits_live_update BEFORE UPDATE ON dream_visits
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM dream_destinations d
  JOIN stops s ON s.vault_id=d.vault_id
  JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
  JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
  JOIN vaults v ON v.id=d.vault_id
  WHERE d.id=NEW.dream_id AND s.id=NEW.stop_id AND d.vault_id=NEW.vault_id
    AND d.deleted_at IS NULL AND d.is_archived=0 AND s.deleted_at IS NULL
    AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
    AND t.deleted_at IS NULL AND t.status='saved' AND p.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Dream visit requires active same-vault Dream and confirmed saved-Trip Stop'); END;

CREATE TRIGGER dream_visits_stop_removed AFTER UPDATE OF deleted_at ON stops
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE dream_visits SET deleted_at=COALESCE(deleted_at,NEW.deleted_at),updated_at=NEW.updated_at,deleted_by_stop=1
  WHERE stop_id=NEW.id AND vault_id=NEW.vault_id
    AND (deleted_at IS NULL OR deleted_by_dream=1 OR deleted_by_stop=1);
END;
CREATE TRIGGER dream_visits_stop_restored AFTER UPDATE OF deleted_at ON stops
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  UPDATE dream_visits SET deleted_by_stop=0,
    deleted_at=CASE WHEN deleted_by_dream=0 AND EXISTS(
      SELECT 1 FROM dream_destinations d WHERE d.id=dream_visits.dream_id
        AND d.vault_id=dream_visits.vault_id AND d.deleted_at IS NULL AND d.is_archived=0) THEN NULL ELSE deleted_at END,
    updated_at=NEW.updated_at
  WHERE stop_id=NEW.id AND vault_id=NEW.vault_id AND deleted_by_stop=1;
END;

DROP TRIGGER places_referenced_delete;
CREATE TRIGGER places_referenced_delete BEFORE UPDATE OF deleted_at ON places
WHEN NEW.deleted_at IS NOT NULL AND (
  EXISTS(SELECT 1 FROM stops WHERE place_id=OLD.id AND (deleted_at IS NULL OR deleted_by_trip=1)) OR
  EXISTS(SELECT 1 FROM dream_destinations WHERE place_id=OLD.id AND deleted_at IS NULL)
)
BEGIN SELECT RAISE(ABORT,'Place is referenced by an active or recoverable Trip/Dream'); END;
`;
