import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../shared/ui/theme';
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
export function Action({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && { backgroundColor: theme.colors.selected }, (disabled || pressed) && { opacity: 0.6 }]}>
    <Text style={[styles.buttonText, secondary && { color: theme.colors.primary }]}>{title}</Text></Pressable>;
}
export function LoadingState({ label }: { label: string }) {
  return <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.medium, paddingVertical: theme.space.large }}>
    <ActivityIndicator color={theme.colors.primary} /><Text style={[styles.text, { flex: 1 }]}>{label}</Text>
  </View>;
}
export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.card}><Text accessibilityRole="header" style={styles.section}>{title}</Text><Text style={styles.text}>{detail}</Text></View>;
}
export function Problem({ error, retry }: { error: string; retry?: () => void }) {
  return <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{retry && <Action title="Retry" onPress={retry} />}</View>;
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background }, content: { padding: theme.space.page, gap: theme.space.large, paddingBottom: 48 },
  heading: { fontSize: 26, fontWeight: '700', color: theme.colors.ink }, section: { fontSize: 20, fontWeight: '600', color: theme.colors.ink, paddingVertical: 12 },
  text: { fontSize: 16, color: theme.colors.text, lineHeight: 24 }, card: { padding: theme.space.large, backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, gap: theme.space.small, marginBottom: 10 },
  button: { minHeight: 48, padding: theme.space.medium, backgroundColor: theme.colors.primary, borderRadius: theme.radius.control, justifyContent: 'center', marginVertical: 4 },
  buttonText: { color: theme.colors.surface, fontSize: 16, textAlign: 'center', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#8d9aaa', borderRadius: theme.radius.control, backgroundColor: theme.colors.surface, padding: theme.space.medium, fontSize: 16, minHeight: 48, color: theme.colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  error: { color: theme.colors.error, paddingVertical: 12, fontSize: 16 },
});
