import type { LocalDatabase } from '../../core/database/database';
import { getOrCreateVault, type Vault } from '../../core/database/vault';

const deletionStatements = [
  'DELETE FROM dream_visits', 'DELETE FROM dream_destinations',
  'DELETE FROM trip_chapters', 'DELETE FROM trip_companions',
  // Suggestions point at their run row with an immediate RESTRICT constraint.
  'DELETE FROM draft_suggestions WHERE run_id IS NOT NULL', 'DELETE FROM draft_suggestions',
  'DELETE FROM import_items', 'DELETE FROM import_batches', 'DELETE FROM trip_media',
  'DELETE FROM local_media_files', 'DELETE FROM media', 'DELETE FROM stops',
  'DELETE FROM trip_days', 'DELETE FROM chapters', 'DELETE FROM companions',
  'DELETE FROM places', 'DELETE FROM trips', 'DELETE FROM search_documents',
  'DELETE FROM search_index_state', 'DELETE FROM vaults',
] as const;

// The schema and migration history are retained; every user/derived row is
// removed transactionally, then a fresh empty vault identity is established.
export async function resetVaultContents(database: LocalDatabase, createId: () => string): Promise<Vault> {
  await database.transaction(async connection => {
    for (const sql of deletionStatements) await connection.runAsync(sql);
  });
  return getOrCreateVault(database, createId);
}
