import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { SectionList, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dateLabel, tripSections } from './presentation';
import { Action, Problem, styles, useTripQuery } from './ui';
import type { TripRepository } from './repository';

export default function TripsScreen() {
  const [pages, setPages] = useState(1);
  const query = useCallback(async (repo: TripRepository) => {
    const rows = [];
    for (let page = 0; page < pages; page++) rows.push(...await repo.listTrips({ limit: 100, offset: page * 100 }));
    return rows;
  }, [pages]);
  const result = useTripQuery(query);
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <SectionList contentContainerStyle={styles.content} sections={tripSections(result.data ?? [])} keyExtractor={trip => trip.id}
      ListHeaderComponent={<View style={{ gap: 12 }}><Text style={styles.heading}>Your trips</Text>
        <Action title="Create trip" onPress={() => router.push('/trips/new')} />
        <Action title="Trash" onPress={() => router.push('/trips/trash')} />
        {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading trips…</Text> : null}
      </View>}
      ListEmptyComponent={result.data && !result.error ? <View style={styles.card}><Text style={styles.heading}>No trips yet</Text>
        <Text style={styles.text}>A title is enough. Dates can stay unknown.</Text>
        <Action title="Create first trip" onPress={() => router.push('/trips/new')} /></View> : null}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => router.push(`/trips/${item.id}`)} style={styles.card}>
        <Text style={styles.section}>{item.title}</Text><Text style={styles.text}>{dateLabel(item.dates)}</Text>
        <Text>{item.isFavourite ? '★ Favourite' : 'Not a favourite'}</Text>
      </Pressable>}
      ListFooterComponent={result.data?.length === pages * 100 ? <Action title="Load more trips" onPress={() => setPages(p => p + 1)} /> : null} />
  </SafeAreaView>;
}
