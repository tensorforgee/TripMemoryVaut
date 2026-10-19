import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { openVaultDatabase } from '../../core/database/open';
import type { Trip } from '../../domain/trip';
import type { TripDay } from '../../domain/trip-day';
import type { RouteStop } from '../route/repository';
import { mediaService } from '../media/service';
import { message } from '../trips/ui';
import { tripMapPhotoCounts } from './trip-map-query';
import type { PhotoCounts } from './trip-map-v2';
import type { SavedRoadRoute } from '../road-route/model';
import type { PhotoMemoryPin } from './photo-memory-repository';

export function useTripMap(tripId: string) {
  const [data, setData] = useState<{ trip: Trip; days: TripDay[]; stops: RouteStop[]; photos: PhotoCounts; roads: SavedRoadRoute[]; pins: PhotoMemoryPin[] }>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true, generation = 0;
    const subscriptions: (() => void)[] = [];
    setData(undefined); setError('');
    openVaultDatabase().then(async vault => {
      if (!active) return;
      const read = async () => {
        const request = ++generation;
        try {
          const [trip, days, stops, photos, roads, pins] = await Promise.all([
            vault.trips.getTripById(tripId), vault.timeline.listTripDays(tripId), vault.routes.listStops(tripId),
            tripMapPhotoCounts(vault.database, vault.vault.id, tripId),
            vault.roadRoutes.list(tripId),
            vault.photoMemories.list(tripId),
          ]);
          if (!trip || trip.deletedAt) throw new Error('Trip unavailable. It may be in Trash.');
          if (active && request === generation) { setData({ trip, days, stops, photos, roads, pins }); setError(''); }
        } catch (e) { if (active && request === generation) setError(message(e)); }
      };
      for (const repository of [vault.trips, vault.routes, vault.timeline, vault.roadRoutes, vault.photoMemories]) subscriptions.push(repository.subscribe(() => { void read(); }));
      const media = await mediaService();
      if (!active) return;
      subscriptions.push(media.repository.subscribe(() => { void read(); }));
      void read();
    }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; subscriptions.forEach(fn => fn()); };
  }, [tripId, version]));
  return { data, error, retry: () => setVersion(v => v + 1) };
}
