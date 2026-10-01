import { useCallback } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VaultDatabase } from '../../core/database/open';
import { Action, Problem, styles } from '../trips/ui';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';
import type { TravelLifeOverview } from './repository';

function plural(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function Metric({ label, value, note, onPress }: { label: string; value: string; note?: string; onPress?: () => void }) {
  const body = <><Text style={local.metricValue}>{value}</Text><Text style={local.metricLabel}>{label}</Text>
    {note ? <Text style={local.metricNote}>{note}</Text> : null}</>;
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={local.metric}>{body}</Pressable>
    : <View accessibilityLabel={`${label}: ${value}`} style={local.metric}>{body}</View>;
}

function SectionHeader({ title, action, onPress }: { title: string; action: string; onPress: () => void }) {
  return <View style={styles.row}><Text style={styles.section}>{title}</Text>
    <Pressable accessibilityRole="button" onPress={onPress} style={local.textAction}><Text style={local.link}>{action}</Text></Pressable></View>;
}

function Overview({ value }: { value: TravelLifeOverview }) {
  const metrics = value.metrics;
  return <>
    <View style={local.metricGrid}>
      <Metric label="Trips" value={String(metrics.trips)} onPress={() => router.navigate('/')} />
      <Metric label="Places" value={String(metrics.places)} onPress={() => router.push('/life/places')} />
      <Metric label="Visits" value={String(metrics.visits)} onPress={() => router.push('/life/places')} />
      <Metric label="Photos" value={String(metrics.photos)} note="unique archived media" />
      <Metric label="Recorded distance" value="Unavailable" note="not stored in canonical Trip data" />
    </View>

    <SectionHeader title="Life Chapters" action="View all" onPress={() => router.push('/chapters')} />
    {value.chapters.length ? value.chapters.map(chapter => <Pressable key={chapter.id} accessibilityRole="button"
      onPress={() => router.push(`/chapters/${chapter.id}`)} style={styles.card}>
      <Text style={local.itemTitle}>{chapter.title}</Text><Text style={styles.text}>{plural(chapter.tripCount, 'trip')}</Text>
    </Pressable>) : <Text style={styles.text}>No Chapters contain saved Trips yet.</Text>}

    <SectionHeader title="Companions" action="View all" onPress={() => router.push('/companions')} />
    {value.companions.length ? value.companions.map(companion => <Pressable key={companion.id} accessibilityRole="button"
      onPress={() => router.push(`/companions/${companion.id}`)} style={styles.card}>
      <Text style={local.itemTitle}>{companion.displayName}</Text><Text style={styles.text}>{plural(companion.tripCount, 'trip')}</Text>
    </Pressable>) : <Text style={styles.text}>No Companions are linked to saved Trips yet.</Text>}

    <Text style={styles.section}>Travel history</Text>
    {value.history.length ? value.history.map(group => <View key={group.key}>
      <Text style={local.year}>{group.title}</Text>
      {group.trips.map(trip => <Pressable key={trip.id} accessibilityRole="button" onPress={() => router.push(`/trips/${trip.id}`)} style={styles.card}>
        <Text style={local.itemTitle}>{trip.title}</Text><Text style={styles.text}>{trip.dateLabel}</Text>
      </Pressable>)}
    </View>) : <Text style={styles.text}>Your saved travel history will appear here.</Text>}
  </>;
}

export default function TravelLifeScreen() {
  const query = useCallback((vault: VaultDatabase) => vault.life.overview(), []);
  const result = useOrganizationQuery(query);
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Travel Life</Text>
      <Text style={styles.text}>A view of your confirmed archive so far. Saved Trips and confirmed visits only; drafts and Trash stay out.</Text>
      {result.error ? <Problem error={result.error} retry={result.retry} /> : result.data ? <Overview value={result.data} /> : <Text>Reading your local archive…</Text>}
      <Action title="Open My Map" onPress={() => router.push('/map')} />
      <Action title="Browse Places" onPress={() => router.push('/life/places')} />
      <Action title="Settings" onPress={() => router.push('/settings')} />
    </ScrollView>
  </SafeAreaView>;
}

const local = StyleSheet.create({
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { width: '47%', minHeight: 118, padding: 16, borderRadius: 12, backgroundColor: '#fff', justifyContent: 'center', gap: 4 },
  metricValue: { color: '#17283b', fontSize: 26, fontWeight: '700' },
  metricLabel: { color: '#34465a', fontSize: 15, fontWeight: '600' },
  metricNote: { color: '#667789', fontSize: 12, lineHeight: 17 },
  itemTitle: { color: '#17283b', fontSize: 17, fontWeight: '600' },
  year: { color: '#52657a', fontSize: 18, fontWeight: '700', paddingVertical: 8 },
  textAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  link: { color: '#183e63', fontSize: 15, fontWeight: '600' },
});
