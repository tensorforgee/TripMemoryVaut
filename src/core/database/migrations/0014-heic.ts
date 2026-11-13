// Rebuild only the format constraint; all v13 media indexes/guards are retained.
// The migration runner disables foreign keys outside the transaction and checks
// all references before commit. Legacy rename keeps dependent triggers intact.
export const heicSchema = `
CREATE TABLE media_heic (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 104857600),
 mime_type TEXT NOT NULL, extension TEXT NOT NULL,
 width INTEGER CHECK(width>0), height INTEGER CHECK(height>0), original_filename TEXT,
 source_fidelity TEXT NOT NULL CHECK(source_fidelity IN ('original_confirmed','picker_representation','unknown')),
 source_metadata_json TEXT NOT NULL CHECK(json_valid(source_metadata_json) AND json_type(source_metadata_json)='object'),
 capture_override_json TEXT CHECK(capture_override_json IS NULL OR json_valid(capture_override_json)),
 location_override_json TEXT CHECK(location_override_json IS NULL OR json_valid(location_override_json)),
 parser_version INTEGER NOT NULL CHECK(parser_version>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 UNIQUE(vault_id,id), UNIQUE(vault_id,sha256),
 CHECK((mime_type='image/jpeg' AND extension='jpg') OR (mime_type='image/png' AND extension='png') OR (mime_type='image/heic' AND extension='heic') OR (mime_type='image/heif' AND extension='heif')),
 CHECK((width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND width*height<=100000000))
) STRICT;
INSERT INTO media_heic SELECT * FROM media;
DROP TABLE media;
ALTER TABLE media_heic RENAME TO media;
CREATE INDEX media_vault_live ON media(vault_id,deleted_at);
CREATE TRIGGER media_immutable BEFORE UPDATE OF vault_id,sha256,byte_size,mime_type,extension,width,height,original_filename,source_fidelity,source_metadata_json,parser_version ON media
BEGIN SELECT RAISE(ABORT,'Source evidence is immutable'); END;
CREATE TRIGGER media_no_live_trash BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM trip_media WHERE media_id=OLD.id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media has live placements'); END;
CREATE TRIGGER media_live_vault BEFORE INSERT ON media
WHEN NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media requires active vault'); END;
CREATE TRIGGER photo_pins_protect_media BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM photo_memory_pins WHERE vault_id=OLD.vault_id AND media_id=OLD.id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a photo memory'); END;
CREATE TRIGGER memories_protect_media BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM memory_media WHERE vault_id=OLD.vault_id AND media_id=OLD.id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a travel memory'); END;
CREATE TRIGGER memory_drafts_protect_media BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM memory_drafts d,json_each(d.payload_json,'$.mediaIds') j
  WHERE d.vault_id=OLD.vault_id AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a memory draft'); END;
CREATE TRIGGER memory_drafts_retain_media BEFORE DELETE ON media
WHEN EXISTS(SELECT 1 FROM memory_drafts d,json_each(d.payload_json,'$.mediaIds') j WHERE d.vault_id=OLD.vault_id AND j.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'Media is referenced by a memory draft'); END;
`;
