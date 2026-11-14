import TripCover from './TripCover';
import TagSection from '../tags/TagSection';
import { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../../core/database/open';
import type { TripRepository } from './repository';
import { dateLabel } from './presentation';
import { Action, LoadingState, Problem, message, styles, useTripQuery } from './ui';
import RouteSection from '../route/RouteSection';
import TimelineSection from '../timeline/TimelineSection';
import PhotosSection from '../media/PhotosSection';
import TripOrganizationSections from '../organization/TripOrganizationSections';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const query = useCallback(async (repo: TripRepository) => {
    const trip = await repo.getTripById(tripId);
    return trip ? { ...trip, overview: (await repo.overview([tripId]))[0] } : null;
  }, [tripId]);
  const result = useTripQuery(query, true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try { await (await openVaultDatabase()).trips.trashTrip(tripId); router.dismissTo('/'); }
    catch (e) { setError(message(e)); setBusy(false); }
  }
  const trip = result.data;
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}><ScrollView keyboardShouldPersistTaps="handled" style={styles.page} contentContainerStyle={[styles.content, { width: '100%', maxWidth: 760, alignSelf: 'center' }]}>
    {result.error ? <Problem error={result.error} retry={result.retry} /> : trip === undefined ? <LoadingState label="Loading trip…" /> : !trip ? <Text style={styles.text}>Trip unavailable. It may be in Trash.</Text> : <>
      <View style={styles.card}>
        {trip.overview && <TripCover vaultId={trip.vaultId} path={trip.overview.cover} photos={trip.overview.photos} />}
        <Text accessibilityRole="header" style={styles.heading}>{trip.title}</Text>
        <Text style={styles.text}>{dateLabel(trip.dates)}</Text>
        <Text style={styles.text}>{trip.status === 'draft' ? 'Draft' : 'Saved trip'}{trip.isFavourite ? ' · ★ Favourite' : ''}</Text>
        <Action title={trip.status === 'draft' ? 'Continue editing trip' : 'Edit trip'} secondary disabled={busy} onPress={() => router.push(`/trips/${trip.id}/edit`)} />
        {trip.summary ? <Text style={styles.text}>{trip.summary}</Text> : <Text style={styles.text}>No summary yet. Add a recollection in Edit trip.</Text>}
        {trip.overview && <Text style={styles.text}>{trip.overview.photos} {trip.overview.photos === 1 ? 'photo' : 'photos'} · {trip.overview.stops} {trip.overview.stops === 1 ? 'stop' : 'stops'} · {trip.overview.memories} {trip.overview.memories === 1 ? 'memory' : 'memories'}</Text>}
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={[styles.section, { paddingVertical: 0 }]}>Explore this trip</Text>
        <Action title="Travel Memories" onPress={() => router.push(`/trips/${trip.id}/memories`)} />
        <Action title="Photo gallery" secondary onPress={() => router.push(`/trips/${trip.id}/photos`)} />
        <Action title="Trip Map" secondary onPress={() => router.push(`/trips/${trip.id}/map`)} />
      </View>
      <View style={styles.card}><RouteSection tripId={trip.id} /></View>
      <View style={styles.card}><TimelineSection tripId={trip.id} /></View>
      <View style={styles.card}><PhotosSection tripId={trip.id} /></View>
      <View style={styles.card}><TagSection target={{kind:'trip',id:trip.id}} /></View>
      <TripOrganizationSections tripId={trip.id} />
      <Action secondary title="Reconstruct from photos" onPress={() => router.push(`/trips/${trip.id}/reconstruct`)} />
      <Action secondary title="Delete trip" disabled={busy} onPress={() => Alert.alert(`Delete “${trip.title}”?`, 'This trip will move to Trash. You can restore it there.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Move to Trash', style: 'destructive', onPress: () => { void remove(); } },
      ])} />
    </>}
    {error ? <Problem error={error} /> : null}
  </ScrollView></SafeAreaView>;
}
