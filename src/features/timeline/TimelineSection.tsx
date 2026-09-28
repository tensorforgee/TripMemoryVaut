import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Action, Problem, styles } from '../trips/ui';
import { dateLabel } from '../trips/presentation';
import { sectionTitle } from './presentation';
import { useTimeline } from './useTimeline';

export default function TimelineSection({ tripId }: { tripId: string }) {
  const result = useTimeline(tripId);
  return <View><Text style={styles.section}>Timeline</Text>
    {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading timeline…</Text> : <>
      {result.data.days.length === 0 && <Text style={styles.text}>No timeline added yet</Text>}
      {result.data.days.map(day => <View key={day.id} style={styles.card}>
        <Text style={styles.section}>{sectionTitle(day)}</Text>
        {day.label && day.dates && <Text style={styles.text}>{dateLabel(day.dates)}</Text>}
        <Text style={styles.text}>{result.data!.stops.filter(stop => stop.dayId === day.id).map(stop => stop.place.name).join(' → ') || 'No stops assigned'}</Text>
      </View>)}
      {result.data.stops.some(stop => stop.dayId === null) && <View style={styles.card}>
        <Text style={styles.section}>Unassigned Stops</Text>
        <Text style={styles.text}>{result.data.stops.filter(stop => stop.dayId === null).map(stop => stop.place.name).join(' → ')}</Text>
      </View>}
    </>}
    <Action title="Add day / section" onPress={() => router.push(`/trips/${tripId}/timeline`)} />
    {!!result.data?.days.length && <Action title="Edit timeline" onPress={() => router.push(`/trips/${tripId}/timeline`)} />}
  </View>;
}
