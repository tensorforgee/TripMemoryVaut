import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import type { Trip } from '../../domain/trip';
import type { PartialDate } from '../../domain/date-spec';
import { openVaultDatabase } from '../../core/database/open';
import { formPatch, saveTripForm, tripForm, type TripForm } from './presentation';
import { Action, Problem, message, styles } from './ui';

const precisions: { value: PartialDate['precision']; label: string }[] = [
  { value: 'unknown', label: 'Unknown' }, { value: 'day', label: 'Exact day' },
  { value: 'month', label: 'Month / year' }, { value: 'year', label: 'Year only' },
];
const hints = { day: 'YYYY-MM-DD', month: 'YYYY-MM', year: 'YYYY', unknown: '' };

export default function TripEditorScreen() {
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const navigation = useNavigation();
  const [form, setForm] = useState<TripForm>(tripForm());
  const [loaded, setLoaded] = useState(!tripId);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('Enter a title to start a draft.');
  const [busy, setBusy] = useState(false);
  const [leavingTrip, setLeavingTrip] = useState<string>();
  const [savedForm, setSavedForm] = useState(JSON.stringify(tripForm()));
  const original = useRef<Trip | undefined>(undefined);
  const currentForm = useRef(form);
  const lastSaved = useRef(savedForm);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const finishing = useRef(false);
  const mounted = useRef(true);
  currentForm.current = form;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (tripId) openVaultDatabase().then(vault => vault.trips.getTripById(tripId)).then(trip => {
      if (!active) return;
      if (!trip) throw new Error('Trip unavailable. Restore it from Trash before editing.');
      original.current = trip;
      const initial = tripForm(trip);
      currentForm.current = initial;
      lastSaved.current = JSON.stringify(initial);
      setForm(initial); setSavedForm(lastSaved.current); setLoaded(true); setSaveState('Saved on device');
    }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [tripId]);

  function persist(snapshot: TripForm, status?: 'draft' | 'saved'): Promise<Trip> {
    const operation = queue.current.then(async () => {
      const repo = (await openVaultDatabase()).trips;
      let trip = await saveTripForm(repo, snapshot, original.current, status);
      original.current = trip;
      if (status && trip.status !== status) {
        trip = await repo.updateBasicTripFields(trip.id, { status });
        original.current = trip;
      }
      const serialized = JSON.stringify(snapshot);
      lastSaved.current = serialized;
      if (mounted.current) {
        setSavedForm(serialized);
        if (JSON.stringify(currentForm.current) === serialized) { setSaveState('Saved on device'); setError(''); }
      }
      return trip;
    });
    queue.current = operation.catch(() => undefined);
    return operation;
  }

  useEffect(() => {
    if (!loaded || finishing.current || JSON.stringify(form) === lastSaved.current) return;
    setSaveState('Unsaved changes');
    const timer = setTimeout(() => {
      if (finishing.current) return;
      try {
        if (!form.title.trim()) throw new Error('Enter a title.');
        formPatch(form, original.current);
      } catch (e) { setError(message(e)); return; }
      setSaveState('Saving…');
      void persist(form).catch(e => { if (mounted.current) { setSaveState('Not saved'); setError(message(e)); } });
    }, 600);
    return () => clearTimeout(timer);
  }, [form, loaded]);

  const dirty = loaded && JSON.stringify(form) !== savedForm;
  usePreventRemove(!leavingTrip && (dirty || busy), ({ data }) => {
    if (finishing.current) return;
    Alert.alert('Unsaved changes', 'Save these changes before leaving, or discard only the input that has not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard unsaved', style: 'destructive', onPress: () => {
        finishing.current = true;
        void queue.current.then(() => navigation.dispatch(data.action));
      } },
      { text: 'Save and leave', onPress: () => {
        finishing.current = true; setBusy(true);
        void persist(currentForm.current).then(() => navigation.dispatch(data.action)).catch(e => {
          finishing.current = false; setBusy(false); setError(message(e));
        });
      } },
    ]);
  });
  useEffect(() => { if (leavingTrip) router.dismissTo(`/trips/${leavingTrip}`); }, [leavingTrip]);

  async function finish(status?: 'draft' | 'saved') {
    if (finishing.current) return;
    finishing.current = true; setBusy(true); setError(''); setSaveState('Saving…');
    try { const trip = await persist(currentForm.current, status); setLeavingTrip(trip.id); }
    catch (e) { finishing.current = false; setBusy(false); setSaveState('Not saved'); setError(message(e)); }
  }
  function change<K extends keyof TripForm>(key: K, value: TripForm[K]) {
    setForm(before => ({ ...before, [key]: value }));
  }
  function dateInput(which: 'start' | 'end') {
    const precisionKey = which === 'start' ? 'startPrecision' : 'endPrecision';
    const precision = form[precisionKey];
    const label = which === 'start' ? 'Start' : 'End';
    return <View style={{ gap: 8 }}><Text style={styles.section}>{label} date</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{precisions.map(option =>
        <Action key={option.value} title={`${precision === option.value ? '✓ ' : ''}${label}: ${option.label}`} disabled={busy}
          onPress={() => change(precisionKey, option.value)} />)}</View>
      {precision !== 'unknown' && <TextInput accessibilityLabel={`${label} date ${hints[precision]}`} placeholder={hints[precision]}
        placeholderTextColor="#687789" style={styles.input} value={form[which]} editable={!busy}
        autoCapitalize="none" onChangeText={value => change(which, value)} />}
    </View>;
  }
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{tripId ? 'Edit trip' : 'Create trip'}</Text>
      {error ? <Problem error={error} /> : null}
      {loaded && <>
        <Text accessibilityLiveRegion="polite" style={styles.text}>{saveState}</Text>
        <Text style={styles.text}>Valid changes save automatically on this device. New trips start as drafts.</Text>
        <Text style={styles.text}>Title</Text><TextInput accessibilityLabel="Trip title" style={styles.input} value={form.title}
          editable={!busy} onChangeText={value => change('title', value)} />
        {dateInput('start')}{dateInput('end')}
        <Text style={styles.text}>Leave unknown endpoints unknown. For a single known day, enter the same start and end.</Text>
        <View style={styles.row}><Text style={styles.text}>Approximate dates</Text><Switch accessibilityLabel="Approximate dates"
          value={form.approximate} disabled={busy || (form.startPrecision === 'unknown' && form.endPrecision === 'unknown')}
          onValueChange={value => change('approximate', value)} /></View>
        <Text style={styles.text}>Date label (optional)</Text><TextInput accessibilityLabel="Date label" style={styles.input}
          editable={!busy} value={form.label} onChangeText={value => change('label', value)} />
        <Text style={styles.text}>Summary (optional)</Text><TextInput accessibilityLabel="Summary" style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
          editable={!busy} multiline value={form.summary} onChangeText={value => change('summary', value)} />
        <View style={styles.row}><Text style={styles.text}>Favourite</Text><Switch accessibilityLabel="Favourite" value={form.isFavourite}
          disabled={busy} onValueChange={value => change('isFavourite', value)} /></View>
        <Action title="Save trip" disabled={busy} onPress={() => { void finish('saved'); }} />
        <Action title="Save as draft" disabled={busy} onPress={() => { void finish('draft'); }} />
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
