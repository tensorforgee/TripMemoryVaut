import { uuid } from '../../domain/validation';
import type { Coordinate } from './model';

export type PinInput = { mediaId: string; coordinate: Coordinate; note: string | null };
export function pinCoordinate(value: unknown): Coordinate {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === 'number' && Number.isFinite(n))
    || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error('Select a valid map coordinate');
  // Unlike inferred Stop coordinates, deliberate (0,0) is valid.
  return [value[0], value[1]];
}
export function pinInput(value: PinInput): PinInput {
  uuid(value.mediaId, 'mediaId');
  if (value.note !== null && (typeof value.note !== 'string' || value.note.length > 10000)) throw new Error('Note must be at most 10,000 characters');
  return { mediaId: value.mediaId, coordinate: pinCoordinate(value.coordinate), note: value.note?.trim() || null };
}
export type PinDraft = { id?: string; coordinate: Coordinate; mediaId: string | null; note: string; moving: boolean };
export function longPressPin(coordinate: unknown, draft: PinDraft | null): PinDraft {
  const point = pinCoordinate(coordinate);
  return draft?.moving ? { ...draft, coordinate: point, moving: false }
    : { coordinate: point, mediaId: null, note: '', moving: false };
}
export const coordinateLabel = (point: Coordinate) => `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
