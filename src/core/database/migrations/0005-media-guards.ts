// Forward-only correction: migration 4 was already applied by a development client.
// Keep its checksum intact and preserve every existing row and original file.
export const mediaGuardsSchema = `
CREATE TRIGGER media_live_vault BEFORE INSERT ON media
WHEN NOT EXISTS(SELECT 1 FROM vaults WHERE id=NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Media requires active vault'); END;
CREATE TRIGGER import_batch_live_trip BEFORE INSERT ON import_batches
WHEN NOT EXISTS(SELECT 1 FROM trips t JOIN vaults v ON v.id=t.vault_id WHERE t.id=NEW.trip_id AND t.vault_id=NEW.vault_id AND t.deleted_at IS NULL AND v.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Import requires active trip'); END;
DROP TRIGGER media_detach_stop;
CREATE TRIGGER media_detach_stop BEFORE UPDATE OF deleted_at ON stops
WHEN NEW.deleted_at IS NOT NULL AND NEW.deleted_by_trip=0
BEGIN UPDATE trip_media SET stop_id=NULL,updated_at=NEW.updated_at WHERE stop_id=OLD.id; END;
`;
