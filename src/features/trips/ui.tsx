import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { openVaultDatabase } from '../../core/database/open';
import type { TripRepository } from './repository';

export function useTripQuery<T>(query: (repository: TripRepository) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    const read = async (repository: TripRepository) => {
      const current = ++generation;
      try { const result = await query(repository); if (active && current === generation) { setData(result); setError(''); } }
      catch (e) { if (active && current === generation) setError(message(e)); }
    };
    openVaultDatabase().then(vault => {
      if (!active) return;
      unsubscribe = vault.trips.subscribe(() => { void read(vault.trips); });
      void read(vault.trips);
    }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; unsubscribe?.(); };
  }, [query, retry]));
  return { data, error, retry: () => setRetry(value => value + 1) };
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function Action({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && { opacity: 0.5 }]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
export function Problem({ error, retry }: { error: string; retry?: () => void }) {
  return <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{retry && <Action title="Retry" onPress={retry} />}</View>;
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f8fa' }, content: { padding: 20, gap: 16, paddingBottom: 48 },
  heading: { fontSize: 26, fontWeight: '700', color: '#17283b' }, section: { fontSize: 20, fontWeight: '600', paddingVertical: 12 },
  text: { fontSize: 16, color: '#34465a', lineHeight: 24 }, card: { padding: 16, backgroundColor: '#fff', borderRadius: 10, gap: 8, marginBottom: 10 },
  button: { minHeight: 48, padding: 12, backgroundColor: '#183e63', borderRadius: 8, justifyContent: 'center', marginVertical: 4 },
  buttonText: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#8d9aaa', borderRadius: 6, backgroundColor: '#fff', padding: 12, fontSize: 16, minHeight: 48, color: '#17283b' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  error: { color: '#a12626', paddingVertical: 12, fontSize: 16 },
});
