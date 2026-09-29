import { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text } from 'react-native';
import { openVaultDatabase } from '../../core/database/open';
import type { TripRepository } from './repository';
import { dateLabel } from './presentation';
import { Action, Problem, message, styles, useTripQuery } from './ui';
import RouteSection from '../route/RouteSection';
import TimelineSection from '../timeline/TimelineSection';
import PhotosSection from '../media/PhotosSection';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const query = useCallback((repo: TripRepository) => repo.getTripById(tripId), [tripId]);
  const result = useTripQuery(query);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try { await (await openVaultDatabase()).trips.trashTrip(tripId); router.dismissTo('/'); }
    catch (e) { setError(message(e)); setBusy(false); }
  }
  const trip = result.data;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    {result.error ? <Problem error={result.error} retry={result.retry} /> : trip === undefined ? <Text>Loading trip…</Text> : !trip ? <Text>Trip unavailable. It may be in Trash.</Text> : <>
      <Text style={styles.heading}>{trip.title}</Text><Text style={styles.text}>{dateLabel(trip.dates)}</Text>
      <Text style={styles.text}>{trip.isFavourite ? '★ Favourite' : 'Not a favourite'} · {trip.status === 'draft' ? 'Draft' : 'Saved'}</Text>
      <Text style={styles.text}>{trip.summary || 'No summary yet.'}</Text>
      <RouteSection tripId={trip.id} />
      <TimelineSection tripId={trip.id} />
      <PhotosSection tripId={trip.id} />
      <Action title="Edit trip" disabled={busy} onPress={() => router.push(`/trips/${trip.id}/edit`)} />
      <Action title="Delete trip" disabled={busy} onPress={() => Alert.alert(`Delete “${trip.title}”?`, 'This trip will move to Trash. You can restore it there.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Move to Trash', style: 'destructive', onPress: () => { void remove(); } },
      ])} />
    </>}
    {error ? <Problem error={error} /> : null}
  </ScrollView>;
}
