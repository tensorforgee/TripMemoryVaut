import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from './sqlite-harness.mjs';
import { configureConnection, LocalDatabase } from '../../.expo/step1-tests/core/database/database.js';
import { migrations, migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { unknownDates } from '../../.expo/step1-tests/domain/date-spec.js';

test('initial migration creates only requested tables and is idempotent', async t => {
  const f = await fixture(t);
  const tables = await f.connection.getAllAsync("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name");
  assert.deepEqual(tables.map(row => row.name), ['chapters', 'companions', 'draft_suggestions', 'import_batches', 'import_items', 'local_media_files', 'media', 'places', 'schema_migrations', 'stops', 'trip_chapters', 'trip_companions', 'trip_days', 'trip_media', 'trips', 'vaults']);
  assert.equal((await f.connection.getFirstAsync('PRAGMA foreign_keys')).foreign_keys, 1);
  assert.equal((await f.connection.getFirstAsync('PRAGMA journal_mode')).journal_mode, 'wal');
  assert.equal((await f.connection.getFirstAsync('PRAGMA synchronous')).synchronous, 2);
  assert.equal((await f.connection.getFirstAsync('PRAGMA busy_timeout')).timeout, 5000);
  const before = await f.connection.getAllAsync('SELECT * FROM schema_migrations');
  await migrateDatabase(f.database, f.services);
  assert.deepEqual(await f.connection.getAllAsync('SELECT * FROM schema_migrations'), before);
  assert.equal(f.backups.length, 1);
  assert.equal(before[0].checksum, await f.services.checksum(migrations[0].sql));
});

test('edited, missing, gapped, and newer migration histories fail closed', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'Keep me' });
  await assert.rejects(migrateDatabase(f.database, f.services, [{ version: 1, sql: migrations[0].sql + '\n-- edited' }]), /modified/);
  await assert.rejects(migrateDatabase(f.database, f.services, []), /Unsupported/);
  await assert.rejects(migrateDatabase(f.database, f.services, [{ version: 2, sql: '' }]), /contiguous/);
  await f.connection.execAsync('UPDATE schema_migrations SET version = version + 10');
  await assert.rejects(migrateDatabase(f.database, f.services), /Unsupported/);
  assert.equal((await f.trips.getTripById(trip.id)).title, 'Keep me');
  assert.equal(f.backups.length, 1);
});

test('failed upgrade restores a SQLite backup including committed WAL data', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'Preserved from WAL' });
  const failed = [...migrations, { version: migrations.length + 1, sql: "UPDATE trips SET title = 'Lost'; CREATE TABLE partial (id TEXT); INSERT INTO does_not_exist VALUES (1);" }];
  await assert.rejects(migrateDatabase(f.database, f.services, failed), error => {
    assert.match(error.message, /snapshot was restored/);
    assert.ok(error.backupPath.endsWith('.sqlite'));
    return true;
  });
  assert.equal(f.backups[1].restored, true);
  assert.equal((await f.trips.getTripById(trip.id)).title, 'Preserved from WAL');
  assert.equal(await f.connection.getFirstAsync("SELECT name FROM sqlite_schema WHERE name = 'partial'"), null);
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) AS n FROM schema_migrations')).n, migrations.length);
  await migrateDatabase(f.database, f.services, [...migrations, { version: migrations.length + 1, sql: 'CREATE INDEX trips_title_check ON trips(title);' }]);
  assert.equal((await f.connection.getFirstAsync('SELECT max(version) AS version FROM schema_migrations')).version, migrations.length + 1);
});

test('failed first migration preserves the empty database and can be retried', async t => {
  const f = await fixture(t, false);
  await assert.rejects(migrateDatabase(f.database, f.services, [{ version: 1, sql: 'CREATE TABLE partial (id TEXT); INVALID SQL;' }]), /snapshot was restored/);
  assert.equal((await f.connection.getAllAsync("SELECT name FROM sqlite_schema WHERE type = 'table'")).length, 0);
  await migrateDatabase(f.database, f.services);
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) AS n FROM schema_migrations')).n, migrations.length);
});

