import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';

export class NodeConnection {
  constructor(path) { this.native = new DatabaseSync(path); this.closed = false; }
  async execAsync(sql) { this.native.exec(sql); }
  async runAsync(sql, ...values) { return this.native.prepare(sql).run(...values); }
  async getFirstAsync(sql, ...values) { return this.native.prepare(sql).get(...values) ?? null; }
  async getAllAsync(sql, ...values) { return this.native.prepare(sql).all(...values); }
  async closeAsync() { if (!this.closed) { this.native.close(); this.closed = true; } }
}

export async function fixture(t, initialize = true) {
  const directory = await mkdtemp(join(tmpdir(), 'trip-vault-step1-'));
  const path = join(directory, 'vault.sqlite');
  const connection = new NodeConnection(path);
  await configureConnection(connection);
  const database = new LocalDatabase(connection);
  const backups = [];
  const services = {
    checksum: async sql => createHash('sha256').update(sql).digest('hex'),
    backup: async () => {
      const backupPath = join(directory, `before-${randomUUID()}.sqlite`);
      await backup(connection.native, backupPath);
      const snapshot = new NodeConnection(backupPath);
      await configureConnection(snapshot);
      const entry = { path: backupPath, restored: false };
      backups.push(entry);
      return {
        path: backupPath,
        restore: async () => {
          // Restore through SQLite backup, with the destination handle closed first.
          await connection.closeAsync();
          await backup(snapshot.native, path);
          connection.native = new DatabaseSync(path);
          connection.closed = false;
          await configureConnection(connection);
          entry.restored = true;
        },
        close: () => snapshot.closeAsync(),
      };
    },
  };
  t.after(async () => { await connection.closeAsync(); await rm(directory, { recursive: true, force: true }); });
  if (initialize) await migrateDatabase(database, services);
  const vault = initialize ? await getOrCreateVault(database, randomUUID) : null;
  return { connection, database, path, services, backups, vault,
    trips: vault ? new TripRepository(database, vault.id, randomUUID) : null };
}
