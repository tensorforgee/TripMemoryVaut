import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { Action, Problem, message, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';

export default function CompanionsScreen() {
  const [search, setSearch] = useState(''); const [name, setName] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const query = useCallback((vault: VaultDatabase) => vault.companions.list(search), [search]); const result = useOrganizationQuery(query);
  async function create() { setBusy(true); setError(''); try { await (await openVaultDatabase()).companions.create({ displayName: name, note: note.trim() || null }); setName(''); setNote(''); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); } }
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}><FlatList contentContainerStyle={styles.content}
    data={result.data ?? []} keyExtractor={item => item.id} ListHeaderComponent={<View style={{ gap: 10 }}>
      <Text style={styles.heading}>Companions</Text><Text style={styles.text}>Private labels for people or groups in your archive. They are not app users or contacts.</Text>
      <TextInput accessibilityLabel="Search companions" placeholder="Search companions" style={styles.input} value={search} onChangeText={setSearch} />
      <TextInput accessibilityLabel="Companion display name" placeholder="Display name" style={styles.input} value={name} onChangeText={setName} />
      <TextInput accessibilityLabel="Companion private note" placeholder="Private note (optional)" multiline style={[styles.input, { minHeight: 72 }] } value={note} onChangeText={setNote} />
      <Action title={busy ? 'Creating…' : 'Create companion'} disabled={busy} onPress={() => { void create(); }} />
      {result.error ? <Problem error={result.error} retry={result.retry} /> : null}{error ? <Problem error={error} /> : null}
    </View>} ListEmptyComponent={result.data ? <Text style={styles.text}>No companions yet.</Text> : <Text>Loading companions…</Text>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.push(`/companions/${item.id}`)}>
      <Text style={styles.section}>{item.displayName}</Text><Text style={styles.text}>{item.tripCount} {item.tripCount === 1 ? 'Trip' : 'Trips'}</Text>
    </Pressable>} /></SafeAreaView>;
}
