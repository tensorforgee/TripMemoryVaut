// Manual associations, never historical visits or corrections to photo evidence.
export const photoMemoryPinsSchema = `
CREATE TABLE photo_memory_pins (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  note TEXT CHECK(note IS NULL OR length(note)<=10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,media_id) REFERENCES media(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX photo_pins_trip ON photo_memory_pins(vault_id,trip_id,deleted_at,id);
CREATE INDEX photo_pins_media ON photo_memory_pins(vault_id,media_id);
CREATE TRIGGER photo_pins_insert BEFORE INSERT ON photo_memory_pins
WHEN NOT EXISTS(SELECT 1 FROM trips t JOIN vaults v ON v.id=t.vault_id
  JOIN media m ON m.vault_id=v.id AND m.id=NEW.media_id
  WHERE t.id=NEW.trip_id AND t.vault_id=NEW.vault_id
    AND t.deleted_at IS NULL AND v.deleted_at IS NULL AND m.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Photo memory requires active trip and media in the same vault'); END;
CREATE TRIGGER photo_pins_update BEFORE UPDATE ON photo_memory_pins
WHEN NEW.id<>OLD.id OR NEW.vault_id<>OLD.vault_id OR NEW.trip_id<>OLD.trip_id
  OR NOT EXISTS(SELECT 1 FROM trips t JOIN vaults v ON v.id=t.vault_id
    JOIN media m ON m.vault_id=v.id AND m.id=NEW.media_id
    WHERE t.id=NEW.trip_id AND t.vault_id=NEW.vault_id
      AND t.deleted_at IS NULL AND v.deleted_at IS NULL AND m.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Photo memory requires active immutable ownership'); END;
CREATE TRIGGER photo_pins_protect_media BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM photo_memory_pins WHERE vault_id=OLD.vault_id AND media_id=OLD.id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a photo memory'); END;
`;
