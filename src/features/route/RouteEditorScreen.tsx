import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, FlatList, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { openVaultDatabase } from '../../core/database/open';
import type { Place } from '../../domain/place';
import { dateLabel } from '../trips/presentation';
import { Action, Problem, message, styles } from '../trips/ui';
import { type DateForm, type PlaceForm, type StopForm, placeForm, placeFormPatch, stopForm, stopFormPatch } from './forms';
import type { RouteRepository, RouteStop } from './repository';
import { useRouteQuery } from './useRouteQuery';

function Input({ label, value, onChange, multiline = false, editable = true }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; editable?: boolean;
}) {
  return <View style={{ gap: 6 }}><Text style={styles.text}>{label}</Text>
    <TextInput accessibilityLabel={label} style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]}
      value={value} onChangeText={onChange} editable={editable} multiline={multiline} autoCapitalize="none" /></View>;
}
function Choices<T extends string>({ label, values, selected, change, disabled }: {
  label: string; values: readonly T[]; selected: T; change: (value: T) => void; disabled: boolean;
}) {
  return <View><Text style={styles.text}>{label}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {values.map(value => <Action key={value} title={`${selected === value ? '✓ ' : ''}${label}: ${value}`} disabled={disabled} onPress={() => change(value)} />)}
  </View></View>;
}
function PlaceInputs({ form, change, busy }: { form: PlaceForm; change: (form: PlaceForm) => void; busy: boolean }) {
  const [coordinates, setCoordinates] = useState(!!form.latitude || !!form.longitude);
  return <View style={{ gap: 12 }}><Input label="Place name" value={form.name} onChange={name => change({ ...form, name })} editable={!busy} />
    <Action title={coordinates ? 'Hide coordinates' : 'Optional coordinates'} disabled={busy} onPress={() => setCoordinates(value => !value)} />
    {coordinates && <>
      <Text style={styles.text}>Leave both blank if unknown. Enter coordinates only if you know them.</Text>
      <Input label="Latitude" value={form.latitude} onChange={latitude => change({ ...form, latitude })} editable={!busy} />
      <Input label="Longitude" value={form.longitude} onChange={longitude => change({ ...form, longitude })} editable={!busy} />
      <Choices label="Coordinate precision" values={['unknown', 'point', 'area'] as const} selected={form.coordinatePrecision}
        change={coordinatePrecision => change({ ...form, coordinatePrecision })} disabled={busy} />
    </>}
  </View>;
}
function Dates({ title, value, change, busy }: { title: string; value: DateForm; change: (value: DateForm) => void; busy: boolean }) {
  return <View style={{ gap: 12 }}><Text style={styles.section}>{title}</Text>
    <Text style={styles.text}>Use YYYY, YYYY-MM or YYYY-MM-DD. Blank endpoints stay unknown.</Text>
    <Input label={`${title} start`} value={value.start} onChange={start => change({ ...value, start })} editable={!busy} />
    <Input label={`${title} end`} value={value.end} onChange={end => change({ ...value, end })} editable={!busy} />
    <View style={styles.row}><Text style={styles.text}>Approximate</Text><Switch accessibilityLabel={`${title} approximate`} value={value.approximate}
      disabled={busy} onValueChange={approximate => change({ ...value, approximate })} /></View>
    <Input label={`${title} label`} value={value.label} onChange={label => change({ ...value, label })} editable={!busy} />
  </View>;
}
function useUnsaved(dirty: boolean, busy: boolean, close: () => void) {
  const navigation = useNavigation();
  usePreventRemove(dirty || busy, ({ data }) => {
    if (busy) return;
    Alert.alert('Discard unsaved changes?', 'This form has not been saved.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  return () => {
    if (busy) return;
    if (!dirty) { close(); return; }
    Alert.alert('Discard unsaved changes?', 'This form has not been saved.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: close },
    ]);
  };
}

function PlaceEditor({ place, close }: { place: Place; close: (saved?: boolean) => void }) {
  const [form, setForm] = useState(placeForm(place));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const cancel = useUnsaved(JSON.stringify(form) !== JSON.stringify(placeForm(place)), busy, close);
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await (await openVaultDatabase()).routes.updatePlace(place.id, placeFormPatch(form, place)); close(true); }
    catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>Edit place</Text><Text style={styles.text}>Changes to this shared place apply to every stop that uses it.</Text>
    {error ? <Problem error={error} /> : null}
    <PlaceInputs form={form} change={setForm} busy={busy} />
    <Action title={busy ? 'Saving…' : 'Save place'} disabled={busy} onPress={() => { void save(); }} />
    <Action title="Cancel" disabled={busy} onPress={cancel} />
  </ScrollView>;
}

