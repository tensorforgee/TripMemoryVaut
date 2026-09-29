import { keys, record, text, utcTimestamp, uuid } from './validation';

export type CompanionFields = { displayName: string; note: string | null };
export type Companion = CompanionFields & {
  id: string; vaultId: string; createdAt: string; updatedAt: string; deletedAt: string | null;
};

export function parseCompanionFields(input: unknown): CompanionFields {
  const value = record(input, 'companion');
  keys(value, ['displayName', 'note'], 'companion');
  return { displayName: text(value.displayName, 'companion.displayName'), note: value.note === null ? null : text(value.note, 'companion.note') };
}

export function parseCompanion(input: unknown): Companion {
  const value = record(input, 'companion');
  keys(value, ['id', 'vaultId', 'displayName', 'note', 'createdAt', 'updatedAt', 'deletedAt'], 'companion');
  return {
    ...parseCompanionFields({ displayName: value.displayName, note: value.note }),
    id: uuid(value.id, 'companion.id'), vaultId: uuid(value.vaultId, 'companion.vaultId'),
    createdAt: utcTimestamp(value.createdAt, 'companion.createdAt'), updatedAt: utcTimestamp(value.updatedAt, 'companion.updatedAt'),
    deletedAt: value.deletedAt === null ? null : utcTimestamp(value.deletedAt, 'companion.deletedAt'),
  };
}
