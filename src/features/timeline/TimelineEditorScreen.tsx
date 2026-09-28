import { useRef, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { openVaultDatabase } from '../../core/database/open';
import type { TripDay } from '../../domain/trip-day';
import { dateForm, formDate } from '../route/forms';
import { dateLabel } from '../trips/presentation';
import { Action, Problem, message, styles } from '../trips/ui';
import { sectionTitle } from './presentation';
import type { TimelineRepository } from './repository';
import { useTimeline } from './useTimeline';

function SectionEditor({ tripId, day, close }: { tripId: string; day?: TripDay; close: (saved?: boolean) => void }) {
  const [label, setLabel] = useState(day?.label ?? '');
  const [dates, setDates] = useState(dateForm(day?.dates ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const navigation = useNavigation();
  const dirty = label !== (day?.label ?? '') || JSON.stringify(dates) !== JSON.stringify(dateForm(day?.dates ?? null));
  const discard = (action: () => void) => {
    if (busy) return;
    if (!dirty) { action(); return; }
    Alert.alert('Discard unsaved changes?', 'This section form has not been saved.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  };
  usePreventRemove(dirty || busy, ({ data }) => discard(() => navigation.dispatch(data.action)));
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const fields = { label: label.trim() || null, dates: formDate(dates, day?.dates) };
      const repo = (await openVaultDatabase()).timeline;
      if (day) await repo.updateTripDay(tripId, day.id, fields); else await repo.createTripDay(tripId, fields);
      close(true);
    } catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>{day ? 'Edit section' : 'Add day / section'}</Text>
    <Text style={styles.text}>Dates and labels are optional. Section order does not imply calendar days.</Text>
    {error ? <Problem error={error} /> : null}
    <Text style={styles.text}>Label</Text><TextInput accessibilityLabel="Section label" style={styles.input} value={label} onChangeText={setLabel} editable={!busy} placeholder="Early in the trip, Day 1, Part 2…" />
    <Text style={styles.text}>Optional dates: YYYY, YYYY-MM or YYYY-MM-DD. For a single day, enter the same date in both fields. Blank endpoints remain unknown.</Text>
    <Text style={styles.text}>Start</Text><TextInput accessibilityLabel="Section start" style={styles.input} value={dates.start} onChangeText={start => setDates({ ...dates, start })} editable={!busy} />
    <Text style={styles.text}>End</Text><TextInput accessibilityLabel="Section end" style={styles.input} value={dates.end} onChangeText={end => setDates({ ...dates, end })} editable={!busy} />
    <View style={styles.row}><Text style={styles.text}>Approximate</Text><Switch accessibilityLabel="Section approximate" value={dates.approximate} onValueChange={approximate => setDates({ ...dates, approximate })} disabled={busy} /></View>
    <Text style={styles.text}>Date description (optional)</Text><TextInput accessibilityLabel="Section date description" style={styles.input} value={dates.label} onChangeText={value => setDates({ ...dates, label: value })} editable={!busy} />
    <Action title={busy ? 'Saving…' : 'Save section'} disabled={busy} onPress={() => { void save(); }} />
    <Action title="Cancel" disabled={busy} onPress={() => discard(close)} />
  </ScrollView>;
}

export default function TimelineEditorScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const result = useTimeline(tripId);
  const [editing, setEditing] = useState<TripDay | 'new' | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  usePreventRemove(busy, () => {});
  async function run(task: (repo: TimelineRepository) => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSaved(false);
    try { await task((await openVaultDatabase()).timeline); setSaved(true); }
    catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  }
  if (editing) return <SectionEditor tripId={tripId} day={editing === 'new' ? undefined : editing} close={saved => { setEditing(null); setSaved(!!saved); }} />;
  const data = result.data;
  function move(index: number, delta: number) {
    if (!data) return;
    const ids = data.days.map(day => day.id);
    [ids[index], ids[index+delta]] = [ids[index+delta], ids[index]];
    void run(repo => repo.reorderTripDays(tripId, ids, data.revision));
  }
  function stops(dayId: string | null) {
    const values = data!.stops.filter(stop => stop.dayId === dayId);
    return <>{values.length === 0 && <Text style={styles.text}>No stops assigned</Text>}{values.map(stop => <View key={stop.id}>
      <Text style={styles.text}>{stop.place.name} · Route stop {stop.position+1}</Text>
      <Action title={`Assign / move ${stop.place.name}`} disabled={busy} onPress={() => setAssigning(assigning === stop.id ? null : stop.id)} />
      {assigning === stop.id && <View style={styles.card}>
        {data!.days.map(day => <Action key={day.id} title={`Move to ${sectionTitle(day)}`} disabled={busy || day.id === stop.dayId}
          onPress={() => { void run(async repo => { await repo.assignStop(tripId, stop.id, day.id); setAssigning(null); }); }} />)}
        <Action title="Unassign from section" disabled={busy || stop.dayId === null} onPress={() => { void run(async repo => { await repo.unassignStop(tripId, stop.id); setAssigning(null); }); }} />
        <Action title="Close assignment" disabled={busy} onPress={() => setAssigning(null)} />
      </View>}
    </View>)}</>;
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Timeline</Text>
    {error ? <Problem error={error} /> : null}
    {saved && <Text accessibilityLiveRegion="polite">Saved on device</Text>}
    <Action title="Add day / section" disabled={busy} onPress={() => { setSaved(false); setEditing('new'); }} />
    {removed && <Action title="Restore removed section (empty)" disabled={busy} onPress={() => { void run(async repo => { await repo.restoreTripDay(tripId, removed); setRemoved(null); }); }} />}
    {result.error ? <Problem error={result.error} retry={result.retry} /> : !data ? <Text>Loading timeline…</Text> : <>
      {data.days.length === 0 && <Text style={styles.text}>No timeline added yet</Text>}
      {data.days.map((day, index) => <View key={day.id} style={styles.card}>
        <Text style={styles.section}>{sectionTitle(day)}</Text>
        {day.label && day.dates && <Text style={styles.text}>{dateLabel(day.dates)}</Text>}
        <Action title={`Edit ${sectionTitle(day)}`} disabled={busy} onPress={() => { setSaved(false); setEditing(day); }} />
        <Action title={`Move ${sectionTitle(day)} up`} disabled={busy || index === 0} onPress={() => move(index,-1)} />
        <Action title={`Move ${sectionTitle(day)} down`} disabled={busy || index === data.days.length-1} onPress={() => move(index,1)} />
        <Action title={`Remove ${sectionTitle(day)}`} disabled={busy} onPress={() => Alert.alert('Remove section?', 'Its Stops will remain in this trip as unassigned. Their dates will not change.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void run(async repo => { await repo.removeTripDay(tripId, day.id); setRemoved(day.id); }); } },
        ])} />
        {stops(day.id)}
      </View>)}
      <Text style={styles.section}>Unassigned Stops</Text>{stops(null)}
    </>}
  </ScrollView>;
}
