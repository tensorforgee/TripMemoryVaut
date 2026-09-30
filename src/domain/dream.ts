import { parseCoordinates } from './place';
import { parseDateSpec, type DateSpec } from './date-spec';
import { keys, record, text, utcTimestamp, uuid, ValidationError } from './validation';

export type DreamStatus = 'dreaming' | 'visited' | 'archived';
export type DreamFields = {
  title: string;
  note: string | null;
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
};
export type DreamDestination = DreamFields & {
  id: string;
  vaultId: string;
  placeId: string;
  addedDates: DateSpec;
  isArchived: boolean;
  status: DreamStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type CreateDream = Pick<DreamFields, 'title'> & Partial<Omit<DreamFields, 'title'>>;
export type DreamPatch = Partial<DreamFields>;

const fields = ['title', 'note', 'locationText', 'latitude', 'longitude'] as const;

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

export function parseDreamFields(input: unknown): DreamFields {
  const value = record(input, 'dream');
  keys(value, fields, 'dream');
  const coordinates = parseCoordinates(value.latitude, value.longitude);
  return {
    title: text(value.title, 'dream.title'),
    note: optionalText(value.note, 'dream.note'),
    locationText: optionalText(value.locationText, 'dream.locationText'),
    ...coordinates,
  };
}

export function dreamFields(input: CreateDream): DreamFields {
  return parseDreamFields({ note: null, locationText: null, latitude: null, longitude: null, ...input });
}

export function parseDreamStatus(value: unknown): DreamStatus {
  if (value !== 'dreaming' && value !== 'visited' && value !== 'archived') {
    throw new ValidationError('dream.status', 'must be dreaming, visited or archived');
  }
  return value;
}

export function parseDream(input: unknown): DreamDestination {
  const value = record(input, 'dream');
  keys(value, [...fields, 'id', 'vaultId', 'placeId', 'addedDates', 'isArchived', 'status', 'createdAt', 'updatedAt', 'deletedAt'], 'dream');
  if (typeof value.isArchived !== 'boolean') throw new ValidationError('dream.isArchived', 'must be boolean');
  const parsedFields = Object.fromEntries(fields.map(field => [field, value[field]]));
  return {
    ...parseDreamFields(parsedFields),
    id: uuid(value.id, 'dream.id'),
    vaultId: uuid(value.vaultId, 'dream.vaultId'),
    placeId: uuid(value.placeId, 'dream.placeId'),
    addedDates: parseDateSpec(value.addedDates),
    isArchived: value.isArchived,
    status: parseDreamStatus(value.status),
    createdAt: utcTimestamp(value.createdAt, 'dream.createdAt'),
    updatedAt: utcTimestamp(value.updatedAt, 'dream.updatedAt'),
    deletedAt: value.deletedAt === null ? null : utcTimestamp(value.deletedAt, 'dream.deletedAt'),
  };
}

export function parseDreamPatch(input: unknown, current: DreamDestination): DreamFields {
  const patch = record(input, 'patch');
  keys(patch, fields, 'patch');
  return parseDreamFields({
    ...Object.fromEntries(fields.map(field => [field, current[field]])),
    ...patch,
  });
}