test('backup failure prevents migration writes', async t => {
  const f = await fixture(t, false);
  await assert.rejects(migrateDatabase(f.database, { ...f.services, backup: async () => { throw new Error('Disk full'); } }), /Disk full/);
  assert.equal((await f.connection.getAllAsync("SELECT name FROM sqlite_schema WHERE type = 'table'")).length, 0);
});

test('vault identity is stable and concurrent initialization creates only one vault', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => getOrCreateVault(f.database, randomUUID)));
  assert.ok(results.every(vault => vault.id === f.vault.id));
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) AS n FROM vaults')).n, 1);
});

test('create/read/update retains UUIDs, unknown dates and audit fields across reopen', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: "Brother's trip; DROP TABLE trips; --" });
  assert.match(trip.id, /^[0-9a-f-]{14}4[0-9a-f-]{21}$/);
  assert.equal(trip.status, 'draft');
  assert.deepEqual(trip.dates, unknownDates());
  assert.equal(trip.durationEstimateDays, null);
  assert.deepEqual(await f.trips.getTripById(trip.id), trip);
  const updated = await f.trips.updateBasicTripFields(trip.id, { title: 'Renamed', summary: 'A memory', isFavourite: true, status: 'saved' });
  assert.equal(updated.id, trip.id);
  assert.equal(updated.createdAt, trip.createdAt);
  await f.database.close();
  const reopened = new NodeConnection(f.path);
  try {
    await configureConnection(reopened);
    const db = new LocalDatabase(reopened);
    const vault = await getOrCreateVault(db, randomUUID);
    assert.equal(vault.id, f.vault.id);
    assert.deepEqual(await new TripRepository(db, vault.id, randomUUID).getTripById(trip.id), updated);
  } finally { await reopened.closeAsync(); }
});

test('approximate month and unknown updates preserve evidence and technical sort precision', async t => {
  const f = await fixture(t);
  const dates = { start: { precision: 'month', value: '2022-12' }, end: null, certainty: 'approximate', source: 'import', label: 'winter after college' };
  const trip = await f.trips.createTripDraft({ title: 'Winter', dates, durationEstimateDays: 5 });
  assert.deepEqual(trip.dates, dates);
  let row = await f.connection.getFirstAsync('SELECT sort_date, sort_precision, dates_json FROM trips WHERE id = ?', trip.id);
  assert.equal(row.sort_date, '2022-12-01');
  assert.equal(row.sort_precision, 'month');
  assert.equal(JSON.parse(row.dates_json).start.value, '2022-12');
  const updated = await f.trips.updateBasicTripFields(trip.id, { dates: unknownDates(), durationEstimateDays: null, summary: null });
  assert.deepEqual(updated.dates, unknownDates());
  row = await f.connection.getFirstAsync('SELECT sort_date, sort_precision FROM trips WHERE id = ?', trip.id);
  assert.equal(row.sort_date, null);
  assert.equal(row.sort_precision, 'unknown');
});

test('list filters status, orders known dates before unknown, and bounds results', async t => {
  const f = await fixture(t);
  const undated = await f.trips.createTripDraft({ title: 'Undated' });
  const dated = await f.trips.createTripDraft({ title: 'Known', dates: { start: { precision: 'year', value: '2022' }, end: null, certainty: 'exact', source: 'user' } });
  await f.trips.updateBasicTripFields(dated.id, { status: 'saved' });
  assert.deepEqual((await f.trips.listTrips()).map(trip => trip.id), [dated.id, undated.id]);
  assert.deepEqual((await f.trips.listTrips({ status: 'draft' })).map(trip => trip.id), [undated.id]);
  assert.equal((await f.trips.listTrips({ limit: 1, offset: 1 }))[0].id, undated.id);
  assert.throws(() => f.trips.listTrips({ limit: 101 }), /pagination/);
});

