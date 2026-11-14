import { ValidationError } from './validation';
export type Tag = { id: string; name: string };
export type TagTarget = { kind: 'trip' | 'memory'; id: string };
export function tagName(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('tag.name', 'must be text');
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new ValidationError('tag.name', 'requires 1–80 visible characters');
  return name;
}
// V1: NFKC, whitespace collapse, locale-independent case folding, sharp-s/final-sigma equivalence.
export function normalizeTagNameV1(value: unknown): string {
  return tagName(value).toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}
