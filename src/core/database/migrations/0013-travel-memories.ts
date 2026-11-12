import { searchSchema } from './0010-search';
import { searchDocumentSelect, currentSearchDocumentSelect } from '../../../features/search/schema';

// Recreate only the derived index. Keep the SQL and checksum of migration 10
// unchanged, including its original projection and index version.
const dropSearch = [...searchSchema.matchAll(/CREATE TRIGGER (\w+)/g)].map(m => `DROP TRIGGER ${m[1]};`).join('\n');
const upgradedSearch = searchSchema.replaceAll(searchDocumentSelect, currentSearchDocumentSelect)
  .replace("'dream','trip_media'", "'dream','trip_media','memory'")
  .replace('index_version=1', 'index_version=2')
  .replace('VALUES(NEW.id,1,', 'VALUES(NEW.id,2,')
  .replace('SELECT NEW.id,1,', 'SELECT NEW.id,2,')
  .replace('SELECT id,1,', 'SELECT id,2,');

const validContext = `EXISTS(SELECT 1 FROM trips t JOIN vaults v ON v.id=t.vault_id
  WHERE t.id=NEW.trip_id AND t.vault_id=NEW.vault_id AND t.deleted_at IS NULL AND v.deleted_at IS NULL)
  AND (NEW.day_id IS NULL OR EXISTS(SELECT 1 FROM trip_days d WHERE d.id=NEW.day_id AND d.vault_id=NEW.vault_id AND d.trip_id=NEW.trip_id AND d.deleted_at IS NULL))
  AND (NEW.stop_id IS NULL OR EXISTS(SELECT 1 FROM stops s WHERE s.id=NEW.stop_id AND s.vault_id=NEW.vault_id AND s.trip_id=NEW.trip_id AND (s.deleted_at IS NULL OR s.deleted_by_trip=1)))`;

export const travelMemoriesSchema = `
CREATE TABLE memories (
  id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, trip_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'memory' CHECK(kind IN ('memory','note')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000000),
  dates_json TEXT CHECK(dates_json IS NULL OR json_valid(dates_json)),
  day_id TEXT, stop_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK(day_id IS NULL OR stop_id IS NULL),
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,trip_id,day_id) REFERENCES trip_days(vault_id,trip_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,trip_id,stop_id) REFERENCES stops(vault_id,trip_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX memories_trip ON memories(vault_id,trip_id,deleted_at,created_at,id);
CREATE INDEX memories_day ON memories(vault_id,trip_id,day_id);
CREATE INDEX memories_stop ON memories(vault_id,trip_id,stop_id);
CREATE TRIGGER memories_insert BEFORE INSERT ON memories WHEN NEW.deleted_at IS NULL AND NOT (${validContext})
BEGIN SELECT RAISE(ABORT,'Memory requires active same-trip context'); END;
CREATE TRIGGER memories_update BEFORE UPDATE ON memories
WHEN NEW.id<>OLD.id OR NEW.vault_id<>OLD.vault_id OR NEW.trip_id<>OLD.trip_id
  OR (NEW.deleted_at IS NULL AND NOT (${validContext}))
BEGIN SELECT RAISE(ABORT,'Memory requires active immutable ownership and context'); END;
CREATE TRIGGER memories_detach_day AFTER UPDATE OF deleted_at ON trip_days
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN UPDATE memories SET day_id=NULL,updated_at=NEW.updated_at WHERE day_id=NEW.id AND vault_id=NEW.vault_id; END;
CREATE TRIGGER memories_detach_stop AFTER UPDATE OF deleted_at ON stops
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.deleted_by_trip=0
BEGIN UPDATE memories SET stop_id=NULL,updated_at=NEW.updated_at WHERE stop_id=NEW.id AND vault_id=NEW.vault_id; END;

CREATE TABLE memory_media (
  id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, memory_id TEXT NOT NULL, media_id TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(vault_id,id),
  FOREIGN KEY(vault_id,memory_id) REFERENCES memories(vault_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(vault_id,media_id) REFERENCES media(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX memory_media_active ON memory_media(vault_id,memory_id,media_id) WHERE deleted_at IS NULL;
CREATE INDEX memory_media_asset ON memory_media(vault_id,media_id);
CREATE TRIGGER memory_media_insert BEFORE INSERT ON memory_media WHEN NEW.deleted_at IS NULL AND NOT EXISTS(
  SELECT 1 FROM memories n JOIN trips t ON t.id=n.trip_id AND t.vault_id=n.vault_id
  JOIN media m ON m.vault_id=n.vault_id AND m.id=NEW.media_id
  WHERE n.id=NEW.memory_id AND n.vault_id=NEW.vault_id AND n.deleted_at IS NULL AND t.deleted_at IS NULL AND m.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Attachment requires active memory and media'); END;
CREATE TRIGGER memory_media_update BEFORE UPDATE ON memory_media
WHEN NEW.id<>OLD.id OR NEW.vault_id<>OLD.vault_id OR NEW.memory_id<>OLD.memory_id OR NEW.media_id<>OLD.media_id
  OR (NEW.deleted_at IS NULL AND NOT EXISTS(
    SELECT 1 FROM memories n JOIN trips t ON t.id=n.trip_id AND t.vault_id=n.vault_id
    JOIN media m ON m.vault_id=n.vault_id AND m.id=NEW.media_id
    WHERE n.id=NEW.memory_id AND n.vault_id=NEW.vault_id AND n.deleted_at IS NULL AND t.deleted_at IS NULL AND m.deleted_at IS NULL))
BEGIN SELECT RAISE(ABORT,'Attachment ownership is immutable'); END;
CREATE TRIGGER memories_protect_media BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM memory_media WHERE vault_id=OLD.vault_id AND media_id=OLD.id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a travel memory'); END;

CREATE TABLE memory_drafts (
  vault_id TEXT NOT NULL, trip_id TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), updated_at TEXT NOT NULL,
  PRIMARY KEY(vault_id,trip_id), FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER memory_drafts_protect_media BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM memory_drafts d,json_each(d.payload_json,'$.mediaIds') j
  WHERE d.vault_id=OLD.vault_id AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a memory draft'); END;
CREATE TRIGGER memory_drafts_retain_media BEFORE DELETE ON media
WHEN EXISTS(SELECT 1 FROM memory_drafts d,json_each(d.payload_json,'$.mediaIds') j WHERE d.vault_id=OLD.vault_id AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a memory draft'); END;

${dropSearch}
DROP TABLE search_fts;
DROP TABLE search_documents;
DROP TABLE search_index_state;
${upgradedSearch}
CREATE TRIGGER search_memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${currentSearchDocumentSelect}) WHERE entity_type='memory' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_memory_update AFTER UPDATE ON memories BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='memory' AND entity_id=OLD.id;
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${currentSearchDocumentSelect}) WHERE entity_type='memory' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_memory_delete AFTER DELETE ON memories BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='memory' AND entity_id=OLD.id;
END;
`;