test('invalid and failed writes roll back without damaging data or blocking later writes', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'Original' });
  await assert.rejects(f.trips.updateBasicTripFields(trip.id, { title: 'Bad', dates: { ...unknownDates(), certainty: 'exact' } }));
  await assert.rejects(f.trips.updateBasicTripFields(trip.id, { id: randomUUID() }), /not supported/);
  await assert.rejects(f.trips.createTripDraft({ title: ' ' }), /nonempty/);
  assert.equal((await f.trips.getTripById(trip.id)).title, 'Original');
  await assert.rejects(f.database.transaction(async connection => {
    await connection.runAsync('UPDATE trips SET title = ? WHERE id = ?', 'Rollback me', trip.id);
    await connection.runAsync('UPDATE trips SET is_favourite = 4 WHERE id = ?', trip.id);
  }));
  assert.equal((await f.trips.getTripById(trip.id)).title, 'Original');
  await f.trips.updateBasicTripFields(trip.id, { title: 'Still writable' });
});

test('concurrent patches do not lose fields; reads wait for transaction completion', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'Original' });
  await Promise.all([f.trips.updateBasicTripFields(trip.id, { title: 'Title' }), f.trips.updateBasicTripFields(trip.id, { summary: 'Summary' })]);
  assert.equal((await f.trips.getTripById(trip.id)).title, 'Title');
  assert.equal((await f.trips.getTripById(trip.id)).summary, 'Summary');
  const write = f.database.transaction(async connection => {
    await connection.runAsync("UPDATE trips SET title = 'Uncommitted' WHERE id = ?", trip.id);
    await new Promise(resolve => setTimeout(resolve, 10));
    throw new Error('Abort');
  });
  const read = f.trips.getTripById(trip.id);
  await assert.rejects(write, /Abort/);
  assert.equal((await read).title, 'Title');
});

test('vault boundaries, tombstones and schema constraints are enforced', async t => {
  const f = await fixture(t);
  const trip = await f.trips.createTripDraft({ title: 'Private' });
  const other = new TripRepository(f.database, randomUUID(), randomUUID);
  assert.equal(await other.getTripById(trip.id), null);
  assert.deepEqual(await other.listTrips(), []);
  await assert.rejects(other.updateBasicTripFields(trip.id, { title: 'Wrong vault' }), /not found/);
  await assert.rejects(other.createTripDraft({ title: 'No vault' }), /active vault/);
  await assert.rejects(f.connection.execAsync('DELETE FROM vaults'), /FOREIGN KEY/);
  for (const sql of ["UPDATE trips SET dates_json = 'not-json'", "UPDATE trips SET is_favourite = 2", "UPDATE trips SET duration_estimate_days = 0", "UPDATE trips SET status = 'bad'"]) {
    await assert.rejects(f.connection.execAsync(sql));
  }
  await f.connection.runAsync('UPDATE trips SET deleted_at = ? WHERE id = ?', new Date().toISOString(), trip.id);
  assert.equal(await f.trips.getTripById(trip.id), null);
  assert.deepEqual(await f.trips.listTrips(), []);
  await assert.rejects(f.trips.updateBasicTripFields(trip.id, { title: 'Deleted' }), /not found/);
  const alive = await f.trips.createTripDraft({ title: 'Hidden with vault' });
  await f.connection.runAsync('UPDATE vaults SET deleted_at = ?', new Date().toISOString());
  assert.equal(await f.trips.getTripById(alive.id), null);
  assert.deepEqual(await f.trips.listTrips(), []);
  await assert.rejects(f.trips.createTripDraft({ title: 'Deleted parent' }), /active vault/);
  await assert.rejects(getOrCreateVault(f.database, randomUUID), /recovery/);
});

test('deleted migration ledger rows are detected using SQLite user_version', async t => {
  const f = await fixture(t);
  await f.connection.execAsync('DELETE FROM schema_migrations');
  await assert.rejects(migrateDatabase(f.database, f.services), /history disagree/);
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) AS n FROM vaults')).n, 1);
});
