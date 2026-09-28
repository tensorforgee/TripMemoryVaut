import { useCallback } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Action, Problem, styles } from '../trips/ui';
import type { RouteRepository } from './repository';
import { useRouteQuery } from './useRouteQuery';

export default function RouteSection({ tripId }: { tripId: string }) {
  const query = useCallback((repo: RouteRepository) => repo.getRoute(tripId), [tripId]);
  const route = useRouteQuery(query);
  return <View style={{ gap: 8 }}><Text style={styles.section}>Route / Stops</Text>
    {route.error ? <Problem error={route.error} retry={route.retry} /> : !route.data ? <Text>Loading route…</Text> :
      route.data.stops.length === 0 ? <Text style={styles.text}>No route added yet</Text> :
      route.data.stops.map((stop, index) => <View key={stop.id}>
        {index > 0 && <Text style={styles.text}>↓</Text>}
        <Text style={styles.text}>{index + 1}. {stop.place.name}</Text>
        <Text>{stop.kind} · {stop.detailCertainty} details{!stop.visitConfirmed ? ' · Visit unconfirmed' : ''}</Text>
      </View>)}
    <Action title={route.data?.stops.length ? 'Edit route / Add stop' : 'Add stop'} onPress={() => router.push(`/trips/${tripId}/route`)} />
  </View>;
}
