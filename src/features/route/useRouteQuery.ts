import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { openVaultDatabase } from '../../core/database/open';
import { message } from '../trips/ui';
import type { RouteRepository } from './repository';

export function useRouteQuery<T>(query: (repository: RouteRepository) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeTrips: (() => void) | undefined;
    openVaultDatabase().then(vault => {
      if (!active) return;
      const read = async () => {
        const request = ++generation;
        try { const value = await query(vault.routes); if (active && request === generation) { setData(value); setError(''); } }
        catch (e) { if (active && request === generation) setError(message(e)); }
      };
      unsubscribe = vault.routes.subscribe(() => { void read(); });
      unsubscribeTrips = vault.trips.subscribe(() => { void read(); });
      void read();
    }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; unsubscribe?.(); unsubscribeTrips?.(); };
  }, [query, version]));
  return { data, error, retry: () => setVersion(v => v + 1) };
}
