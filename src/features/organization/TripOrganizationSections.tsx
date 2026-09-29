import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { openVaultDatabase, type VaultDatabase } from '../../core/database/open';
import { Action, Problem, message, styles } from '../trips/ui';
import { useOrganizationQuery } from './useOrganizationQuery';

function SmallAction({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={{ borderWidth: 1, borderColor: '#486783', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: '#183e63', fontWeight: '600' }}>{title}</Text></Pressable>;
}

export default function TripOrganizationSections({ tripId }: { tripId: string }) {
  const [peopleOpen, setPeopleOpen] = useState(false); const [chaptersOpen, setChaptersOpen] = useState(false);
  const [personSearch, setPersonSearch] = useState(''); const [chapterSearch, setChapterSearch] = useState('');
  const [newPerson, setNewPerson] = useState(''); const [newChapter, setNewChapter] = useState('');
  const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState('');
  const query = useCallback(async (vault: VaultDatabase) => ({
    attachedPeople: await vault.companions.listForTrip(tripId), allPeople: await vault.companions.list(personSearch),
    attachedChapters: await vault.chapters.listForTrip(tripId), allChapters: await vault.chapters.list(chapterSearch),
  }), [tripId, personSearch, chapterSearch]);
  const result = useOrganizationQuery(query);
  const run = async (task: () => Promise<unknown>, clear?: () => void) => { setBusy(true); setActionError(''); try { await task(); clear?.(); }
    catch (failure) { setActionError(message(failure)); } finally { setBusy(false); } };
  const data = result.data;
  const attachedPeople = new Set(data?.attachedPeople.map(item => item.id)); const attachedChapters = new Set(data?.attachedChapters.map(item => item.id));
  return <>
    <View style={styles.card}><View style={styles.row}><Text style={styles.section}>Companions</Text>
      <SmallAction title={peopleOpen ? 'Done' : 'Add'} onPress={() => setPeopleOpen(value => !value)} /></View>
      {!data ? <Text>Loading companions…</Text> : data.attachedPeople.length === 0 ? <Text style={styles.text}>No companions added</Text> :
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{data.attachedPeople.map(person =>
          <SmallAction key={person.id} title={`${person.displayName} ×`} disabled={busy}
            onPress={() => { void run(() => openVaultDatabase().then(v => v.companions.detachFromTrip(tripId, person.id))); }} />)}</View>}
      {peopleOpen && <View style={{ gap: 8 }}>
        <TextInput accessibilityLabel="Search local companions" placeholder="Search existing companions" style={styles.input} value={personSearch} onChangeText={setPersonSearch} />
        {data?.allPeople.filter(person => !attachedPeople.has(person.id)).map(person => <SmallAction key={person.id} title={`Add ${person.displayName}`}
          disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(v => v.companions.attachToTrip(tripId, person.id))); }} />)}
        <TextInput accessibilityLabel="New companion name" placeholder="New companion name" style={styles.input} value={newPerson} onChangeText={setNewPerson} />
        <Action title="Create and add companion" disabled={busy} onPress={() => { void run(async () => { const vault = await openVaultDatabase();
          const person = await vault.companions.create({ displayName: newPerson }); await vault.companions.attachToTrip(tripId, person.id); }, () => setNewPerson('')); }} />
        <SmallAction title="Open all Companions" onPress={() => router.push('/companions')} />
      </View>}
    </View>
    <View style={styles.card}><View style={styles.row}><Text style={styles.section}>Life Chapters</Text>
      <SmallAction title={chaptersOpen ? 'Done' : 'Add'} onPress={() => setChaptersOpen(value => !value)} /></View>
      {!data ? <Text>Loading chapters…</Text> : data.attachedChapters.length === 0 ? <Text style={styles.text}>No chapters added</Text> :
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{data.attachedChapters.map(chapter =>
          <SmallAction key={chapter.id} title={`${chapter.title} ×`} disabled={busy}
            onPress={() => { void run(() => openVaultDatabase().then(v => v.chapters.detachTrip(tripId, chapter.id))); }} />)}</View>}
      {chaptersOpen && <View style={{ gap: 8 }}>
        <TextInput accessibilityLabel="Search local chapters" placeholder="Search existing chapters" style={styles.input} value={chapterSearch} onChangeText={setChapterSearch} />
        {data?.allChapters.filter(chapter => !attachedChapters.has(chapter.id)).map(chapter => <SmallAction key={chapter.id} title={`Add ${chapter.title}`}
          disabled={busy} onPress={() => { void run(() => openVaultDatabase().then(v => v.chapters.attachTrip(tripId, chapter.id))); }} />)}
        <TextInput accessibilityLabel="New chapter title" placeholder="New chapter title" style={styles.input} value={newChapter} onChangeText={setNewChapter} />
        <Action title="Create and add chapter" disabled={busy} onPress={() => { void run(async () => { const vault = await openVaultDatabase();
          const chapter = await vault.chapters.create({ title: newChapter }); await vault.chapters.attachTrip(tripId, chapter.id); }, () => setNewChapter('')); }} />
        <SmallAction title="Open all Life Chapters" onPress={() => router.push('/chapters')} />
      </View>}
    </View>
    {result.error ? <Problem error={result.error} retry={result.retry} /> : null}{actionError ? <Problem error={actionError} /> : null}
  </>;
}
