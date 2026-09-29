// Step 8: private reusable Companion labels and curated Life Chapters.
export const companionsChaptersSchema = `
CREATE TABLE companions (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK(length(trim(label)) > 0),
  note TEXT CHECK(note IS NULL OR length(trim(note)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(vault_id,id)
) STRICT;
CREATE INDEX companions_vault_label ON companions(vault_id,label,id);

CREATE TABLE trip_companions (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  trip_id TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_trip INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_trip IN (0,1)),
  deleted_by_companion INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_companion IN (0,1)),
  CHECK((deleted_by_trip=0 AND deleted_by_companion=0) OR deleted_at IS NOT NULL),
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,companion_id) REFERENCES companions(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX trip_companions_active_pair ON trip_companions(trip_id,companion_id) WHERE deleted_at IS NULL;
CREATE INDEX trip_companions_companion_trip ON trip_companions(companion_id,trip_id);
CREATE INDEX trip_companions_trip ON trip_companions(trip_id,deleted_at,companion_id);
CREATE INDEX trip_companions_vault_trip ON trip_companions(vault_id,trip_id);
CREATE INDEX trip_companions_vault_companion ON trip_companions(vault_id,companion_id);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  normalized_name TEXT NOT NULL CHECK(length(trim(normalized_name)) > 0),
  description TEXT CHECK(description IS NULL OR length(trim(description)) > 0),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(vault_id,id)
) STRICT;
CREATE UNIQUE INDEX chapters_active_name ON chapters(vault_id,normalized_name) WHERE deleted_at IS NULL;
CREATE INDEX chapters_vault_order ON chapters(vault_id,deleted_at,position,id);

CREATE TABLE trip_chapters (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  trip_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_trip INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_trip IN (0,1)),
  deleted_by_chapter INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_chapter IN (0,1)),
  CHECK((deleted_by_trip=0 AND deleted_by_chapter=0) OR deleted_at IS NOT NULL),
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,chapter_id) REFERENCES chapters(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX trip_chapters_active_pair ON trip_chapters(trip_id,chapter_id) WHERE deleted_at IS NULL;
CREATE INDEX trip_chapters_chapter_order ON trip_chapters(chapter_id,position,trip_id);
CREATE INDEX trip_chapters_trip ON trip_chapters(trip_id,deleted_at,chapter_id);
CREATE INDEX trip_chapters_vault_trip ON trip_chapters(vault_id,trip_id);
CREATE INDEX trip_chapters_vault_chapter ON trip_chapters(vault_id,chapter_id);

CREATE TRIGGER companions_live_vault_insert BEFORE INSERT ON companions
WHEN NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Companion requires an active vault'); END;
CREATE TRIGGER companions_live_vault_update BEFORE UPDATE ON companions
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Companion requires an active vault'); END;
CREATE TRIGGER chapters_live_vault_insert BEFORE INSERT ON chapters
WHEN NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Chapter requires an active vault'); END;
CREATE TRIGGER chapters_live_vault_update BEFORE UPDATE ON chapters
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Chapter requires an active vault'); END;

CREATE TRIGGER trip_companions_live_insert BEFORE INSERT ON trip_companions
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM trips t JOIN companions c ON c.vault_id=t.vault_id JOIN vaults v ON v.id=t.vault_id
  WHERE t.id=NEW.trip_id AND c.id=NEW.companion_id AND t.vault_id=NEW.vault_id
    AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Companion membership requires active same-vault parents'); END;
CREATE TRIGGER trip_companions_live_update BEFORE UPDATE ON trip_companions
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM trips t JOIN companions c ON c.vault_id=t.vault_id JOIN vaults v ON v.id=t.vault_id
  WHERE t.id=NEW.trip_id AND c.id=NEW.companion_id AND t.vault_id=NEW.vault_id
    AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Companion membership requires active same-vault parents'); END;
CREATE TRIGGER trip_chapters_live_insert BEFORE INSERT ON trip_chapters
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM trips t JOIN chapters c ON c.vault_id=t.vault_id JOIN vaults v ON v.id=t.vault_id
  WHERE t.id=NEW.trip_id AND c.id=NEW.chapter_id AND t.vault_id=NEW.vault_id
    AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Chapter membership requires active same-vault parents'); END;
CREATE TRIGGER trip_chapters_live_update BEFORE UPDATE ON trip_chapters
WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM trips t JOIN chapters c ON c.vault_id=t.vault_id JOIN vaults v ON v.id=t.vault_id
  WHERE t.id=NEW.trip_id AND c.id=NEW.chapter_id AND t.vault_id=NEW.vault_id
    AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Chapter membership requires active same-vault parents'); END;
`;
