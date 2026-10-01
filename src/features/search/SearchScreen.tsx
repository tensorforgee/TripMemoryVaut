import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../../core/database/open';
import type { SearchResult } from './repository';
import { message, styles } from '../trips/ui';

const labels: Record<SearchResult['entityType'], string> = {
  trip: 'Trip', place: 'Place', stop: 'Stop note', tripDay: 'Trip section', companion: 'Companion',
  chapter: 'Chapter', dream: 'Dream', mediaCaption: 'Photo caption',
};

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    const trimmed = query.trim();
    if (!trimmed) { setResults([]); setLoading(false); setError(''); return () => { active = false; }; }
    setLoading(true);
    const timer = setTimeout(() => {
      openVaultDatabase().then(vault => vault.search.search(trimmed)).then(value => {
        if (active) { setResults(value); setError(''); setLoading(false); }
      }).catch(failure => { if (active) { setError(message(failure)); setLoading(false); } });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [query]));
  const empty = query.trim() ? (loading ? 'Searching this device…' : 'No matching memories.')
    : 'Search trips, places, people, chapters and dreams';
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <FlatList keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} data={results}
      keyExtractor={item => `${item.entityType}:${item.entityId}`}
      ListHeaderComponent={<View style={{ gap: 12 }}>
        <Text style={styles.heading}>Search your memories</Text>
        <TextInput accessibilityLabel="Search your local archive" autoCapitalize="none" autoCorrect={false}
          placeholder="Trips, places, people, notes…" returnKeyType="search" style={styles.input}
          value={query} onChangeText={setQuery} />
        <Text style={styles.text}>Private, offline search of confirmed archive content.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>}
      ListEmptyComponent={<View style={styles.card}><Text style={styles.text}>{empty}</Text></View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${labels[item.entityType]}: ${item.primaryTitle}`}
        style={styles.card} onPress={() => router.push(item.navigationTarget as never)}>
        <View style={styles.row}><Text style={{ color: '#49647d', fontWeight: '700' }}>{labels[item.entityType]}</Text>
          {item.contextLabel ? <Text style={{ color: '#7a4a00', fontWeight: '700' }}>{item.contextLabel}</Text> : null}</View>
        <Text style={[styles.section, { paddingVertical: 0 }]}>{item.primaryTitle}</Text>
        <Text style={styles.text}>{item.subtitle}</Text>
      </Pressable>} />
  </SafeAreaView>;
}
