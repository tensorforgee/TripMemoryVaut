// Received evidence is immutable. Jobs journal the filesystem/SQLite boundary.
export const mediaSchema = `
CREATE TABLE media (
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
 CHECK((mime_type='image/jpeg' AND extension='jpg') OR (mime_type='image/png' AND extension='png')),
 CHECK((width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND width*height<=100000000))
) STRICT;
CREATE INDEX media_vault_live ON media(vault_id,deleted_at);
CREATE TRIGGER media_immutable BEFORE UPDATE OF vault_id,sha256,byte_size,mime_type,extension,width,height,original_filename,source_fidelity,source_metadata_json,parser_version ON media
BEGIN SELECT RAISE(ABORT,'Source evidence is immutable'); END;
CREATE TABLE trip_media (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
 trip_id TEXT NOT NULL, media_id TEXT NOT NULL, day_id TEXT, stop_id TEXT,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
 caption TEXT CHECK(caption IS NULL OR length(trim(caption))>0), is_favourite INTEGER NOT NULL DEFAULT 0 CHECK(is_favourite IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 deleted_by_trip INTEGER NOT NULL DEFAULT 0 CHECK(deleted_by_trip IN (0,1)),
 CHECK(deleted_by_trip=0 OR deleted_at IS NOT NULL),
 UNIQUE(vault_id,id), UNIQUE(vault_id,trip_id,id),
 FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(vault_id,media_id) REFERENCES media(vault_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(vault_id,trip_id,day_id) REFERENCES trip_days(vault_id,trip_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(vault_id,trip_id,stop_id) REFERENCES stops(vault_id,trip_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX trip_media_active_pair ON trip_media(trip_id,media_id) WHERE deleted_at IS NULL;
CREATE INDEX trip_media_order ON trip_media(trip_id,deleted_at,position,id);
CREATE INDEX trip_media_day ON trip_media(trip_id,day_id,position,id);
CREATE INDEX trip_media_stop ON trip_media(stop_id);
CREATE INDEX trip_media_asset ON trip_media(media_id);
CREATE INDEX trip_media_vault_media ON trip_media(vault_id,media_id);
CREATE INDEX trip_media_vault_day ON trip_media(vault_id,trip_id,day_id);
CREATE INDEX trip_media_vault_stop ON trip_media(vault_id,trip_id,stop_id);
CREATE TABLE import_batches (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT, trip_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','complete','attention')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 options_json TEXT NOT NULL CHECK(json_valid(options_json)), UNIQUE(vault_id,id),
 FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX import_batches_trip_state ON import_batches(trip_id,state);
CREATE INDEX import_batches_vault_trip ON import_batches(vault_id,trip_id);
CREATE TABLE import_items (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT, batch_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 state TEXT NOT NULL CHECK(state IN ('selected','copying','staged','verified','archived','failed','unsupported','retry_required')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), source_uri TEXT, original_filename TEXT,
 staging_relative_path TEXT NOT NULL, final_relative_path TEXT,
 evidence_json TEXT CHECK(evidence_json IS NULL OR json_valid(evidence_json)), media_id TEXT,
 error_code TEXT, result TEXT CHECK(result IS NULL OR result IN ('added','reused','already_added')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(batch_id,ordinal),
 FOREIGN KEY(vault_id,batch_id) REFERENCES import_batches(vault_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(vault_id,media_id) REFERENCES media(vault_id,id) ON DELETE RESTRICT,
 CHECK(state!='archived' OR (media_id IS NOT NULL AND source_uri IS NULL)),
 CHECK(state!='verified' OR (evidence_json IS NOT NULL AND final_relative_path IS NOT NULL))
) STRICT;
CREATE INDEX import_items_state ON import_items(state);
CREATE INDEX import_items_vault_batch ON import_items(vault_id,batch_id);
CREATE INDEX import_items_vault_media ON import_items(vault_id,media_id);
CREATE TABLE local_media_files (
 media_id TEXT NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
 variant TEXT NOT NULL CHECK(variant IN ('original','display','thumbnail')),
 relative_path TEXT NOT NULL CHECK(relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%' AND instr(relative_path,':')=0 AND instr(relative_path,char(92))=0),
 state TEXT NOT NULL CHECK(state IN ('available','missing','failed')), bytes INTEGER NOT NULL CHECK(bytes>=0),
 pinned INTEGER NOT NULL CHECK(pinned IN (0,1)), last_access_at TEXT NOT NULL,
 checksum TEXT, recipe_version INTEGER, width INTEGER CHECK(width>0), height INTEGER CHECK(height>0),
 PRIMARY KEY(media_id,variant), FOREIGN KEY(vault_id,media_id) REFERENCES media(vault_id,id) ON DELETE RESTRICT,
 CHECK(variant!='original' OR pinned=1)
) STRICT;
CREATE INDEX local_media_state ON local_media_files(state,last_access_at);
CREATE INDEX local_media_vault ON local_media_files(vault_id,media_id);
CREATE TRIGGER media_no_live_trash BEFORE UPDATE OF deleted_at ON media
WHEN NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM trip_media WHERE media_id=OLD.id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media has live placements'); END;
CREATE TRIGGER import_item_transition BEFORE UPDATE OF state ON import_items
WHEN OLD.state!=NEW.state AND NOT (
 (OLD.state='selected' AND NEW.state IN ('copying','unsupported','failed','retry_required')) OR
 (OLD.state='copying' AND NEW.state IN ('staged','failed','retry_required','unsupported')) OR
 (OLD.state='staged' AND NEW.state IN ('verified','failed','unsupported','retry_required')) OR
 (OLD.state='verified' AND NEW.state IN ('archived','failed','retry_required')) OR
 (OLD.state IN ('failed','retry_required') AND NEW.state IN ('selected','staged','verified')) OR
 (OLD.state='archived' AND NEW.state='retry_required'))
BEGIN SELECT RAISE(ABORT,'Invalid import transition'); END;
` + ['INSERT','UPDATE'].map(action => `
CREATE TRIGGER trip_media_live_${action.toLowerCase()} BEFORE ${action} ON trip_media
WHEN NEW.deleted_at IS NULL AND (
 NOT EXISTS(SELECT 1 FROM trips t JOIN vaults v ON v.id=t.vault_id JOIN media m ON m.vault_id=t.vault_id
 WHERE t.id=NEW.trip_id AND t.vault_id=NEW.vault_id AND m.id=NEW.media_id AND t.deleted_at IS NULL AND v.deleted_at IS NULL AND m.deleted_at IS NULL) OR
 (NEW.day_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM trip_days WHERE id=NEW.day_id AND trip_id=NEW.trip_id AND vault_id=NEW.vault_id AND deleted_at IS NULL)) OR
 (NEW.stop_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM stops WHERE id=NEW.stop_id AND trip_id=NEW.trip_id AND vault_id=NEW.vault_id AND deleted_at IS NULL AND (day_id IS NULL OR day_id IS NEW.day_id))))
BEGIN SELECT RAISE(ABORT,'Photo requires live same-vault/trip parents and matching section'); END;
`).join('') + `
CREATE TRIGGER media_detach_day BEFORE UPDATE OF deleted_at ON trip_days
WHEN NEW.deleted_at IS NOT NULL
BEGIN UPDATE trip_media SET day_id=NULL,stop_id=NULL,updated_at=NEW.updated_at WHERE day_id=OLD.id; END;
CREATE TRIGGER media_detach_stop BEFORE UPDATE OF deleted_at ON stops
WHEN NEW.deleted_at IS NOT NULL
BEGIN UPDATE trip_media SET stop_id=NULL,updated_at=NEW.updated_at WHERE stop_id=OLD.id; END;
CREATE TRIGGER media_stop_day BEFORE UPDATE OF day_id ON stops
WHEN NEW.day_id IS NOT OLD.day_id
BEGIN UPDATE trip_media SET stop_id=NULL,updated_at=NEW.updated_at WHERE stop_id=OLD.id; END;
`;
