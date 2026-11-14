import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { SectionList, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dateLabel, tripSections } from './presentation';
import { Action, LoadingState, Problem, styles, useTripQuery } from './ui';
import type { TripRepository } from './repository';
import TripCover from './TripCover';
import { theme } from '../../shared/ui/theme';

export default function TripsScreen() {
  const [pages, setPages] = useState(1);
  const query = useCallback(async (repo: TripRepository) => {
    const rows = [];
    for (let page = 0; page < pages; page++) {
      const trips = await repo.listTrips({ limit: 100, offset: page * 100 });
      const overview = new Map((await repo.overview(trips.map(t => t.id))).map(o => [o.id, o]));
      rows.push(...trips.map(trip => ({ ...trip, overview: overview.get(trip.id) })));
    }
    return rows;
  }, [pages]);
  const result = useTripQuery(query, true);
  return <SafeAreaView style={styles.page} edges={['left', 'right']}>
    <SectionList stickySectionHeadersEnabled={false} contentContainerStyle={[styles.content, { width: '100%', maxWidth: 760, alignSelf: 'center' }]} sections={tripSections(result.data ?? [])} keyExtractor={trip => trip.id}
      ListHeaderComponent={<View style={{ gap: 12 }}><Text style={styles.heading}>Your trips</Text>
        <Text style={styles.text}>Places you went. Moments you kept.</Text>
        <Action title="Create trip" onPress={() => router.push('/trips/new')} />
        <Action title="Search trips, memories & tags" secondary onPress={() => router.push('/search')} />
        {result.error ? <View style={styles.card}><Text style={styles.section}>Couldn’t load your trips</Text><Problem error={result.error} retry={result.retry} /></View> : !result.data ? <LoadingState label="Loading trips…" /> : null}
      </View>}
      ListEmptyComponent={result.data && !result.error ? <View style={styles.card}><Text accessibilityRole="header" style={styles.heading}>Your first trip starts here</Text>
        <Text style={styles.text}>A title is enough. Add photos, places and memories whenever you’re ready. Dates can stay unknown.</Text></View> : null}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => {
        const overview = result.data?.find(t => t.id === item.id)?.overview;
        return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}. ${dateLabel(item.dates)}${item.status === 'draft' ? '. Draft' : ''}`}
          onPress={() => router.push(`/trips/${item.id}`)} style={({ pressed }) => [styles.card, pressed && { backgroundColor: theme.colors.selected }]}>
          {overview && <TripCover compact vaultId={item.vaultId} path={overview.cover} photos={overview.photos} />}
          <Text style={[styles.section, { paddingVertical: 0 }]}>{item.title}</Text>
          <Text style={styles.text}>{dateLabel(item.dates)}</Text>
          {item.summary ? <Text numberOfLines={3} style={styles.text}>{item.summary}</Text> : null}
          {item.isFavourite || item.status === 'draft' ? <Text style={styles.text}>{[item.isFavourite && '★ Favourite', item.status === 'draft' && 'Draft · Continue editing'].filter(Boolean).join(' · ')}</Text> : null}
        </Pressable>;
      }}
      ListFooterComponent={result.data?.length === pages * 100 ? <Action title="Load more trips" onPress={() => setPages(p => p + 1)} /> : null} />
  </SafeAreaView>;
}
