import { keys, record, text, ValidationError } from './validation';

export type PlaceFields = {
  name: string; latitude: number | null; longitude: number | null;
  coordinatePrecision: 'unknown' | 'point' | 'area';
  source: 'user' | 'exif' | 'provider' | 'import';
  provenance: { note?: string }; aliases: string[];
};
export type Place = PlaceFields & { id: string; vaultId: string; createdAt: string; updatedAt: string; deletedAt: string | null };
export type CreatePlace = Pick<PlaceFields, 'name'> & Partial<Omit<PlaceFields, 'name'>>;

export function parseCoordinates(latitude: unknown, longitude: unknown): { latitude: number | null; longitude: number | null } {
  if (latitude === null && longitude === null) return { latitude: null, longitude: null };
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new ValidationError('coordinates', 'enter both latitude (-90 to 90) and longitude (-180 to 180), or leave both unknown');
  }
  return { latitude, longitude };
}
export function parsePlaceFields(input: unknown): PlaceFields {
  const value = record(input, 'place');
  keys(value, ['name', 'latitude', 'longitude', 'coordinatePrecision', 'source', 'provenance', 'aliases'], 'place');
  const coordinates = parseCoordinates(value.latitude, value.longitude);
  if (typeof value.coordinatePrecision !== 'string' || !['unknown', 'point', 'area'].includes(value.coordinatePrecision)) throw new ValidationError('place.coordinatePrecision', 'is invalid');
  if (coordinates.latitude === null && value.coordinatePrecision !== 'unknown') throw new ValidationError('place.coordinatePrecision', 'must be unknown without coordinates');
  if (typeof value.source !== 'string' || !['user', 'exif', 'provider', 'import'].includes(value.source)) throw new ValidationError('place.source', 'is invalid');
  const provenance = record(value.provenance, 'place.provenance');
  keys(provenance, ['note'], 'place.provenance');
  if (!Array.isArray(value.aliases)) throw new ValidationError('place.aliases', 'must be a list');
  return { name: text(value.name, 'place.name'), ...coordinates, coordinatePrecision: value.coordinatePrecision as PlaceFields['coordinatePrecision'],
    source: value.source as PlaceFields['source'], provenance: provenance.note === undefined ? {} : { note: text(provenance.note, 'place.provenance.note') },
    aliases: value.aliases.map(alias => text(alias, 'place.alias')) };
}
export function placeFields(input: CreatePlace): PlaceFields {
  return parsePlaceFields({ latitude: null, longitude: null, coordinatePrecision: 'unknown', source: 'user', provenance: {}, aliases: [], ...input });
}