function StopEditor({ tripId, stop, close }: { tripId: string; stop?: RouteStop; close: (saved?: boolean) => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>(stop ? 'existing' : 'new');
  const [selected, setSelected] = useState<Place | undefined>(stop?.place);
  const [place, setPlace] = useState(placeForm());
  const [form, setForm] = useState(stopForm(stop));
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState(1);
  const [showDates, setShowDates] = useState(!!stop?.dates || !!stop?.checkoutDates);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const listQuery = useCallback(async (repo: RouteRepository) => {
    const values: Place[] = [];
    for (let page = 0; page < pages; page++) values.push(...await repo.listPlaces(query, 50, page * 50));
    return values;
  }, [query, pages]);
  const places = useRouteQuery(listQuery);
  const dirty = JSON.stringify(form) !== JSON.stringify(stopForm(stop)) || JSON.stringify(place) !== JSON.stringify(placeForm()) || selected?.id !== stop?.placeId;
  const cancel = useUnsaved(dirty, busy, close);
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const repo = (await openVaultDatabase()).routes;
      const fields = stopFormPatch(form, stop);
      if (stop) {
        if (!selected) throw new Error('Select a local place.');
        await repo.editStop(tripId, stop.id, { ...fields, placeId: selected.id });
      } else if (mode === 'new') {
        await repo.createPlaceAndAddStop(tripId, placeFormPatch(place), fields);
      } else {
        if (!selected) throw new Error('Select a local place.');
        await repo.addStop(tripId, { ...fields, placeId: selected.id });
      }
      close(true);
    } catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>{stop ? 'Edit stop' : 'Add stop'}</Text>
    {error ? <Problem error={error} /> : null}
    <Action title={busy ? 'Saving…' : 'Save stop'} disabled={busy} onPress={() => { void save(); }} />
    <Action title="Cancel" disabled={busy} onPress={cancel} />
    {!stop && <Choices label="Place" values={['new', 'existing'] as const} selected={mode} change={setMode} disabled={busy} />}
    {mode === 'new' ? <PlaceInputs form={place} change={setPlace} busy={busy} /> : <View style={{ gap: 8 }}>
      {selected ? <Text style={styles.section}>Selected: {selected.name}</Text> : <Text style={styles.text}>Choose an existing local place.</Text>}
      <Input label="Find local place" value={query} onChange={value => { setQuery(value); setPages(1); }} editable={!busy} />
      {places.error ? <Problem error={places.error} retry={places.retry} /> : !places.data ? <Text>Loading places…</Text> :
        places.data.length === 0 ? <Text>No matching local places.</Text> : places.data.map(item => <View key={item.id} style={styles.card}>
          <Text>{item.latitude === null ? 'Coordinates unknown' : `${item.latitude}, ${item.longitude} · ${item.coordinatePrecision}`}</Text>
          <Text>Added to vault: {new Date(item.createdAt).toLocaleString()}</Text>
          <Action title={`${selected?.id === item.id ? '✓ ' : ''}Use ${item.name}`} disabled={busy} onPress={() => setSelected(item)} />
        </View>)}
      {places.data?.length === pages * 50 && <Action title="More local places" disabled={busy} onPress={() => setPages(value => value + 1)} />}
    </View>}
    <Choices label="Kind" values={['visit', 'stay', 'transit'] as const} selected={form.kind} disabled={busy} change={kind => setForm({ ...form, kind })} />
    <View style={styles.row}><Text style={styles.text}>Visit confirmed</Text><Switch accessibilityLabel="Visit confirmed" value={form.visitConfirmed}
      disabled={busy} onValueChange={visitConfirmed => setForm({ ...form, visitConfirmed })} /></View>
    <Choices label="Details" values={['unknown', 'approximate', 'exact'] as const} selected={form.detailCertainty} disabled={busy}
      change={detailCertainty => setForm({ ...form, detailCertainty })} />
    <Input label="Stop note (optional)" value={form.note} multiline editable={!busy} onChange={note => setForm({ ...form, note })} />
    {form.kind === 'stay' && <Input label="Lodging label (optional)" value={form.lodgingLabel} editable={!busy} onChange={lodgingLabel => setForm({ ...form, lodgingLabel })} />}
    <Action title={showDates ? 'Hide dates' : 'Optional dates'} disabled={busy} onPress={() => setShowDates(value => !value)} />
    {showDates && <>
      <Dates title={form.kind === 'stay' ? 'Check-in dates' : 'Stop dates'} value={form.dates} busy={busy} change={dates => setForm({ ...form, dates })} />
      {form.kind === 'stay' && <Dates title="Checkout dates" value={form.checkoutDates} busy={busy} change={checkoutDates => setForm({ ...form, checkoutDates })} />}
    </>}
    <Action title={stop ? 'Save stop changes' : 'Add to route'} disabled={busy} onPress={() => { void save(); }} />
  </ScrollView>;
}

