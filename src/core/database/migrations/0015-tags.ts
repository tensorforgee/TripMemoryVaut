import { travelMemoriesSchema } from './0013-travel-memories';
import { currentSearchDocumentSelect, tagSearchDocumentSelect } from '../../../features/search/schema';

// Reuse the frozen v2 search definitions, leaving migrations 1–14 checksums intact.
const priorSearch = travelMemoriesSchema.slice(travelMemoriesSchema.indexOf('CREATE TABLE search_documents'));
const dropSearch = [...priorSearch.matchAll(/CREATE TRIGGER (\w+)/g)].map(m=>`DROP TRIGGER ${m[1]};`).join('\n');
const upgradedSearch = priorSearch.replaceAll(currentSearchDocumentSelect, tagSearchDocumentSelect)
  .replace("'trip_media','memory'", "'trip_media','memory','tag'")
  .replaceAll('index_version=2','index_version=3').replaceAll('VALUES(NEW.id,2,','VALUES(NEW.id,3,')
  .replaceAll('SELECT NEW.id,2,','SELECT NEW.id,3,').replaceAll('SELECT id,2,','SELECT id,3,');

// Membership tombstones represent explicit detachments. Parent trash only hides links.
const memberships = (kind: 'trip' | 'memory', parent: string) => `
CREATE TABLE ${kind}_tags (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, ${kind}_id TEXT NOT NULL, tag_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(vault_id,id),
 FOREIGN KEY(vault_id,${kind}_id) REFERENCES ${parent}(vault_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(vault_id,tag_id) REFERENCES tags(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX ${kind}_tags_pair ON ${kind}_tags(vault_id,${kind}_id,tag_id);
CREATE INDEX ${kind}_tags_tag ON ${kind}_tags(vault_id,tag_id,${kind}_id);
CREATE TRIGGER ${kind}_tags_insert BEFORE INSERT ON ${kind}_tags WHEN NEW.deleted_at IS NULL AND NOT (
 EXISTS(SELECT 1 FROM tags g JOIN vaults v ON v.id=g.vault_id WHERE g.id=NEW.tag_id AND g.vault_id=NEW.vault_id AND g.deleted_at IS NULL AND v.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM ${parent} p ${kind === 'memory' ? 'JOIN trips t ON t.id=p.trip_id AND t.vault_id=p.vault_id' : ''}
 WHERE p.id=NEW.${kind}_id AND p.vault_id=NEW.vault_id AND p.deleted_at IS NULL ${kind === 'memory' ? 'AND t.deleted_at IS NULL' : ''}))
BEGIN SELECT RAISE(ABORT,'Tag requires active same-vault content'); END;
CREATE TRIGGER ${kind}_tags_update BEFORE UPDATE ON ${kind}_tags WHEN
 NEW.id<>OLD.id OR NEW.vault_id<>OLD.vault_id OR NEW.${kind}_id<>OLD.${kind}_id OR NEW.tag_id<>OLD.tag_id
 OR (NEW.deleted_at IS NULL AND NOT (
 EXISTS(SELECT 1 FROM tags g JOIN vaults v ON v.id=g.vault_id WHERE g.id=NEW.tag_id AND g.vault_id=NEW.vault_id AND g.deleted_at IS NULL AND v.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM ${parent} p ${kind === 'memory' ? 'JOIN trips t ON t.id=p.trip_id AND t.vault_id=p.vault_id' : ''}
 WHERE p.id=NEW.${kind}_id AND p.vault_id=NEW.vault_id AND p.deleted_at IS NULL ${kind === 'memory' ? 'AND t.deleted_at IS NULL' : ''})))
BEGIN SELECT RAISE(ABORT,'Tag membership ownership is immutable and must be active'); END;
`;
export const tagsSchema = `
CREATE TABLE tags (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 normalized_name TEXT NOT NULL CHECK(length(normalized_name)>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(vault_id,id), FOREIGN KEY(vault_id) REFERENCES vaults(id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX tags_name ON tags(vault_id,normalized_name) WHERE deleted_at IS NULL;
CREATE TRIGGER tags_insert BEFORE INSERT ON tags WHEN NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Tag requires active vault'); END;
CREATE TRIGGER tags_update BEFORE UPDATE ON tags WHEN NEW.id<>OLD.id OR NEW.vault_id<>OLD.vault_id
 OR NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Tag ownership is immutable'); END;
${memberships('trip','trips')}
${memberships('memory','memories')}
CREATE TRIGGER tags_detach AFTER UPDATE OF deleted_at ON tags WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
 UPDATE trip_tags SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at WHERE tag_id=NEW.id AND vault_id=NEW.vault_id AND deleted_at IS NULL;
 UPDATE memory_tags SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at WHERE tag_id=NEW.id AND vault_id=NEW.vault_id AND deleted_at IS NULL;
END;
CREATE TRIGGER memory_tags_detach AFTER UPDATE OF deleted_at ON memories WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN UPDATE memory_tags SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at WHERE memory_id=NEW.id AND vault_id=NEW.vault_id AND deleted_at IS NULL; END;

${dropSearch}
DROP TABLE search_fts;
DROP TABLE search_documents;
DROP TABLE search_index_state;
${upgradedSearch}
CREATE TRIGGER search_tag_insert AFTER INSERT ON tags BEGIN
 INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
 SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${tagSearchDocumentSelect}) WHERE entity_type='tag' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_tag_update AFTER UPDATE ON tags BEGIN
 DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='tag' AND entity_id=OLD.id;
 INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
 SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${tagSearchDocumentSelect}) WHERE entity_type='tag' AND entity_id=NEW.id;
END;
CREATE TRIGGER search_tag_delete AFTER DELETE ON tags BEGIN
 DELETE FROM search_documents WHERE vault_id=OLD.vault_id AND entity_type='tag' AND entity_id=OLD.id;
END;
`;
