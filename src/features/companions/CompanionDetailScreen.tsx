import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { Action, Problem, message, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';

export default function CompanionDetailScreen() {
  const { companionId } = useLocalSearchParams<{ companionId: string }>();
  const query = useCallback(async (vault: VaultDatabase) => ({ companion: await vault.companions.get(companionId), trips: await vault.companions.listTrips(companionId) }), [companionId]);
  const result = useOrganizationQuery(query); const [name, setName] = useState(''); const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const companion = result.data?.companion; if (companion && companion.updatedAt !== loaded) { setName(companion.displayName); setNote(companion.note ?? ''); setLoaded(companion.updatedAt); } }, [result.data?.companion, loaded]);
  async function save() { setBusy(true); setError(''); try { await (await openVaultDatabase()).companions.update(companionId, { displayName: name, note: note.trim() || null }); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); } }
  async function remove() { setBusy(true); try { await (await openVaultDatabase()).companions.remove(companionId); router.dismissTo('/companions'); }
    catch (failure) { setError(message(failure)); setBusy(false); } }
  const companion = result.data?.companion;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading companion…</Text> : !companion ? <Text>Companion unavailable.</Text> : <>
      <Text style={styles.heading}>{companion.displayName}</Text><Text style={styles.text}>A private archive label, not a social profile.</Text>
      <TextInput accessibilityLabel="Companion name" style={styles.input} value={name} onChangeText={setName} />
      <TextInput accessibilityLabel="Companion note" placeholder="Private note (optional)" multiline style={[styles.input, { minHeight: 90 }]} value={note} onChangeText={setNote} />
      <Action title={busy ? 'Saving…' : 'Save companion'} disabled={busy} onPress={() => { void save(); }} />
      <Text style={styles.section}>Associated Trips</Text>{result.data.trips.length === 0 ? <Text style={styles.text}>No active Trips.</Text> : result.data.trips.map(trip =>
        <View key={trip.id} style={styles.card}><Text style={styles.section}>{trip.title}</Text><Action title="Open Trip" onPress={() => router.push(`/trips/${trip.id}`)} /></View>)}
      <Action title="Remove companion" disabled={busy} onPress={() => Alert.alert(`Remove “${companion.displayName}”?`,
        'Trip associations will be hidden. No Trip will be deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void remove(); } }])} />
    </>}{error ? <Problem error={error} /> : null}
  </ScrollView>;
}