export default function RouteEditorScreen() {
  const { tripId, editPlaceId } = useLocalSearchParams<{ tripId: string; editPlaceId?: string }>();
  const query = useCallback((repo: RouteRepository) => repo.getRoute(tripId), [tripId]);
  const route = useRouteQuery(query);
  const [panel, setPanel] = useState<{ type: 'stop'; stop?: RouteStop } | { type: 'place'; place: Place }>();
  const openedPlace = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!editPlaceId || openedPlace.current === editPlaceId || route.error) return;
    const place = route.data?.stops.find(s => s.placeId === editPlaceId)?.place;
    if (place) { openedPlace.current = editPlaceId; setPanel({ type: 'place', place }); }
  }, [editPlaceId, route.data, route.error]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removed, setRemoved] = useState<{ id: string; name: string }>();
  async function run(task: (repo: RouteRepository) => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await task((await openVaultDatabase()).routes); setNotice('Saved on device'); }
    catch (e) { setError(message(e)); route.retry(); } finally { lock.current = false; setBusy(false); }
  }
  function move(index: number, direction: number) {
    if (!route.data) return;
    const ids = route.data.stops.map(stop => stop.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void run(repo => repo.reorderStops(tripId, ids, route.data!.revision));
  }
  function close(saved = false) { setPanel(undefined); setNotice(saved ? 'Saved on device' : ''); }
  if (panel?.type === 'place') return <PlaceEditor place={panel.place} close={close} />;
  if (panel?.type === 'stop') return <StopEditor tripId={tripId} stop={panel.stop} close={close} />;
  return <FlatList style={styles.page} contentContainerStyle={styles.content} data={route.error ? [] : route.data?.stops ?? []} keyExtractor={stop => stop.id}
    ListHeaderComponent={<View style={{ gap: 8 }}><Text style={styles.heading}>Route / Stops</Text>
      <Text style={styles.text}>Ordered places you remember visiting. Repeated visits stay separate.</Text>
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Problem error={error} /> : null}
      {route.error ? <Problem error={route.error} retry={route.retry} /> : !route.data ? <Text>Loading route…</Text> : null}
      <Action title="Add stop" disabled={busy || !route.data || !!route.error} onPress={() => { setNotice(''); setPanel({ type: 'stop' }); }} />
      {removed && <Action title={`Undo removal of ${removed.name}`} disabled={busy} onPress={() => { void run(async repo => { await repo.restoreStop(tripId, removed.id); setRemoved(undefined); }); }} />}
    </View>}
    ListEmptyComponent={route.data && !route.error ? <Text style={styles.text}>No route added yet</Text> : null}
    renderItem={({ item, index }) => <View style={styles.card}>
      {index > 0 && <Text style={styles.text}>↓</Text>}
      <Text style={styles.section}>{index + 1}. {item.place.name}</Text>
      <Text style={styles.text}>{item.kind} · {item.detailCertainty} details · {item.visitConfirmed ? 'Visit confirmed' : 'Visit unconfirmed'}</Text>
      <Text>{item.place.latitude === null ? 'Coordinates unknown' : `${item.place.latitude}, ${item.place.longitude} · ${item.place.coordinatePrecision}`}</Text>
      {item.note && <Text style={styles.text}>{item.note}</Text>}
      {item.lodgingLabel && <Text style={styles.text}>Lodging: {item.lodgingLabel}</Text>}
      {item.dates && <Text style={styles.text}>{item.kind === 'stay' ? 'Check-in: ' : ''}{dateLabel(item.dates)}</Text>}
      {item.checkoutDates && <Text style={styles.text}>Checkout: {dateLabel(item.checkoutDates)}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Action title={`Move ${item.place.name} up`} disabled={busy || index === 0} onPress={() => move(index, -1)} />
        <Action title={`Move ${item.place.name} down`} disabled={busy || index === route.data!.stops.length - 1} onPress={() => move(index, 1)} />
      </View>
      <Action title={`Edit stop ${index + 1}`} disabled={busy} onPress={() => { setNotice(''); setPanel({ type: 'stop', stop: item }); }} />
      <Action title={`Edit place ${item.place.name}`} disabled={busy} onPress={() => { setNotice(''); setPanel({ type: 'place', place: item.place }); }} />
      <Action title={`Remove stop ${index + 1}`} disabled={busy} onPress={() => Alert.alert(`Remove ${item.place.name}?`, 'Only this stop is removed. The shared place remains available.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove stop', style: 'destructive', onPress: () => { void run(async repo => {
          await repo.removeStop(tripId, item.id); setRemoved({ id: item.id, name: item.place.name });
        }); } },
      ])} />
    </View>} />;
}
