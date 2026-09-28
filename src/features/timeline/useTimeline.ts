import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { openVaultDatabase } from '../../core/database/open';
import type { TripDay } from '../../domain/trip-day';
import type { RouteStop } from '../route/repository';
import { message } from '../trips/ui';

export function useTimeline(tripId: string) {
  const [data, setData] = useState<{ days: TripDay[]; revision: number; stops: RouteStop[] }>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    let generation = 0;
    let subscriptions: (() => void)[] = [];
    openVaultDatabase().then(vault => {
      if (!active) return;
      const read = async () => {
        const request = ++generation;
        try {
          const [timeline, stops] = await Promise.all([vault.timeline.getTimeline(tripId), vault.routes.listStops(tripId)]);
          if (active && request === generation) { setData({ ...timeline, stops }); setError(''); }
        } catch (e) { if (active && request === generation) setError(message(e)); }
      };
      subscriptions = [vault.timeline.subscribe(() => { void read(); }), vault.routes.subscribe(() => { void read(); }), vault.trips.subscribe(() => { void read(); })];
      void read();
    }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; subscriptions.forEach(unsubscribe => unsubscribe()); };
  }, [tripId, version]));
  return { data, error, retry: () => setVersion(v => v + 1) };
}
