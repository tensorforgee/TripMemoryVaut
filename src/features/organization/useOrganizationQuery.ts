import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { message } from '../trips/ui';

export function useOrganizationQuery<T>(query: (vault: VaultDatabase) => Promise<T>) {
  const [data, setData] = useState<T>(); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true; let generation = 0; let subscriptions: (() => void)[] = [];
    openVaultDatabase().then(vault => {
      if (!active) return;
      const read = async () => { const request = ++generation; try { const value = await query(vault);
        if (active && request === generation) { setData(value); setError(''); }
      } catch (failure) { if (active && request === generation) setError(message(failure)); } };
      subscriptions = [vault.companions.subscribe(() => { void read(); }), vault.chapters.subscribe(() => { void read(); }), vault.trips.subscribe(() => { void read(); })];
      void read();
    }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; subscriptions.forEach(unsubscribe => unsubscribe()); };
  }, [query, version]));
  return { data, error, retry: () => setVersion(value => value + 1) };
}
