import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { dateLabel, formPatch, saveTripForm, tripForm, tripSections } from '../../.expo/step1-tests/features/trips/presentation.js';

test('UI form path creates a durable draft, publishes and edits all basic fields', async t => {
  const f = await fixture(t);
  let form = { ...tripForm(), title: ' College trip ', summary: ' A memory ' };
  const draft = await saveTripForm(f.trips, form);
  assert.equal(draft.title, 'College trip');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.dates.certainty, 'unknown');
  form = { ...form, title: 'Winter trip', startPrecision: 'month', start: '2022-12', approximate: true, isFavourite: true };
  const saved = await saveTripForm(f.trips, form, draft, 'saved');
  assert.equal(saved.id, draft.id);
  assert.equal(saved.status, 'saved');
  assert.equal(saved.summary, 'A memory');
  assert.equal(saved.dates.start.value, '2022-12');
  assert.equal(saved.dates.end, null);
  assert.equal(saved.isFavourite, true);
  const cleared = await saveTripForm(f.trips, { ...tripForm(saved), summary: '' }, saved);
  assert.equal(cleared.summary, null);
  await f.database.close();
  const reopened = new NodeConnection(f.path);
  try {
    await configureConnection(reopened);
    assert.deepEqual(await new TripRepository(new LocalDatabase(reopened), f.vault.id, randomUUID).getTripById(saved.id), cleared);
  } finally { await reopened.closeAsync(); }
});

test('invalid dates and failed edit transactions preserve every previous field', async t => {
  const f = await fixture(t);
  const trip = await saveTripForm(f.trips, { ...tripForm(), title: 'Original' });
  await assert.rejects(saveTripForm(f.trips, { ...tripForm(trip), title: 'Wrong', startPrecision: 'day', start: '2023-02-29' }, trip));
  await f.connection.execAsync("CREATE TRIGGER fail_edit BEFORE UPDATE ON trips BEGIN SELECT RAISE(ABORT, 'Disk test'); END;");
  await assert.rejects(saveTripForm(f.trips, { ...tripForm(trip), title: 'Changed', summary: 'New' }, trip), /Disk test/);
  assert.deepEqual(await f.trips.getTripById(trip.id), trip);
});

test('date controls roundtrip mixed precision, provenance, labels and unknown end', async t => {
  const f = await fixture(t);
  const dates = { start: { precision: 'month', value: '2022-12' }, end: { precision: 'year', value: '2023' }, certainty: 'approximate', source: 'import', label: 'College winter' };
  const trip = await f.trips.createTripDraft({ title: 'Trip', dates, durationEstimateDays: 5 });
  const updated = await saveTripForm(f.trips, { ...tripForm(trip), title: 'Rename' }, trip);
  assert.deepEqual(updated.dates, dates);
  assert.equal(updated.durationEstimateDays, 5);
  assert.equal(formPatch({ ...tripForm(trip), start: '2022-11' }, trip).dates.source, 'user');
  assert.equal(formPatch(tripForm()).dates.end, null);
});

test('human date labels never expose synthetic sort dates or timezone shifts', () => {
  const label = (start, end = null, certainty = 'exact') => dateLabel({ start, end, certainty, source: 'user' });
  assert.equal(label({ precision: 'day', value: '2024-02-29' }, { precision: 'day', value: '2024-03-02' }), '29 February 2024 – 2 March 2024');
  assert.equal(label({ precision: 'month', value: '2022-12' }), 'December 2022 · End unknown');
  assert.equal(label({ precision: 'year', value: '2022' }, null, 'approximate'), 'Approximate · 2022 · End unknown');
  assert.equal(label({ precision: 'unknown' }, null, 'unknown'), 'Date unknown');
  assert.equal(label({ precision: 'unknown' }, { precision: 'year', value: '2022' }), 'Start unknown – 2022');
  assert.equal(label({ precision: 'year', value: '0001' }), '0001 · End unknown');
});

