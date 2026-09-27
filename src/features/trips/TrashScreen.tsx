import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { openVaultDatabase } from '../../core/database/open';
import type { TripRepository } from './repository';
import { dateLabel } from './presentation';
import { Action, Problem, message, styles, useTripQuery } from './ui';

export default function TrashScreen() {
  const [pages, setPages] = useState(1);
  const query = useCallback(async (repo: TripRepository) => {
    const rows = [];
    for (let page = 0; page < pages; page++) rows.push(...await repo.listDeletedTrips(100, page * 100));
    return rows;
  }, [pages]);
  const result = useTripQuery(query);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function restore(id: string) {
    setBusy(true);
    try { await (await openVaultDatabase()).trips.restoreTrip(id); router.dismissTo(`/trips/${id}`); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <FlatList style={styles.page} contentContainerStyle={styles.content} data={result.data ?? []} keyExtractor={trip => trip.id}
    ListHeaderComponent={<View><Text style={styles.heading}>Trash</Text><Text style={styles.text}>Deleted trips stay here until restored. Permanent deletion is not available yet.</Text>
      {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading trash…</Text> : null}
      {error ? <Problem error={error} /> : null}</View>}
    ListEmptyComponent={result.data && !result.error ? <Text style={styles.text}>Trash is empty.</Text> : null}
    renderItem={({ item }) => <View style={styles.card}><Text style={styles.section}>{item.title}</Text><Text>{dateLabel(item.dates)}</Text>
      <Action title={`Restore ${item.title}`} disabled={busy} onPress={() => { void restore(item.id); }} /></View>}
    ListFooterComponent={result.data?.length === pages * 100 ? <Action title="Load more deleted trips" onPress={() => setPages(p => p + 1)} /> : null} />;
}
