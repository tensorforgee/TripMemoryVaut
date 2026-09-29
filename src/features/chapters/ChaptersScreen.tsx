import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { Action, Problem, message, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';

export default function ChaptersScreen() {
  const [search, setSearch] = useState(''); const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const query = useCallback((vault: VaultDatabase) => vault.chapters.list(search), [search]); const result = useOrganizationQuery(query);
  async function create() { setBusy(true); setError(''); try { await (await openVaultDatabase()).chapters.create({ title, description: description.trim() || null }); setTitle(''); setDescription(''); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); } }
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}><FlatList contentContainerStyle={styles.content}
    data={result.data ?? []} keyExtractor={item => item.id} ListHeaderComponent={<View style={{ gap: 10 }}>
      <Text style={styles.heading}>Life Chapters</Text><Text style={styles.text}>User-curated albums. A Trip can belong to more than one Chapter.</Text>
      <TextInput accessibilityLabel="Search chapters" placeholder="Search chapters" style={styles.input} value={search} onChangeText={setSearch} />
      <TextInput accessibilityLabel="Chapter title" placeholder="Chapter title" style={styles.input} value={title} onChangeText={setTitle} />
      <TextInput accessibilityLabel="Chapter description" placeholder="Description (optional)" multiline style={[styles.input, { minHeight: 72 }]} value={description} onChangeText={setDescription} />
      <Action title={busy ? 'Creating…' : 'Create chapter'} disabled={busy} onPress={() => { void create(); }} />
      {result.error ? <Problem error={result.error} retry={result.retry} /> : null}{error ? <Problem error={error} /> : null}
    </View>} ListEmptyComponent={result.data ? <Text style={styles.text}>No chapters yet.</Text> : <Text>Loading chapters…</Text>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.push(`/chapters/${item.id}`)}>
      <Text style={styles.section}>{item.title}</Text><Text style={styles.text}>{item.tripCount} {item.tripCount === 1 ? 'Trip' : 'Trips'}</Text>
    </Pressable>} /></SafeAreaView>;
}
