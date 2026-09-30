import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { dateLabel } from '../trips/presentation';
import { Action, Problem, message, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';

function coordinate(text: string): number | null { return text.trim() === '' ? null : Number(text.trim()); }
function knownVisitDate(value: Parameters<typeof dateLabel>[0]): string | null {
  return value.start.precision === 'unknown' ? null : dateLabel(value);
}

export default function DreamDetailScreen() {
  const { dreamId } = useLocalSearchParams<{ dreamId: string }>();
  const query = useCallback(async (vault: VaultDatabase) => ({ dream: await vault.dreams.get(dreamId), options: await vault.dreams.listVisitOptions(dreamId) }), [dreamId]);
  const result = useOrganizationQuery(query); const dream = result.data?.dream;
  const [title, setTitle] = useState(''); const [note, setNote] = useState(''); const [locationText, setLocationText] = useState('');
  const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState(''); const [loaded, setLoaded] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (dream && dream.updatedAt !== loaded) { setTitle(dream.title); setNote(dream.note ?? ''); setLocationText(dream.locationText ?? '');
    setLatitude(dream.latitude?.toString() ?? ''); setLongitude(dream.longitude?.toString() ?? ''); setLoaded(dream.updatedAt); } }, [dream, loaded]);
  const run = async (task: () => Promise<unknown>) => { setBusy(true); setError(''); try { await task(); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } };
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading Dream…</Text> : !dream ? <Text>Dream unavailable.</Text> : <>
      <Text style={styles.heading}>{dream.title}</Text>
      <Text style={styles.text}>Dreamed: {dream.addedDates.start.precision === 'unknown' ? 'Unknown' : dream.addedDates.start.value}</Text>
      <TextInput accessibilityLabel="Dream title" style={styles.input} value={title} onChangeText={setTitle} />
      <TextInput accessibilityLabel="Dream note" placeholder="Personal note (optional)" multiline style={[styles.input, { minHeight: 90 }]} value={note} onChangeText={setNote} />
      <TextInput accessibilityLabel="Dream location context" placeholder="Country, region, or context (optional)" style={styles.input} value={locationText} onChangeText={setLocationText} />
      <View style={{ flexDirection: 'row', gap: 8 }}><TextInput accessibilityLabel="Dream latitude" placeholder="Latitude" keyboardType="numbers-and-punctuation" style={[styles.input, { flex: 1 }]} value={latitude} onChangeText={setLatitude} />
        <TextInput accessibilityLabel="Dream longitude" placeholder="Longitude" keyboardType="numbers-and-punctuation" style={[styles.input, { flex: 1 }]} value={longitude} onChangeText={setLongitude} /></View>
      <Action title={busy ? 'Saving…' : 'Save Dream'} disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(vault => vault.dreams.update(dreamId,
        { title, note: note.trim() || null, locationText: locationText.trim() || null, latitude: coordinate(latitude), longitude: coordinate(longitude) }))); }} />

      <Text style={styles.section}>Visited history</Text>
      {dream.visits.length ? dream.visits.map(visit => <View key={visit.id} style={styles.card}>
        <Text style={styles.section}>{visit.placeName}</Text><Text style={styles.text}>Trip: {visit.tripTitle}</Text>
        {knownVisitDate(visit.visitDates) ? <Text style={styles.text}>Visited: {knownVisitDate(visit.visitDates)}</Text> : null}
        <Action title="Open Trip" onPress={() => router.push(`/trips/${visit.tripId}`)} />
        <Action title="Unlink visit" disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(vault => vault.dreams.unlinkVisit(dreamId, visit.id))); }} />
      </View>) : <Text style={styles.text}>Still dreaming. A visit is recorded only after you explicitly link a confirmed Place from a saved Trip.</Text>}

      <Text style={styles.section}>Mark as visited</Text>
      <Text style={styles.text}>Choose an existing confirmed Place/Trip visit. Names, GPS, photos, and reconstruction suggestions never match a Dream automatically.</Text>
      {result.data.options.length ? result.data.options.map(option => <Action key={option.stopId}
        title={`Mark visited · ${option.placeName} · ${option.tripTitle}`} disabled={busy}
        onPress={() => { void run(() => openVaultDatabase().then(vault => vault.dreams.linkVisit(dreamId, option.stopId))); }} />)
        : <Text style={styles.text}>No unlinked confirmed visits from saved Trips are available.</Text>}

      <Action title="Archive Dream" disabled={busy} onPress={() => Alert.alert(`Archive “${dream.title}”?`,
        'The Dream and its visit history stay on this device. Linked Places, Trips, media, and Travel Life totals are unchanged.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Archive', onPress: () => { void run(async () => { await (await openVaultDatabase()).dreams.archive(dreamId); router.dismissTo('/dreams'); }); } }])} />
    </>}
    {error ? <Problem error={error} /> : null}
  </ScrollView>;
}
