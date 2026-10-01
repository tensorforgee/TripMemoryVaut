import type { SqlConnection } from '../../core/database/database';

export const SEARCH_INDEX_VERSION = 1;

// Canonical projection used by migration backfill and explicit rebuilds. Dates,
// EXIF, suggestion payloads, tombstones, and binary/media source data are absent
// by design. A Stop is searchable only after the visit has been confirmed.
export const searchDocumentSelect = `
SELECT t.vault_id,'trip' entity_type,t.id entity_id,NULL trip_id,t.title title,COALESCE(t.summary,'') body
FROM trips t JOIN vaults v ON v.id=t.vault_id
WHERE t.deleted_at IS NULL AND v.deleted_at IS NULL
UNION ALL
SELECT p.vault_id,'place',p.id,NULL,p.name,
  COALESCE((SELECT group_concat(CAST(j.value AS TEXT),' ') FROM json_each(p.aliases_json) j WHERE j.type='text'),'')
FROM places p JOIN vaults v ON v.id=p.vault_id
WHERE p.deleted_at IS NULL AND v.deleted_at IS NULL
UNION ALL
SELECT s.vault_id,'stop',s.id,s.trip_id,COALESCE(s.lodging_label,'Stop note'),
  trim(COALESCE(s.note,'')||' '||COALESCE(s.lodging_label,''))
FROM stops s JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id JOIN vaults v ON v.id=s.vault_id
WHERE s.deleted_at IS NULL AND s.visit_confirmed=1 AND t.deleted_at IS NULL AND v.deleted_at IS NULL
  AND (s.note IS NOT NULL OR s.lodging_label IS NOT NULL)
UNION ALL
SELECT d.vault_id,'trip_day',d.id,d.trip_id,d.label,''
FROM trip_days d JOIN trips t ON t.id=d.trip_id AND t.vault_id=d.vault_id JOIN vaults v ON v.id=d.vault_id
WHERE d.deleted_at IS NULL AND d.label IS NOT NULL AND t.deleted_at IS NULL AND v.deleted_at IS NULL
UNION ALL
SELECT c.vault_id,'companion',c.id,NULL,c.label,COALESCE(c.note,'')
FROM companions c JOIN vaults v ON v.id=c.vault_id
WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL
UNION ALL
SELECT c.vault_id,'chapter',c.id,NULL,c.name,COALESCE(c.description,'')
FROM chapters c JOIN vaults v ON v.id=c.vault_id
WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL
UNION ALL
SELECT d.vault_id,'dream',d.id,NULL,p.name,
  trim(COALESCE(d.note,'')||' '||COALESCE(d.location_text,''))
FROM dream_destinations d JOIN places p ON p.id=d.place_id AND p.vault_id=d.vault_id
JOIN vaults v ON v.id=d.vault_id
WHERE d.deleted_at IS NULL AND d.is_archived=0 AND p.deleted_at IS NULL AND v.deleted_at IS NULL
UNION ALL
SELECT tm.vault_id,'trip_media',tm.id,tm.trip_id,tm.caption,''
FROM trip_media tm JOIN trips t ON t.id=tm.trip_id AND t.vault_id=tm.vault_id
JOIN media m ON m.id=tm.media_id AND m.vault_id=tm.vault_id JOIN vaults v ON v.id=tm.vault_id
WHERE tm.deleted_at IS NULL AND tm.caption IS NOT NULL AND t.deleted_at IS NULL
  AND m.deleted_at IS NULL AND v.deleted_at IS NULL`;

export async function rebuildSearchIndex(connection: SqlConnection, vaultId: string, rebuiltAt = new Date().toISOString()): Promise<void> {
  await connection.runAsync('DELETE FROM search_documents WHERE vault_id=?', vaultId);
  await connection.runAsync(`INSERT INTO search_documents(vault_id,entity_type,entity_id,trip_id,title,body)
    SELECT vault_id,entity_type,entity_id,trip_id,title,body FROM (${searchDocumentSelect}) documents
    WHERE vault_id=? ORDER BY entity_type,entity_id`, vaultId);
  await connection.runAsync(`INSERT INTO search_index_state(vault_id,index_version,rebuilt_at) VALUES(?,?,?)
    ON CONFLICT(vault_id) DO UPDATE SET index_version=excluded.index_version,rebuilt_at=excluded.rebuilt_at`,
  vaultId, SEARCH_INDEX_VERSION, rebuiltAt);
}
