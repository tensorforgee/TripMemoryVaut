import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { SectionList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import type { DreamWithVisits } from './repository';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';
import { Action, Problem, message, styles } from '../trips/ui';

function coordinate(text: string): number | null {
  return text.trim() === '' ? null : Number(text.trim());
}

function DreamCard({ dream, restore, busy }: { dream: DreamWithVisits; restore?: () => void; busy: boolean }) {
  const coordinates = dream.latitude === null ? null : `${dream.latitude}, ${dream.longitude}`;
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" onPress={() => router.push(`/dreams/${dream.id}`)}>
      <Text style={styles.section}>{dream.title}</Text>
      {dream.note ? <Text style={styles.text}>{dream.note}</Text> : null}
      {dream.locationText ? <Text style={styles.text}>{dream.locationText}</Text> : null}
      {coordinates ? <Text style={styles.text}>{coordinates}</Text> : null}
      {dream.status === 'visited' ? <Text style={styles.text}>Visited · {dream.visits.map(visit => visit.placeName).join(', ')}</Text> : null}
      {dream.visits.length ? <Text style={styles.text}>Trips: {[...new Set(dream.visits.map(visit => visit.tripTitle))].join(', ')}</Text> : null}
    </Pressable>
    {restore ? <Action title="Restore Dream" disabled={busy} onPress={restore} /> : null}
  </View>;
}

export default function DreamsScreen() {
  const [title, setTitle] = useState(''); const [note, setNote] = useState(''); const [locationText, setLocationText] = useState('');
  const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const query = useCallback(async (vault: VaultDatabase) => ({ active: await vault.dreams.listActive(), archived: await vault.dreams.listArchived() }), []);
  const result = useOrganizationQuery(query);
  const run = async (task: () => Promise<unknown>) => { setBusy(true); setError(''); try { await task(); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } };
  const create = () => run(async () => {
    await (await openVaultDatabase()).dreams.create({ title, note: note.trim() || null, locationText: locationText.trim() || null,
      latitude: coordinate(latitude), longitude: coordinate(longitude) });
    setTitle(''); setNote(''); setLocationText(''); setLatitude(''); setLongitude('');
  });
  const active = result.data?.active ?? [];
  const sections = [
    { title: 'Dreaming', data: active.filter(dream => dream.status === 'dreaming') },
    { title: 'Visited', data: active.filter(dream => dream.status === 'visited') },
    { title: 'Archived', data: result.data?.archived ?? [] },
  ];
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <SectionList keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} sections={sections} keyExtractor={dream => dream.id}
      ListHeaderComponent={<View style={{ gap: 10 }}>
        <Text style={styles.heading}>Dream Places</Text>
        <Text style={styles.text}>A private list of places you hope to visit. Dreams are wishes, not travel plans.</Text>
        <TextInput accessibilityLabel="Dream title" placeholder="Place you dream about" style={styles.input} value={title} onChangeText={setTitle} />
        <TextInput accessibilityLabel="Dream note" placeholder="Personal note (optional)" multiline style={[styles.input, { minHeight: 72 }]} value={note} onChangeText={setNote} />
        <TextInput accessibilityLabel="Dream location context" placeholder="Country, region, or context (optional)" style={styles.input} value={locationText} onChangeText={setLocationText} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput accessibilityLabel="Dream latitude" placeholder="Latitude (optional)" keyboardType="numbers-and-punctuation" style={[styles.input, { flex: 1 }]} value={latitude} onChangeText={setLatitude} />
          <TextInput accessibilityLabel="Dream longitude" placeholder="Longitude (optional)" keyboardType="numbers-and-punctuation" style={[styles.input, { flex: 1 }]} value={longitude} onChangeText={setLongitude} />
        </View>
        <Text style={styles.text}>Coordinates are optional. If used, enter both; they are stored only as your metadata and do not add a map marker.</Text>
        <Action title={busy ? 'Saving…' : 'Add Dream'} disabled={busy} onPress={() => { void create(); }} />
        {result.error ? <Problem error={result.error} retry={result.retry} /> : error ? <Problem error={error} /> : null}
      </View>}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item, section }) => <DreamCard dream={item} busy={busy} restore={section.title === 'Archived'
        ? () => { void run(() => openVaultDatabase().then(vault => vault.dreams.unarchive(item.id))); } : undefined} />}
      ListFooterComponent={!result.data ? <Text>Reading Dreams from this device…</Text> : null} />
  </SafeAreaView>;
}
