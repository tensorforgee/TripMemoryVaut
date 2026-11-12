import { parseDateSpec, type DateSpec } from './date-spec';
import { record, text, uuid } from './validation';

export type MemoryInput = {
  title: string; body: string; dates: DateSpec | null;
  dayId: string | null; stopId: string | null; mediaIds: string[];
};
export type Memory = MemoryInput & {
  id: string; tripId: string; createdAt: string; updatedAt: string;
};
export function memoryInput(input: unknown): MemoryInput {
  const value = record(input, 'memory');
  const title = text(value.title, 'Title'), body = text(value.body, 'Description');
  if (title.length > 200 || body.length > 1000000) throw new Error('Title allows 200 characters; description allows 1,000,000.');
  const dayId = value.dayId === null ? null : uuid(value.dayId, 'dayId');
  const stopId = value.stopId === null ? null : uuid(value.stopId, 'stopId');
  if (dayId && stopId) throw new Error('Choose one timeline section or Stop context.');
  if (!Array.isArray(value.mediaIds) || value.mediaIds.length > 1000) throw new Error('Choose up to 1,000 imported photos.');
  const mediaIds = value.mediaIds.map(id => uuid(id, 'mediaId'));
  if (new Set(mediaIds).size !== mediaIds.length) throw new Error('Duplicate photo attachment.');
  return { title, body, dates: value.dates === null ? null : parseDateSpec(value.dates), dayId, stopId, mediaIds };
}
