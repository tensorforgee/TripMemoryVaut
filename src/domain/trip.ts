import { parseDateSpec, type DateSpec } from './date-spec';
import { keys, record, text, utcTimestamp, uuid, ValidationError } from './validation';

export type TripFields = {
  title: string;
  status: 'draft' | 'saved';
  dates: DateSpec;
  summary: string | null;
  durationEstimateDays: number | null;
  isFavourite: boolean;
};

export type Trip = TripFields & {
  id: string;
  vaultId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CreateTripDraft = Pick<TripFields, 'title'> & Partial<Omit<TripFields, 'title' | 'status'>>;
export type TripPatch = Partial<TripFields>;
const fieldNames = ['title', 'status', 'dates', 'summary', 'durationEstimateDays', 'isFavourite'];

export function parseTripFields(input: unknown): TripFields {
  const value = record(input, 'trip');
  keys(value, fieldNames, 'trip');
  if (value.status !== 'draft' && value.status !== 'saved') throw new ValidationError('trip.status', 'must be draft or saved');
  if (typeof value.isFavourite !== 'boolean') throw new ValidationError('trip.isFavourite', 'must be boolean');
  if (value.durationEstimateDays !== null && (typeof value.durationEstimateDays !== 'number'
    || !Number.isSafeInteger(value.durationEstimateDays) || value.durationEstimateDays < 1)) {
    throw new ValidationError('trip.durationEstimateDays', 'must be a positive integer or null');
  }
  return {
    title: text(value.title, 'trip.title'), status: value.status, dates: parseDateSpec(value.dates),
    summary: value.summary === null ? null : text(value.summary, 'trip.summary'),
    durationEstimateDays: value.durationEstimateDays as number | null, isFavourite: value.isFavourite,
  };
}

export function parseTrip(input: unknown): Trip {
  const value = record(input, 'trip');
  keys(value, [...fieldNames, 'id', 'vaultId', 'createdAt', 'updatedAt', 'deletedAt'], 'trip');
  const fields = Object.fromEntries(fieldNames.map(key => [key, value[key]]));
  const createdAt = utcTimestamp(value.createdAt, 'trip.createdAt');
  const updatedAt = utcTimestamp(value.updatedAt, 'trip.updatedAt');
  return {
    ...parseTripFields(fields), id: uuid(value.id, 'trip.id'), vaultId: uuid(value.vaultId, 'trip.vaultId'),
    createdAt, updatedAt, deletedAt: value.deletedAt === null ? null : utcTimestamp(value.deletedAt, 'trip.deletedAt'),
  };
}

export function parseTripPatch(input: unknown, current: Trip): TripFields {
  const patch = record(input, 'patch');
  keys(patch, fieldNames, 'patch');
  // Explicit undefined is invalid; omitted fields remain unchanged.
  return parseTripFields({ ...Object.fromEntries(fieldNames.map(key => [key, current[key as keyof TripFields]])), ...patch });
}