test('exact range form validates endpoint order and rejects empty titles without creating rows', async t => {
  const f = await fixture(t);
  const form = { ...tripForm(), title: 'Leap trip', startPrecision: 'day', start: '2024-02-29', endPrecision: 'day', end: '2024-03-02' };
  const trip = await saveTripForm(f.trips, form);
  assert.equal(dateLabel(trip.dates), '29 February 2024 – 2 March 2024');
  await assert.rejects(saveTripForm(f.trips, { ...form, end: '2024-02-28' }), /precede/);
  await assert.rejects(saveTripForm(f.trips, { ...form, title: '  ' }), /nonempty/);
  assert.equal((await f.trips.listTrips()).length, 1);
});

test('SQLite list ordering is newest first, ties stable, undated last; sections and empty state', async t => {
  const f = await fixture(t);
  assert.deepEqual(tripSections(await f.trips.listTrips()), []);
  const undated = await f.trips.createTripDraft({ title: 'Unknown' });
  for (const year of ['2022', '2024', '2024']) {
    const trip = await saveTripForm(f.trips, { ...tripForm(), title: year, startPrecision: 'year', start: year });
    await f.trips.updateBasicTripFields(trip.id, { status: 'saved' });
  }
  let trips = await f.trips.listTrips();
  assert.deepEqual(trips.map(t => t.title), ['2024', '2024', '2022', 'Unknown']);
  assert.ok(trips[0].id < trips[1].id);
  assert.deepEqual(tripSections(trips).map(s => s.title), ['Saved trips', 'Drafts']);
  await f.trips.updateBasicTripFields(undated.id, { status: 'saved' });
  trips = await f.trips.listTrips();
  assert.deepEqual(tripSections(trips).map(s => s.title), ['Saved trips', 'Undated']);
  assert.deepEqual((await f.trips.listTrips({ limit: 2, offset: 2 })).map(t => t.id), trips.slice(2).map(t => t.id));
});

test('trash and restore preserve fields, vault ownership, draft status and survive reopen', async t => {
  const f = await fixture(t);
  const trip = await saveTripForm(f.trips, { ...tripForm(), title: 'Recover me', isFavourite: true });
  const other = new TripRepository(f.database, randomUUID(), randomUUID);
  await assert.rejects(other.trashTrip(trip.id), /not found/);
  await f.trips.trashTrip(trip.id);
  assert.equal(await f.trips.getTripById(trip.id), null);
  assert.deepEqual(tripSections(await f.trips.listTrips()), []);
  await assert.rejects(saveTripForm(f.trips, { ...tripForm(trip), title: 'No edit' }, trip), /not found/);
  assert.deepEqual(await other.listDeletedTrips(), []);
  await assert.rejects(other.restoreTrip(trip.id), /not found/);
  await f.database.close();
  const connection = new NodeConnection(f.path);
  try {
    await configureConnection(connection);
    const repo = new TripRepository(new LocalDatabase(connection), f.vault.id, randomUUID);
    const deleted = (await repo.listDeletedTrips())[0];
    assert.ok(deleted.deletedAt);
    await repo.restoreTrip(trip.id);
    const restored = await repo.getTripById(trip.id);
    assert.deepEqual({ ...restored, updatedAt: trip.updatedAt }, trip);
    assert.deepEqual(await repo.listDeletedTrips(), []);
    await assert.rejects(repo.restoreTrip(trip.id), /not found/);
  } finally { await connection.closeAsync(); }
});

test('subscriptions run after commit, never on rollback; deletion is transactional', async t => {
  const f = await fixture(t);
  let notifications = 0;
  const unsubscribe = f.trips.subscribe(() => { notifications++; });
  const trip = await f.trips.createTripDraft({ title: 'Keep me' });
  assert.equal(notifications, 1);
  await f.connection.execAsync("CREATE TRIGGER fail_delete BEFORE UPDATE OF deleted_at ON trips BEGIN SELECT RAISE(ABORT, 'Blocked'); END;");
  await assert.rejects(f.trips.trashTrip(trip.id), /Blocked/);
  assert.equal(notifications, 1);
  assert.deepEqual(await f.trips.getTripById(trip.id), trip);
  await f.connection.execAsync('DROP TRIGGER fail_delete');
  await f.trips.trashTrip(trip.id);
  await f.trips.restoreTrip(trip.id);
  assert.equal(notifications, 3);
  unsubscribe();
  await f.trips.updateBasicTripFields(trip.id, { title: 'Changed' });
  assert.equal(notifications, 3);
});
