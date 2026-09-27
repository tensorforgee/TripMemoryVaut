import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDateSpec, dateSortKey, unknownDates } from '../../.expo/step1-tests/domain/date-spec.js';
import { parseTripFields, parseTrip } from '../../.expo/step1-tests/domain/trip.js';

const spec = (start, end = null, certainty = 'exact', source = 'user') => ({ start, end, certainty, source });

test('day, month, year and unknown retain their distinct precision', () => {
  for (const [precision, value] of [['day', '2024-02-29'], ['month', '2022-12'], ['year', '2022']]) {
    const input = spec({ precision, value });
    assert.deepEqual(parseDateSpec(input), input);
    assert.equal(parseDateSpec(input).end, null);
  }
  assert.deepEqual(parseDateSpec(unknownDates()), unknownDates());
});

test('approximate dates retain certainty, provenance and label', () => {
  for (const source of ['user', 'photo_suggestion', 'import']) {
    const input = { ...spec({ precision: 'day', value: '2001-06-10' }, null, 'approximate', source), label: 'summer after college' };
    assert.deepEqual(parseDateSpec(input), input);
  }
});

test('calendar validation rejects malformed dates and invalid leap days', () => {
  for (const value of ['2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-00-01', '2024-01-00', '24-01-01', '2024-1-01', '2024-01-01T00:00:00Z', '0000-01-01']) {
    assert.throws(() => parseDateSpec(spec({ precision: 'day', value })), /dates.start/);
  }
  for (const value of ['2024-00', '2024-13', '2024-2']) assert.throws(() => parseDateSpec(spec({ precision: 'month', value })));
  assert.doesNotThrow(() => parseDateSpec(spec({ precision: 'day', value: '2000-02-29' })));
});

test('endpoint order uses feasible ranges without inventing missing endpoints', () => {
  assert.throws(() => parseDateSpec(spec({ precision: 'day', value: '2024-05-02' }, { precision: 'day', value: '2024-05-01' })), /precede/);
  assert.throws(() => parseDateSpec(spec({ precision: 'month', value: '2024-05' }, { precision: 'year', value: '2023' })), /precede/);
  assert.doesNotThrow(() => parseDateSpec(spec({ precision: 'month', value: '2024-05' }, { precision: 'day', value: '2024-05-01' })));
  assert.doesNotThrow(() => parseDateSpec(spec({ precision: 'unknown' }, { precision: 'year', value: '2022' }, 'approximate')));
  assert.deepEqual(parseDateSpec({ ...unknownDates(), end: { precision: 'unknown' } }).end, { precision: 'unknown' });
});

test('invalid shapes, certainty and source fail without silently normalizing history', () => {
  for (const input of [null, [], {}, { ...unknownDates(), start: { precision: 'unknown', value: '2024' } },
    { ...unknownDates(), certainty: 'exact' }, { ...spec({ precision: 'year', value: '2024' }), certainty: 'unknown' },
    { ...unknownDates(), source: 'today' }, { ...unknownDates(), certainty: 'likely' }, { ...unknownDates(), label: '' },
    { ...unknownDates(), end: undefined }, { ...unknownDates(), timezone: 'UTC' }]) {
    assert.throws(() => parseDateSpec(input));
  }
});

test('derived sort keys never change DateSpec; unknown start sorts as unknown', () => {
  const input = spec({ precision: 'month', value: '2022-12' }, null, 'approximate');
  const original = structuredClone(input);
  assert.deepEqual(dateSortKey(input), { sortDate: '2022-12-01', sortPrecision: 'month' });
  assert.deepEqual(input, original);
  assert.deepEqual(dateSortKey(spec({ precision: 'unknown' }, { precision: 'year', value: '2022' }, 'approximate')),
    { sortDate: null, sortPrecision: 'unknown' });
});

test('typed Trip validation rejects invalid fields, identities and audit timestamps', () => {
  const fields = { title: 'Old trip', status: 'draft', dates: unknownDates(), summary: null, durationEstimateDays: null, isFavourite: false };
  assert.deepEqual(parseTripFields(fields), fields);
  for (const patch of [{ title: ' ' }, { status: 'deleted' }, { summary: 2 }, { durationEstimateDays: 0 },
    { durationEstimateDays: 1.5 }, { durationEstimateDays: NaN }, { isFavourite: 1 }]) {
    assert.throws(() => parseTripFields({ ...fields, ...patch }));
  }
  const trip = { ...fields, id: '12345678-1234-4234-8234-123456789abc', vaultId: '12345678-1234-4234-8234-123456789abd',
    createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z', deletedAt: null };
  assert.deepEqual(parseTrip(trip), trip);
  assert.throws(() => parseTrip({ ...trip, id: 'trip-1' }));
  assert.throws(() => parseTrip({ ...trip, createdAt: '2026-02-30T00:00:00.000Z' }));
});
