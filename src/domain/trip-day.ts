import { parseDateSpec, type DateSpec } from './date-spec';
import { keys, record, text } from './validation';

export type TripDayFields = { label: string | null; dates: DateSpec | null };
export type TripDay = TripDayFields & {
  id: string; vaultId: string; tripId: string; position: number;
  createdAt: string; updatedAt: string; deletedAt: string | null;
};
export function parseTripDayFields(input: unknown): TripDayFields {
  const value = record(input, 'tripDay');
  keys(value, ['label', 'dates'], 'tripDay');
  return { label: value.label === null ? null : text(value.label, 'tripDay.label'),
    dates: value.dates === null ? null : parseDateSpec(value.dates) };
}
