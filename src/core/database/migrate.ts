import { inTransaction, type LocalDatabase, type SqlConnection } from './database';
import { initialSchema } from './migrations/0001-vault-trips';
import { placesStopsSchema } from './migrations/0002-places-stops';
import { tripDaysSchema } from './migrations/0003-trip-days';
import { mediaSchema } from './migrations/0004-media';
import { mediaGuardsSchema } from './migrations/0005-media-guards';
import { reconstructionSchema } from './migrations/0006-reconstruction';
import { reconstructionProvenanceSchema } from './migrations/0007-reconstruction-provenance';
import { companionsChaptersSchema } from './migrations/0008-companions-chapters';
import { dreamPlacesSchema } from './migrations/0009-dream-places';

export type Migration = { readonly version: number; readonly sql: string };
export const migrations: readonly Migration[] = [{ version: 1, sql: initialSchema }, { version: 2, sql: placesStopsSchema }, { version: 3, sql: tripDaysSchema }, { version: 4, sql: mediaSchema }, { version: 5, sql: mediaGuardsSchema }, { version: 6, sql: reconstructionSchema }, { version: 7, sql: reconstructionProvenanceSchema }, { version: 8, sql: companionsChaptersSchema }, { version: 9, sql: dreamPlacesSchema }];

export interface MigrationBackup {
  path: string;
  restore(): Promise<void>;
  close(): Promise<void>;
}

export type MigrationServices = {
  checksum(sql: string): Promise<string>;
  backup(connection: SqlConnection): Promise<MigrationBackup>;
};

export class MigrationError extends Error {
  constructor(message: string, public readonly backupPath: string | null, cause: unknown) {
    super(message, { cause });
    this.name = 'MigrationError';
  }
}

const historySchema = `CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL
) STRICT;`;

async function checkIntegrity(connection: SqlConnection): Promise<void> {
  const integrity = await connection.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  const foreignKeys = await connection.getAllAsync('PRAGMA foreign_key_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeys.length) {
    throw new Error('SQLite integrity or foreign-key check failed');
  }
}

// Call before exposing repositories. Unknown versions or edited history fail closed.
export async function migrateDatabase(database: LocalDatabase, services: MigrationServices, plan = migrations): Promise<void> {
  await database.run(async connection => {
    const checksums = await Promise.all(plan.map(async (migration, index) => {
      if (migration.version !== index + 1) throw new Error('Migration versions must be contiguous from 1');
      const checksum = await services.checksum(migration.sql);
      if (!/^[0-9a-f]{64}$/i.test(checksum)) throw new Error('Invalid SHA-256 migration checksum');
      return checksum;
    }));
    const hasHistory = await connection.getFirstAsync("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'");
    const history = hasHistory
      ? await connection.getAllAsync<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version')
      : [];
    const userVersion = await connection.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (userVersion?.user_version !== history.length) {
      throw new MigrationError('Schema version and migration history disagree; database preserved', null, null);
    }
    for (const [index, applied] of history.entries()) {
      if (applied.version !== index + 1 || applied.version > plan.length || applied.checksum !== checksums[index]) {
        throw new MigrationError('Unsupported schema version or modified migration history; database preserved', null, null);
      }
    }
    await checkIntegrity(connection);
    if (history.length === plan.length && hasHistory) return;

    // SQLite's backup API includes committed WAL contents; never copy the DB file.
    const backup = await services.backup(connection);
    try {
      await inTransaction(connection, async transaction => {
        if (!hasHistory) await transaction.execAsync(historySchema);
        for (let index = history.length; index < plan.length; index++) {
          await transaction.execAsync(plan[index].sql);
          await transaction.runAsync('INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)',
            plan[index].version, checksums[index], new Date().toISOString());
        }
        await transaction.execAsync(`PRAGMA user_version = ${plan.length}`);
        await checkIntegrity(transaction);
      });
    } catch (error) {
      try {
        await backup.restore();
        await checkIntegrity(connection);
      } catch (restoreError) {
        throw new MigrationError('Migration and automatic recovery failed; preserve the database and backup', backup.path,
          new AggregateError([error, restoreError]));
      }
      throw new MigrationError('Migration failed; the pre-migration snapshot was restored', backup.path, error);
    } finally {
      await backup.close();
    }
  });
}
