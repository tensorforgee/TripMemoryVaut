import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { Action, Problem, message, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';

export default function ChapterDetailScreen() {
  const { chapterId } = useLocalSearchParams<{ chapterId: string }>();
  const query = useCallback(async (vault: VaultDatabase) => ({ chapter: await vault.chapters.get(chapterId), trips: await vault.chapters.listTrips(chapterId), allTrips: await vault.trips.listTrips({ limit: 100 }) }), [chapterId]);
  const result = useOrganizationQuery(query); const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [loaded, setLoaded] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const chapter = result.data?.chapter; if (chapter && chapter.updatedAt !== loaded) { setTitle(chapter.title); setDescription(chapter.description ?? ''); setLoaded(chapter.updatedAt); } }, [result.data?.chapter, loaded]);
  const run = async (task: () => Promise<unknown>) => { setBusy(true); setError(''); try { await task(); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } };
  const chapter = result.data?.chapter; const attached = new Set(result.data?.trips.map(trip => trip.id));
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading chapter…</Text> : !chapter ? <Text>Chapter unavailable.</Text> : <>
      <Text style={styles.heading}>{chapter.title}</Text><TextInput accessibilityLabel="Chapter title" style={styles.input} value={title} onChangeText={setTitle} />
      <TextInput accessibilityLabel="Chapter description" placeholder="Description (optional)" multiline style={[styles.input, { minHeight: 90 }]} value={description} onChangeText={setDescription} />
      <Action title={busy ? 'Saving…' : 'Save chapter'} disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(v => v.chapters.update(chapterId, { title, description: description.trim() || null }))); }} />
      <Text style={styles.section}>Trips in this Chapter</Text>{result.data.trips.length === 0 ? <Text style={styles.text}>No active Trips.</Text> : result.data.trips.map(trip =>
        <View key={trip.id} style={styles.card}><Text style={styles.section}>{trip.title}</Text><Action title="Open Trip" onPress={() => router.push(`/trips/${trip.id}`)} />
          <Action title="Detach from Chapter" disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(v => v.chapters.detachTrip(trip.id, chapterId))); }} /></View>)}
      <Text style={styles.section}>Add existing Trip</Text>{result.data.allTrips.filter(trip => !attached.has(trip.id)).map(trip =>
        <Action key={trip.id} title={`Add ${trip.title}`} disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(v => v.chapters.attachTrip(trip.id, chapterId))); }} />)}
      <Action title="Remove chapter" disabled={busy} onPress={() => Alert.alert(`Remove “${chapter.title}”?`,
        'Trip associations will be hidden. No Trip will be deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void run(async () => { await (await openVaultDatabase()).chapters.remove(chapterId); router.dismissTo('/chapters'); }); } }])} />
    </>}{error ? <Problem error={error} /> : null}
  </ScrollView>;
}
