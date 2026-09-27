import { keys, record, text, ValidationError } from './validation';

export type PartialDate =
  | { precision: 'day'; value: string }
  | { precision: 'month'; value: string }
  | { precision: 'year'; value: string }
  | { precision: 'unknown' };

export type DateSpec = {
  start: PartialDate;
  end: PartialDate | null;
  certainty: 'exact' | 'approximate' | 'unknown';
  source: 'user' | 'photo_suggestion' | 'import';
  label?: string;
};

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parsePartialDate(input: unknown, field = 'date'): PartialDate {
  const date = record(input, field);
  if (date.precision === 'unknown') {
    keys(date, ['precision'], field);
    return { precision: 'unknown' };
  }
  keys(date, ['precision', 'value'], field);
  const patterns = { day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/ };
  if (date.precision !== 'day' && date.precision !== 'month' && date.precision !== 'year') {
    throw new ValidationError(`${field}.precision`, 'must be day, month, year, or unknown');
  }
  const value = date.value;
  if (typeof value !== 'string' || !patterns[date.precision].test(value)) {
    throw new ValidationError(`${field}.value`, 'must match its calendar precision');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || (month !== undefined && (month < 1 || month > 12))
    || (day !== undefined && (day < 1 || day > daysInMonth(year, month)))) {
    throw new ValidationError(`${field}.value`, 'is not a valid calendar date');
  }
  return { precision: date.precision, value };
}

// Bounds are only for validation/sorting, never evidence of an exact travel date.
function bounds(date: Exclude<PartialDate, { precision: 'unknown' }>): [string, string] {
  if (date.precision === 'day') return [date.value, date.value];
  if (date.precision === 'year') return [`${date.value}-01-01`, `${date.value}-12-31`];
  const [year, month] = date.value.split('-').map(Number);
  return [`${date.value}-01`, `${date.value}-${daysInMonth(year, month)}`];
}

export function parseDateSpec(input: unknown): DateSpec {
  const date = record(input, 'dates');
  keys(date, ['start', 'end', 'certainty', 'source', 'label'], 'dates');
  const start = parsePartialDate(date.start, 'dates.start');
  const end = date.end === null ? null : parsePartialDate(date.end, 'dates.end');
  if (date.certainty !== 'exact' && date.certainty !== 'approximate' && date.certainty !== 'unknown') {
    throw new ValidationError('dates.certainty', 'is not supported');
  }
  if (date.source !== 'user' && date.source !== 'photo_suggestion' && date.source !== 'import') {
    throw new ValidationError('dates.source', 'is not supported');
  }
  const fullyUnknown = start.precision === 'unknown' && (!end || end.precision === 'unknown');
  if (fullyUnknown !== (date.certainty === 'unknown')) {
    throw new ValidationError('dates.certainty', 'must be unknown exactly when both endpoints are unknown');
  }
  if (start.precision !== 'unknown' && end && end.precision !== 'unknown' && bounds(start)[0] > bounds(end)[1]) {
    throw new ValidationError('dates.end', 'cannot precede the start');
  }
  return {
    start, end, certainty: date.certainty, source: date.source,
    ...(date.label === undefined ? {} : { label: text(date.label, 'dates.label') }),
  };
}

export function unknownDates(): DateSpec {
  return { start: { precision: 'unknown' }, end: null, certainty: 'unknown', source: 'user' };
}

export function dateSortKey(dates: DateSpec): { sortDate: string | null; sortPrecision: PartialDate['precision'] } {
  return {
    sortDate: dates.start.precision === 'unknown' ? null : bounds(dates.start)[0],
    sortPrecision: dates.start.precision,
  };
}
