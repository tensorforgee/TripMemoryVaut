import { parseDateSpec, type DateSpec } from './date-spec';
import { keys, record, text, uuid, ValidationError } from './validation';

export type StopFields = {
  placeId: string; kind: 'visit' | 'stay' | 'transit'; visitConfirmed: boolean;
  detailCertainty: 'exact' | 'approximate' | 'unknown'; source: 'user' | 'photo_suggestion' | 'import';
  dates: DateSpec | null; note: string | null; lodgingLabel: string | null; checkoutDates: DateSpec | null;
};
export type Stop = StopFields & { id: string; vaultId: string; tripId: string; position: number; createdAt: string; updatedAt: string; deletedAt: string | null };
export type CreateStop = Pick<StopFields, 'placeId'> & Partial<Omit<StopFields, 'placeId'>>;
export function orderedPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ValidationError('position', 'must be a nonnegative safe integer');
  return value;
}
export function parseStopFields(input: unknown): StopFields {
  const value = record(input, 'stop');
  keys(value, ['placeId', 'kind', 'visitConfirmed', 'detailCertainty', 'source', 'dates', 'note', 'lodgingLabel', 'checkoutDates'], 'stop');
  if (value.kind !== 'visit' && value.kind !== 'stay' && value.kind !== 'transit') throw new ValidationError('stop.kind', 'must be visit, stay or transit');
  if (value.detailCertainty !== 'exact' && value.detailCertainty !== 'approximate' && value.detailCertainty !== 'unknown') throw new ValidationError('stop.detailCertainty', 'is invalid');
  if (value.source !== 'user' && value.source !== 'photo_suggestion' && value.source !== 'import') throw new ValidationError('stop.source', 'is invalid');
  if (typeof value.visitConfirmed !== 'boolean') throw new ValidationError('stop.visitConfirmed', 'must be boolean');
  const dates = value.dates === null ? null : parseDateSpec(value.dates);
  const checkoutDates = value.checkoutDates === null ? null : parseDateSpec(value.checkoutDates);
  const lodgingLabel = value.lodgingLabel === null ? null : text(value.lodgingLabel, 'stop.lodgingLabel');
  if (value.kind !== 'stay' && (checkoutDates !== null || lodgingLabel !== null)) throw new ValidationError('stop', 'lodging and checkout require kind stay');
  if (dates && checkoutDates) {
    // Check only what the supplied precision supports; never synthesize endpoints.
    const checkIn = dates.end && dates.end.precision !== 'unknown' ? dates.end : dates.start;
    parseDateSpec({ start: checkIn, end: checkoutDates.start,
      certainty: checkIn.precision === 'unknown' && checkoutDates.start.precision === 'unknown' ? 'unknown' : 'exact', source: 'user' });
  }
  return { placeId: uuid(value.placeId, 'stop.placeId'), kind: value.kind, visitConfirmed: value.visitConfirmed,
    detailCertainty: value.detailCertainty, source: value.source, dates, checkoutDates, lodgingLabel,
    note: value.note === null ? null : text(value.note, 'stop.note') };
}
export function stopFields(input: CreateStop): StopFields {
  return parseStopFields({ kind: 'visit', visitConfirmed: true, detailCertainty: 'unknown', source: 'user', dates: null, note: null,
    lodgingLabel: null, checkoutDates: null, ...input });
}
