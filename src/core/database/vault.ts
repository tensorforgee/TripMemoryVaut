import type { LocalDatabase } from './database';
import { uuid } from '../../domain/validation';

export type Vault = { id: string; name: string; formatVersion: number };

export async function getOrCreateVault(database: LocalDatabase, newId: () => string): Promise<Vault> {
  return database.transaction(async connection => {
    const existing = await connection.getAllAsync<{ id: string; name: string; format_version: number; deleted_at: string | null }>('SELECT id, name, format_version, deleted_at FROM vaults');
    if (existing.length) {
      // One database per vault. Never silently replace a deleted/ambiguous vault.
      if (existing.length !== 1 || existing[0].deleted_at !== null) throw new Error('Vault requires recovery');
      return { id: uuid(existing[0].id, 'vault.id'), name: existing[0].name, formatVersion: existing[0].format_version };
    }
    const id = uuid(newId(), 'vault.id');
    const now = new Date().toISOString();
    await connection.runAsync('INSERT INTO vaults(id, name, format_version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', id, 'My vault', now, now);
    return { id, name: 'My vault', formatVersion: 1 };
  });
}
