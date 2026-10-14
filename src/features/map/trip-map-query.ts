import type { LocalDatabase } from '../../core/database/database';
import { uuid } from '../../domain/validation';
import type { PhotoCounts } from './trip-map-v2';

// Count active archival placements, not import selections, EXIF locations, or
// derivatives. Missing local originals remain archive records, as in Travel Life.
export async function tripMapPhotoCounts(database: LocalDatabase, vaultId: string, tripId: string): Promise<PhotoCounts> {
  uuid(vaultId, 'vaultId'); uuid(tripId, 'tripId');
  return database.run(async c => {
    const rows = await c.getAllAsync<{ stop_id: string | null; count: number }>(`
      SELECT p.stop_id,COUNT(*) AS count FROM trip_media p
      JOIN media m ON m.id=p.media_id AND m.vault_id=p.vault_id AND m.deleted_at IS NULL
      JOIN trips t ON t.id=p.trip_id AND t.vault_id=p.vault_id AND t.deleted_at IS NULL
      JOIN vaults v ON v.id=t.vault_id AND v.deleted_at IS NULL
      WHERE p.trip_id=? AND p.vault_id=? AND p.deleted_at IS NULL GROUP BY p.stop_id`, tripId, vaultId);
    return { total: rows.reduce((sum, row) => sum + row.count, 0),
      byStop: Object.fromEntries(rows.filter(row => row.stop_id !== null).map(row => [row.stop_id!, row.count])) };
  });
}
