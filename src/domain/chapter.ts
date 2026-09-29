import { keys, record, text, utcTimestamp, uuid, ValidationError } from './validation';

export type ChapterFields = { title: string; description: string | null; position: number };
export type Chapter = ChapterFields & {
  id: string; vaultId: string; createdAt: string; updatedAt: string; deletedAt: string | null;
};

// Version 1 normalization: compatibility normalization, trim and locale-independent lowercase.
export function normalizeChapterTitleV1(value: string): string { return text(value, 'chapter.title').normalize('NFKC').toLowerCase(); }

export function parseChapterFields(input: unknown): ChapterFields {
  const value = record(input, 'chapter');
  keys(value, ['title', 'description', 'position'], 'chapter');
  if (typeof value.position !== 'number' || !Number.isSafeInteger(value.position) || value.position < 0) {
    throw new ValidationError('chapter.position', 'must be a nonnegative safe integer');
  }
  return { title: text(value.title, 'chapter.title'), description: value.description === null ? null : text(value.description, 'chapter.description'), position: value.position };
}

export function parseChapter(input: unknown): Chapter {
  const value = record(input, 'chapter');
  keys(value, ['id', 'vaultId', 'title', 'description', 'position', 'createdAt', 'updatedAt', 'deletedAt'], 'chapter');
  return {
    ...parseChapterFields({ title: value.title, description: value.description, position: value.position }),
    id: uuid(value.id, 'chapter.id'), vaultId: uuid(value.vaultId, 'chapter.vaultId'),
    createdAt: utcTimestamp(value.createdAt, 'chapter.createdAt'), updatedAt: utcTimestamp(value.updatedAt, 'chapter.updatedAt'),
    deletedAt: value.deletedAt === null ? null : utcTimestamp(value.deletedAt, 'chapter.deletedAt'),
  };
}
