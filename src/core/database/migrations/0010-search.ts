import { SEARCH_INDEX_VERSION, searchDocumentSelect } from '../../../features/search/schema';

const refresh = (name: string, table: string, entityType: string) => `
CREATE TRIGGER search_${name}_insert AFTER INSERT ON ${table} BEGIN
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
  WHERE entity_type='${entityType}' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_${name}_update AFTER UPDATE ON ${table} BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='${entityType}' AND entity_id=OLD.id;
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
  WHERE entity_type='${entityType}' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_${name}_delete AFTER DELETE ON ${table} BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='${entityType}' AND entity_id=OLD.id;
END;`;

// Step 13: rebuildable, vault-scoped external-content FTS5 projection.
export const searchSchema = `
CREATE TABLE search_documents (
  rowid INTEGER PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('trip','place','stop','trip_day','companion','chapter','dream','trip_media')),
  entity_id TEXT NOT NULL,
  trip_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(vault_id,entity_type,entity_id)
) STRICT;
CREATE INDEX search_documents_vault_trip ON search_documents(vault_id,trip_id);
CREATE INDEX search_documents_vault_entity ON search_documents(vault_id,entity_type,entity_id);

CREATE VIRTUAL TABLE search_fts USING fts5(
  title,body,
  content='search_documents',content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2',prefix='2 3'
);
CREATE TRIGGER search_documents_insert AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_fts(rowid,title,body) VALUES(NEW.rowid,NEW.title,NEW.body);
END;
CREATE TRIGGER search_documents_delete AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_fts(search_fts,rowid,title,body) VALUES('delete',OLD.rowid,OLD.title,OLD.body);
END;
CREATE TRIGGER search_documents_update AFTER UPDATE ON search_documents BEGIN
  INSERT INTO search_fts(search_fts,rowid,title,body) VALUES('delete',OLD.rowid,OLD.title,OLD.body);
  INSERT INTO search_fts(rowid,title,body) VALUES(NEW.rowid,NEW.title,NEW.body);
END;

CREATE TABLE search_index_state (
  vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
  index_version INTEGER NOT NULL CHECK(index_version=${SEARCH_INDEX_VERSION}),
  rebuilt_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER search_vault_insert AFTER INSERT ON vaults WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index_state(vault_id,index_version,rebuilt_at) VALUES(NEW.id,${SEARCH_INDEX_VERSION},NEW.updated_at);
END;
CREATE TRIGGER search_vault_update AFTER UPDATE ON vaults BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.id;
  DELETE FROM search_index_state WHERE vault_id=OLD.id;
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents WHERE vault_id=NEW.id;
  INSERT INTO search_index_state(vault_id,index_version,rebuilt_at)
  SELECT NEW.id,${SEARCH_INDEX_VERSION},NEW.updated_at WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER search_vault_delete AFTER DELETE ON vaults BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.id;
END;

CREATE TRIGGER search_trip_insert AFTER INSERT ON trips BEGIN
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
  WHERE entity_type='trip' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_trip_update AFTER UPDATE ON trips BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND ((entity_type='trip' AND entity_id=OLD.id) OR trip_id=OLD.id);
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
  WHERE vault_id=NEW.vault_id AND ((entity_type='trip' AND entity_id=NEW.id) OR trip_id=NEW.id);
END;
CREATE TRIGGER search_trip_delete AFTER DELETE ON trips BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND ((entity_type='trip' AND entity_id=OLD.id) OR trip_id=OLD.id);
END;

${refresh('place','places','place')}
CREATE TRIGGER search_place_dream_insert AFTER INSERT ON places BEGIN
  INSERT OR REPLACE INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
  WHERE entity_type='dream' AND entity_id IN (SELECT id FROM dream_destinations WHERE place_id=NEW.id AND vault_id=NEW.vault_id);
END;
CREATE TRIGGER search_place_dream_update AFTER UPDATE ON places BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='dream'
    AND entity_id IN (SELECT id FROM dream_destinations WHERE place_id=OLD.id AND vault_id=OLD.vault_id);
  INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
  SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
  WHERE entity_type='dream' AND entity_id IN (SELECT id FROM dream_destinations WHERE place_id=NEW.id AND vault_id=NEW.vault_id);
END;
CREATE TRIGGER search_place_dream_delete AFTER DELETE ON places BEGIN
  DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='dream'
    AND entity_id IN (SELECT id FROM dream_destinations WHERE place_id=OLD.id AND vault_id=OLD.vault_id);
END;
${refresh('stop','stops','stop')}
${refresh('trip_day','trip_days','trip_day')}
${refresh('companion','companions','companion')}
${refresh('chapter','chapters','chapter')}
${refresh('dream','dream_destinations','dream')}
${refresh('trip_media','trip_media','trip_media')}

INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
ORDER BY vault_id,entity_type,entity_id;
INSERT INTO search_index_state(vault_id,index_version,rebuilt_at)
SELECT id,${SEARCH_INDEX_VERSION},updated_at FROM vaults WHERE deleted_at IS NULL ORDER BY id;
`;
