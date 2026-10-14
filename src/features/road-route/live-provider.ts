import { orsCredentialStore } from '../routing-credentials/native-store';
import { liveOrsProvider } from './provider';

// SecureStore is read for every explicit request. The credential is used only in
// the Authorization header and is never copied into configuration or application state.
export const configuredLiveRoutingProvider = liveOrsProvider(() => orsCredentialStore.read());
