export const ORS_CREDENTIAL_STORAGE_KEY = 'tripmemoryvault.routing.openrouteservice.api-key.v1';

const MIN_KEY_LENGTH = 16;
const MAX_KEY_LENGTH = 8192;

export interface SecretStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class RoutingCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingCredentialError';
  }
}

// HeiGIT keys may be opaque tokens or JWT-shaped values. Validate only properties
// that are unsafe or clearly accidental instead of assuming a provider encoding.
export function normalizeOrsApiKey(value: string): string {
  const key = value.trim();
  if (!key) throw new RoutingCredentialError('Enter an openrouteservice API key.');
  if (key.length < MIN_KEY_LENGTH) throw new RoutingCredentialError('That API key is too short. Check the complete value and try again.');
  if (key.length > MAX_KEY_LENGTH) throw new RoutingCredentialError('That API key is too long. Check the value and try again.');
  if (/\s|[\u0000-\u001f\u007f]/u.test(key)) throw new RoutingCredentialError('API keys cannot contain spaces or control characters.');
  return key;
}

export class OrsCredentialStore {
  constructor(private readonly storage: SecretStorage) {}

  async read(): Promise<string | null> {
    let value: string | null;
    try {
      value = await this.storage.getItemAsync(ORS_CREDENTIAL_STORAGE_KEY);
    } catch {
      throw new RoutingCredentialError('Could not read the routing key from secure device storage.');
    }
    if (value === null) return null;
    try {
      return normalizeOrsApiKey(value);
    } catch {
      throw new RoutingCredentialError('The saved routing key is invalid. Clear it and save the complete key again.');
    }
  }

  async isConfigured(): Promise<boolean> {
    return (await this.read()) !== null;
  }

  async save(value: string): Promise<void> {
    const key = normalizeOrsApiKey(value);
    try {
      await this.storage.setItemAsync(ORS_CREDENTIAL_STORAGE_KEY, key);
    } catch {
      throw new RoutingCredentialError('Could not save the routing key in secure device storage.');
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.deleteItemAsync(ORS_CREDENTIAL_STORAGE_KEY);
    } catch {
      throw new RoutingCredentialError('Could not clear the routing key from secure device storage.');
    }
  }
}
