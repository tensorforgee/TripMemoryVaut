import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fixture } from '../step1/sqlite-harness.mjs';
import { migrations, migrateDatabase } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';

for (let version = 1; version < migrations.length; version++) {
  test(`populated schema ${version} upgrades to current without changing trip evidence`, async t => {
    const f = await fixture(t, false);
    await migrateDatabase(f.database, f.services, migrations.slice(0, version));
    const vault = await getOrCreateVault(f.database, randomUUID);
    const trips = new TripRepository(f.database, vault.id, randomUUID);
    const trip = await trips.createTripDraft({ title: 'Synthetic migration fixture' });
    const before = await f.connection.getAllAsync('SELECT * FROM trips');
    await migrateDatabase(f.database, f.services);
    // Schema 2 adds order_revision; compare every pre-existing column exactly.
    const columns = Object.keys(before[0]).join(',');
    assert.deepEqual(await f.connection.getAllAsync(`SELECT ${columns} FROM trips`), before);
    assert.equal((await trips.getTripById(trip.id)).dates.certainty, 'unknown');
    assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version, 12);
    assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'), []);
    assert.equal((await f.connection.getFirstAsync('PRAGMA integrity_check')).integrity_check, 'ok');
    assert.deepEqual(await f.connection.getAllAsync('SELECT * FROM photo_memory_pins'), []);
    await migrateDatabase(f.database, f.services);
  });
}
