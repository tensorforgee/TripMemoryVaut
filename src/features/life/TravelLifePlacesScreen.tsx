import { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VaultDatabase } from '../../core/database/open';
import { Problem, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';

function plural(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

export default function TravelLifePlacesScreen() {
  const query = useCallback((vault: VaultDatabase) => vault.life.listPlaces(), []);
  const result = useOrganizationQuery(query);
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <FlatList contentContainerStyle={styles.content} data={result.data ?? []} keyExtractor={place => place.id}
      ListHeaderComponent={<View style={{ gap: 8 }}><Text style={styles.heading}>Places visited</Text>
        <Text style={styles.text}>Canonical Places linked through confirmed visit or stay Stops in saved Trips. Repeated Stops remain separate visits.</Text>
        {result.error ? <Problem error={result.error} retry={result.retry} /> : null}</View>}
      ListEmptyComponent={result.data ? <Text style={styles.text}>No confirmed Places in saved Trips yet.</Text> : <Text>Reading Places…</Text>}
      renderItem={({ item }) => <View style={styles.card}><Text style={styles.section}>{item.name}</Text>
        <Text style={styles.text}>{plural(item.visitCount, 'visit')} · {plural(item.tripCount, 'trip')}</Text></View>} />
  </SafeAreaView>;
}
