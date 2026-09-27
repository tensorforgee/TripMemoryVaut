export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
  }
}

export function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(field, 'must be an object');
  }
  return value as Record<string, unknown>;
}

export function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ValidationError(`${field}.${key}`, 'is not supported');
  }
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(field, 'must be nonempty text');
  return value.trim();
}

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(field, 'must be a UUIDv4');
  }
  return value;
}

export function utcTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ValidationError(field, 'must be a canonical UTC timestamp');
  }
  return value;
}
