import { backupDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { configureConnection, LocalDatabase } from './database';
import { migrateDatabase, type MigrationServices } from './migrate';
import { getOrCreateVault, type Vault } from './vault';
import { TripRepository } from '../../features/trips/repository';
import { RouteRepository } from '../../features/route/repository';
import { TimelineRepository } from '../../features/timeline/repository';
import { CompanionRepository } from '../../features/companions/repository';
import { ChapterRepository } from '../../features/chapters/repository';
import { TravelLifeRepository } from '../../features/life/repository';
import { DreamRepository } from '../../features/dreams/repository';
import { GlobalMapRepository } from '../../features/map/repository';

// One persistent connection per open vault, configured before migrations or queries.
// A rejected initialization must be shown as recovery/error, never an empty vault.
export function sqliteMigrationServices(connection: SQLiteDatabase, databaseName: string): MigrationServices {
  return {
    checksum: sql => digestStringAsync(CryptoDigestAlgorithm.SHA256, sql),
    backup: async () => {
      const backupName = `${databaseName}.before-migration-${randomUUID()}.sqlite`;
      const snapshot = await openDatabaseAsync(backupName, { useNewConnection: true });
      try {
        await configureConnection(snapshot);
        await backupDatabaseAsync({ sourceDatabase: connection, destDatabase: snapshot });
      } catch (error) {
        await snapshot.closeAsync();
        throw error;
      }
      return {
        path: snapshot.databasePath,
        restore: () => backupDatabaseAsync({ sourceDatabase: snapshot, destDatabase: connection }),
        close: () => snapshot.closeAsync(),
      };
    },
  };
}

export type VaultDatabase = {
  database: LocalDatabase;
  vault: Vault;
  trips: TripRepository;
  routes: RouteRepository;
  timeline: TimelineRepository;
  companions: CompanionRepository;
  chapters: ChapterRepository;
  life: TravelLifeRepository;
  dreams: DreamRepository;
  map: GlobalMapRepository;
  close(): Promise<void>;
};

const opened = new Map<string, Promise<VaultDatabase>>();

export function openVaultDatabase(databaseName = 'vault.sqlite'): Promise<VaultDatabase> {
  // Avoid two initializers taking conflicting backups of the same database.
  // File names only: prevent aliases or paths that bypass this registry.
  if (!/^[a-zA-Z0-9_-]+\.sqlite$/.test(databaseName)) throw new Error('Invalid vault database filename');
  const current = opened.get(databaseName);
  if (current) return current;
  const pending = initialize(databaseName).catch(error => { opened.delete(databaseName); throw error; });
  opened.set(databaseName, pending);
  return pending;
}

async function initialize(databaseName: string): Promise<VaultDatabase> {
  const connection = await openDatabaseAsync(databaseName, { useNewConnection: true });
  const database = new LocalDatabase(connection);
  try {
    await configureConnection(connection);
    await migrateDatabase(database, sqliteMigrationServices(connection, databaseName));
    const vault = await getOrCreateVault(database, randomUUID);
    return {
      database, vault, trips: new TripRepository(database, vault.id, randomUUID), routes: new RouteRepository(database, vault.id, randomUUID),
      timeline: new TimelineRepository(database, vault.id, randomUUID),
      companions: new CompanionRepository(database, vault.id, randomUUID), chapters: new ChapterRepository(database, vault.id, randomUUID),
      life: new TravelLifeRepository(database, vault.id),
      dreams: new DreamRepository(database, vault.id, randomUUID),
      map: new GlobalMapRepository(database, vault.id),
      close: async () => { await database.close(); opened.delete(databaseName); },
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
