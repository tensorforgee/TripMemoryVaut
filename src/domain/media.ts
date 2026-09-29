import { keys, record, uuid, ValidationError } from './validation';

export type SourceMetadata = {
  exif: Readonly<Record<string, string>>;
  capture: { local: string; utc: string | null; offset_minutes: number | null; precision: 'second'; source: 'exif'; warnings: string[] } | null;
  gps: { latitude: number; longitude: number } | null;
  warnings: string[];
};
export type MediaEvidence = {
  sha256: string; byteSize: number; mimeType: 'image/jpeg' | 'image/png'; extension: 'jpg' | 'png';
  width: number | null; height: number | null; originalFilename: string | null;
  sourceFidelity: 'original_confirmed' | 'picker_representation' | 'unknown';
  sourceMetadata: SourceMetadata; parserVersion: number;
};
export function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ValidationError(field, 'invalid integer');
  return value;
}
export function parseMedia(input: unknown): MediaEvidence {
  const v = record(input, 'media');
  keys(v, ['sha256','byteSize','mimeType','extension','width','height','originalFilename','sourceFidelity','sourceMetadata','parserVersion'], 'media');
  if (typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)) throw new ValidationError('sha256', 'invalid hash');
  if (!((v.mimeType === 'image/jpeg' && v.extension === 'jpg') || (v.mimeType === 'image/png' && v.extension === 'png'))) throw new ValidationError('format', 'unsupported');
  integer(v.byteSize, 'byteSize', 1, 100 * 1024 * 1024);
  if ((v.width === null) !== (v.height === null)) throw new ValidationError('dimensions', 'requires both dimensions');
  if (v.width !== null) { integer(v.width, 'width', 1); integer(v.height, 'height', 1); if ((v.width as number) * (v.height as number) > 100000000) throw new ValidationError('dimensions', 'exceeds pixel limit'); }
  if (v.originalFilename !== null && typeof v.originalFilename !== 'string') throw new ValidationError('filename', 'invalid');
  if (!['original_confirmed', 'picker_representation', 'unknown'].includes(String(v.sourceFidelity))) throw new ValidationError('fidelity', 'invalid');
  integer(v.parserVersion, 'parserVersion', 1);
  const m = record(v.sourceMetadata, 'sourceMetadata');
  keys(m, ['exif','capture','gps','warnings'], 'sourceMetadata');
  const exif = record(m.exif, 'exif');
  if (Object.values(exif).some(s => typeof s !== 'string')) throw new ValidationError('exif', 'raw values must be strings');
  if (!Array.isArray(m.warnings) || m.warnings.some(s => typeof s !== 'string')) throw new ValidationError('warnings', 'invalid');
  if (m.gps !== null) {
    const g = record(m.gps, 'gps');
    keys(g, ['latitude','longitude'], 'gps');
    if (typeof g.latitude !== 'number' || !Number.isFinite(g.latitude) || Math.abs(g.latitude) > 90 || typeof g.longitude !== 'number' || !Number.isFinite(g.longitude) || Math.abs(g.longitude) > 180) throw new ValidationError('gps', 'invalid coordinates');
  }
  if (m.capture !== null) {
    const c = record(m.capture, 'capture');
    keys(c, ['local','utc','offset_minutes','precision','source','warnings'], 'capture');
    if (typeof c.local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(c.local) || !Number.isFinite(Date.parse(c.local + 'Z')) || new Date(c.local + 'Z').toISOString().slice(0, 19) !== c.local) throw new ValidationError('capture', 'invalid wall time');
    if (c.offset_minutes !== null) integer(c.offset_minutes, 'offset', -840, 840);
    if (c.utc !== null && (typeof c.utc !== 'string' || !Number.isFinite(Date.parse(c.utc)) || c.offset_minutes === null || Date.parse(c.utc) !== Date.parse(c.local + 'Z') - (c.offset_minutes as number) * 60000)) throw new ValidationError('capture.utc', 'inconsistent instant');
    if (c.precision !== 'second' || c.source !== 'exif' || !Array.isArray(c.warnings) || c.warnings.some(s => typeof s !== 'string')) throw new ValidationError('capture', 'invalid provenance');
  }
  // Snapshot evidence: caller mutations cannot change the value that is persisted.
  return JSON.parse(JSON.stringify(v)) as MediaEvidence;
}
export type TripMediaFields = { tripId: string; mediaId: string; position: number; caption: string | null; isFavourite: boolean; dayId: string | null; stopId: string | null };
export function parseTripMedia(input: unknown): TripMediaFields {
  const v = record(input, 'tripMedia');
  keys(v, ['tripId','mediaId','position','caption','isFavourite','dayId','stopId'], 'tripMedia');
  uuid(v.tripId, 'tripId'); uuid(v.mediaId, 'mediaId'); integer(v.position, 'position');
  if (v.dayId !== null) uuid(v.dayId, 'dayId');
  if (v.stopId !== null) uuid(v.stopId, 'stopId');
  if (v.caption !== null && (typeof v.caption !== 'string' || !v.caption.trim())) throw new ValidationError('caption', 'invalid');
  if (typeof v.isFavourite !== 'boolean') throw new ValidationError('isFavourite', 'invalid');
  return { ...v } as TripMediaFields;
}
