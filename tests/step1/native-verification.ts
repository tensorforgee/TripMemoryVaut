import { randomUUID } from 'expo-crypto';
import { type SQLiteDatabase } from 'expo-sqlite';
import { openVaultDatabase, sqliteMigrationServices } from '../../src/core/database/open';
import { migrateDatabase, migrations, MigrationError } from '../../src/core/database/migrate';
import { parseDateSpec, unknownDates } from '../../src/domain/date-spec';

// Isolated development fixture. Never opens or resets the real vault.sqlite.
export async function verifyNativeFoundation(): Promise<string[]> {
  const results: string[] = [];
  const verify = (label: string, passed: boolean) => {
    if (!passed) throw new Error(label);
    results.push(label);
  };
  const name = `step1-check-${randomUUID()}.sqlite`;
  let store = await openVaultDatabase(name);
  try {
    const shared = await openVaultDatabase(name);
    verify('One initialized connection per database', shared === store);
    const state = await store.database.run(async connection => ({
      tables: await connection.getAllAsync<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"),
      fk: await connection.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys'),
      wal: await connection.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode'),
      sync: await connection.getFirstAsync<{ synchronous: number }>('PRAGMA synchronous'),
    }));
    verify('Only the implemented domain tables and migration ledger', state.tables.map(row => row.name).join(',') === 'places,schema_migrations,stops,trip_days,trips,vaults');
    verify('Foreign keys, WAL and FULL durability', state.fk?.foreign_keys === 1 && state.wal?.journal_mode === 'wal' && state.sync?.synchronous === 2);
    const trip = await store.trips.createTripDraft({ title: 'Synthetic Step 1 verification' });
    verify('UUID draft with unknown dates', trip.id !== store.vault.id && JSON.stringify(trip.dates) === JSON.stringify(unknownDates()));
    const dates = parseDateSpec({ start: { precision: 'month', value: '2022-12' }, end: null, certainty: 'approximate', source: 'user', label: 'Synthetic date fixture' });
    const updated = await store.trips.updateBasicTripFields(trip.id, { dates, summary: 'Local verification fixture', isFavourite: true });
    verify('Create/read/update and approximate month', (await store.trips.getTripById(trip.id))?.summary === updated.summary && updated.dates.start.precision === 'month' && updated.dates.certainty === 'approximate');
    verify('List reads local trip', (await store.trips.listTrips())[0]?.id === trip.id);
    let validationRejected = false;
    try { await store.trips.updateBasicTripFields(trip.id, { title: ' ' }); } catch { validationRejected = true; }
    verify('Invalid update leaves row unchanged', validationRejected && (await store.trips.getTripById(trip.id))?.title === trip.title);

    const services = await store.database.run(async connection => sqliteMigrationServices(connection as SQLiteDatabase, name));
    await migrateDatabase(store.database, services);
    verify('Migration re-run is idempotent', (await store.trips.getTripById(trip.id))?.id === trip.id);
    let rejectedChecksum = false;
    try {
      await migrateDatabase(store.database, services, [{ version: 1, sql: migrations[0].sql + '\n-- changed' }]);
    } catch (error) { rejectedChecksum = error instanceof MigrationError; }
    verify('Changed migration checksum rejected', rejectedChecksum);
    let recovered = false;
    try {
      await migrateDatabase(store.database, services, [...migrations, {
        version: migrations.length + 1, sql: "UPDATE trips SET title = 'Must roll back'; CREATE TABLE partial_step1 (id TEXT); INSERT INTO missing_step1 VALUES (1);",
      }]);
    } catch (error) { recovered = error instanceof MigrationError && error.message.includes('snapshot was restored') && !!error.backupPath; }
    const partial = await store.database.run(connection => connection.getFirstAsync("SELECT name FROM sqlite_schema WHERE name = 'partial_step1'"));
    verify('Native SQLite backup/restore and transactional DDL', recovered && partial === null && (await store.trips.getTripById(trip.id))?.title === trip.title);
    const vaultId = store.vault.id;
    await store.close();
    store = await openVaultDatabase(name);
    const persisted = await store.trips.getTripById(trip.id);
    verify('Close/reopen preserves vault UUID and trip', store.vault.id === vaultId && persisted?.id === trip.id && persisted.dates.certainty === 'approximate');
    const cleared = await store.trips.updateBasicTripFields(trip.id, { dates: unknownDates(), summary: null });
    verify('Unknown remains unknown after correction', cleared.dates.start.precision === 'unknown' && cleared.dates.end === null && cleared.dates.certainty === 'unknown');
    return results;
  } finally { await store.close(); }
}

