import * as SecureStore from 'expo-secure-store';
import { OrsCredentialStore, type SecretStorage } from './credential-store';

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainService: 'tripmemoryvault.routing.openrouteservice.v1',
  requireAuthentication: false,
};

const secureStorage: SecretStorage = {
  async getItemAsync(key) {
    if (!await SecureStore.isAvailableAsync()) throw new Error('Secure storage unavailable');
    return SecureStore.getItemAsync(key, secureStoreOptions);
  },
  async setItemAsync(key, value) {
    if (!await SecureStore.isAvailableAsync()) throw new Error('Secure storage unavailable');
    await SecureStore.setItemAsync(key, value, secureStoreOptions);
  },
  async deleteItemAsync(key) {
    if (!await SecureStore.isAvailableAsync()) throw new Error('Secure storage unavailable');
    await SecureStore.deleteItemAsync(key, secureStoreOptions);
  },
};

export const orsCredentialStore = new OrsCredentialStore(secureStorage);
