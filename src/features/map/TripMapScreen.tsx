import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, AppState, BackHandler, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Camera, GeoJSONSource, Images, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { offlineStyle } from '../../core/maps/offline-style';
import { Action, LoadingState, Problem } from '../trips/ui';
import { theme } from '../../shared/ui/theme';
import { buildTripMap, fitTripCamera } from './model';
import { roadDisplay, roadFeatures, roadSegments, STOPS_ONLY_LABEL, type RoadProposal } from '../road-route/model';
import { RoadRouteEditor } from '../road-route/RoadRouteEditor';
import { basemapPresentation, mapPalette, resolveMapStyleUrl, selectedStopDetails, stopRole,
  tripMapCamera, tripMapSummary, tripMarkerFeatures, type BasemapState } from './trip-map-v2';
import { markerImages } from './marker-images';
import { useTripMap } from './useTripMap';
import { PhotoMemoryEditor, PhotoMemoryMarkers } from './PhotoMemories';
import { longPressPin, type PinDraft } from './photo-memory-model';
import type { PhotoMemoryPin } from './photo-memory-repository';
import type { Coordinate } from './model';

const styleUrl = resolveMapStyleUrl(process.env.EXPO_PUBLIC_MAP_STYLE_URL);
const isMapTiler = styleUrl !== null && new URL(styleUrl).hostname === 'api.maptiler.com';
// MapLibre Android includes this package ID in its native User-Agent. Keep the
// independent reachability probe compatible with the same mobile key restriction.
const basemapHeaders = { 'Cache-Control': 'no-cache', 'User-Agent': 'com.tripmemoryvault.app/basemap-probe' };
const fallback = basemapPresentation('unavailable');

function Button({ title, onPress, primary = false }: { title: string; onPress: () => void; primary?: boolean }) {
  return <Action title={title} onPress={onPress} secondary={!primary} />;
}

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <View style={s.empty}>
      <Text style={s.title}>{fallback.label}</Text><Text style={s.body}>{fallback.detail}</Text>
      <Button title="Retry map" onPress={() => this.setState({ failed: false })} />
    </View> : this.props.children;
  }
}

function TripCanvas({ model, selected, select, fitRequest, roads, previews, approximate, pins, selectPin, longPress }: {
  model: ReturnType<typeof buildTripMap>; selected?: string; select: (id: string) => void; fitRequest: number;
  roads: RoadProposal[]; previews: RoadProposal[];
  approximate: ReturnType<typeof buildTripMap>['lines'];
  pins: PhotoMemoryPin[]; selectPin: (pin: PhotoMemoryPin) => void; longPress: (point: Coordinate) => void;
}) {
  const [state, setState] = useState<BasemapState>(styleUrl ? 'loading' : 'unconfigured');
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useRef<CameraRef>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const styleReady = useRef(false);
  const initialized = useRef(false);
  const view = useRef<{ center: [number, number]; zoom: number }>({ center: [0, 20], zoom: 1 });
  const stateRef = useRef(state); stateRef.current = state;
  const local = state === 'offline' || state === 'unconfigured';
  const points = useMemo(() => tripMarkerFeatures(model, selected), [model, selected]);
  const digits = Math.max(1, ...points.features.map(f => f.properties.digits.length));
  const roadData = useMemo(() => roadFeatures(roads), [roads]);
  const previewData = useMemo(() => roadFeatures(previews), [previews]);
  const cameraPoints = useMemo(() => [...model.mapped.map(item => item.coordinate),
    ...roads.flatMap(r => r.geometry.coordinates), ...previews.flatMap(r => r.geometry.coordinates),
    ...pins.map(p => [p.longitude,p.latitude] as Coordinate)], [model, roads, previews, pins]);
  const fit = useMemo(() => fitTripCamera(cameraPoints, size.width, size.height) ?? tripMapCamera(model,size.width,size.height), [cameraPoints, size]);
  const focused = model.mapped.find(item => item.stop.id === selected);
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  const armTimer = () => {
    clearTimer();
    if (!styleUrl || ['offline', 'unconfigured', 'unavailable'].includes(stateRef.current)) return;
    timer.current = setTimeout(() => { styleReady.current = false; setState('offline'); }, 12000);
  };
  const retry = () => {
    if (!styleUrl) return;
    styleReady.current = false; setState('loading'); setAttempt(a => a + 1);
  };
  useEffect(() => {
    armTimer();
    // Native tile caches can render even with radios disabled. Probe the style
    // independently so a cold offline launch gets an intentional local state.
    const controller = new AbortController();
    let active = true;
    const deadline = setTimeout(() => controller.abort(), 8000);
    if (styleUrl) void fetch(styleUrl, { signal: controller.signal, headers: basemapHeaders })
      .then(response => { if (!response.ok) throw new Error('Basemap unavailable'); })
      .catch(() => { if (active) { clearTimer(); setState('offline'); } })
      .finally(() => clearTimeout(deadline));
    return () => { active = false; clearTimer(); clearTimeout(deadline); controller.abort(); };
  }, [attempt]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active' && ['offline', 'online'].includes(stateRef.current)) retry();
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!size.width || !size.height) return;
    const target = focused ? { center: focused.coordinate, zoom: Math.max(7, Math.min(11, view.current.zoom)) } : fit;
    if (target) { view.current = target; camera.current?.easeTo({ ...target, bearing: 0, pitch: 0, duration: 550 }); }
  }, [fit, selected, focused?.coordinate[0], focused?.coordinate[1], fitRequest, local, attempt]);
  const status = basemapPresentation(state);
  return <View style={s.canvas} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    // Mount Camera with the measured trip fit, not a temporary world camera.
    // Native initial-region events otherwise race the first imperative fit.
    if (!initialized.current && width > 0 && height > 0) {
      view.current = fitTripCamera(cameraPoints, width, height) ?? tripMapCamera(model, width, height) ?? view.current;
      initialized.current = true;
    }
    setSize(old => old.width === width && old.height === height ? old : { width, height });
  }}>
    {state === 'unavailable' ? <View style={s.empty}><Text style={s.title}>Map unavailable</Text>
      <Text style={s.body}>Open Stops below to explore your local route.</Text></View> :
      size.width > 0 && size.height > 0 && <Map key={`${local ? 'local' : 'remote'}-${attempt}`} style={StyleSheet.absoluteFill}
        mapStyle={local ? offlineStyle : styleUrl!} dragPan touchZoom touchRotate doubleTapZoom touchPitch={false}
        logo={false} attribution attributionPosition={isMapTiler && !local ? { top: 8, right: 8 } : { bottom: 8, left: 8 }}
        onLongPress={event => longPress(event.nativeEvent.lngLat)}
        onDidFinishLoadingStyle={() => { styleReady.current = true; camera.current?.jumpTo(view.current); }}
        onDidFailLoadingMap={() => { clearTimer(); styleReady.current = false; setState(local ? 'unavailable' : 'offline'); }}
        onRegionWillChange={armTimer}
        onRegionDidChange={event => { view.current = { center: event.nativeEvent.center, zoom: event.nativeEvent.zoom }; }}
        onDidFinishRenderingFrameFully={() => {
          if (styleReady.current && !local && !['offline', 'unavailable'].includes(stateRef.current)) {
            if (timer.current) clearTimer();
            if (stateRef.current !== 'online') setState('online');
          }
        }}>
        <Camera ref={camera} initialViewState={view.current} />
        <Images images={markerImages} />
        <GeoJSONSource id="trip-sequence" data={approximate}>
          <Layer id="trip-sequence-casing" type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': '#fffdf7', 'line-opacity': 0.9, 'line-width': 7, 'line-dasharray': [2, 1.5] }} />
          <Layer id="trip-sequence-line" type="line" layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': mapPalette.route, 'line-width': 4, 'line-dasharray': [2, 1.5] }} />
        </GeoJSONSource>
        <GeoJSONSource id="trip-road-routes" data={roadData}>
          <Layer id="trip-road-casing" type="line" layout={{'line-cap':'round','line-join':'round'}}
            paint={{'line-color':'#fffdf7','line-width':8,'line-opacity':0.95}} />
          <Layer id="trip-road-line" type="line" layout={{'line-cap':'round','line-join':'round'}}
            paint={{'line-color':'#1769e0','line-width':5}} />
        </GeoJSONSource>
        <GeoJSONSource id="trip-road-preview" data={previewData}>
          <Layer id="trip-road-preview-casing" type="line" layout={{'line-cap':'round','line-join':'round'}}
            paint={{'line-color':'#fffdf7','line-width':8}} />
          <Layer id="trip-road-preview-line" type="line" layout={{'line-cap':'round','line-join':'round'}}
            paint={{'line-color':'#1769e0','line-width':5}} />
        </GeoJSONSource>
        <GeoJSONSource id="trip-stops" data={points} onPress={event => {
          const id = event.nativeEvent.features[0]?.properties?.stopId;
          if (typeof id === 'string') { event.stopPropagation(); select(id); }
        }}>
          <Layer id="trip-stops-halo" type="circle" filter={['==', ['get', 'selected'], true]}
            paint={{ 'circle-radius': ['+', ['get', 'radius'], 7], 'circle-color': '#b44d32', 'circle-opacity': 0.2 }} />
          <Layer id="trip-stops-body" type="circle" paint={{ 'circle-radius': ['get', 'radius'],
            'circle-color': ['get', 'color'], 'circle-stroke-color': '#fffdf7', 'circle-stroke-width': 3 }} />
          <Layer id="trip-stops-destination" type="circle" filter={['==', ['get', 'destination'], true]}
            paint={{ 'circle-radius': ['+', ['get', 'radius'], 4], 'circle-color': '#ffffff', 'circle-opacity': 0,
              'circle-stroke-color': mapPalette.destination, 'circle-stroke-width': 2 }} />
          {Array.from({ length: digits }, (_, index) => <Layer key={index} id={`trip-stop-digit-${index}`} type="symbol"
            filter={['has', `digit${index}`]} layout={{ 'icon-image': ['get', `digit${index}`], 'icon-size': 0.5,
              'icon-offset': ['get', `offset${index}`], 'icon-allow-overlap': true, 'icon-ignore-placement': true }} />)}
          <Layer id="trip-stop-stay" type="circle" filter={['==', ['get', 'stay'], true]}
            paint={{ 'circle-radius': 5, 'circle-color': '#e5b578', 'circle-stroke-color': '#fffdf7',
              'circle-stroke-width': 2, 'circle-translate': [0, 19], 'circle-translate-anchor': 'viewport' }} />
        </GeoJSONSource>
        {focused && <Marker id="selected-stop-label" lngLat={focused.coordinate} anchor="bottom" offset={[0, -31]}>
          <View pointerEvents="none" style={s.pinLabel}><Text numberOfLines={1} style={s.pinText}>{focused.stop.place.name}</Text></View>
        </Marker>}
        <PhotoMemoryMarkers pins={pins} select={selectPin} />
      </Map>}
    {state !== 'online' && <View style={s.mapStatus} pointerEvents="box-none">
      <View style={s.statusPill}><Text style={s.statusText} accessibilityLiveRegion="polite">{status.label}</Text></View>
      {(state === 'offline' || state === 'unavailable') && styleUrl ? <Button title="Retry basemap" onPress={retry} /> : null}
    </View>}
    {local && <View style={s.offlineNote} pointerEvents="none"><Text style={s.statusText}>Natural Earth · coarse overview, no road tiles</Text></View>}
    {isMapTiler && !local && state !== 'unavailable' && <View style={s.mapCredits}>
      <Pressable accessibilityRole="link" accessibilityLabel="MapTiler maps and copyright"
        onPress={() => { void Linking.openURL('https://www.maptiler.com/copyright/'); }}>
        <Image source={require('../../../assets/maps/maptiler-logo.svg')} style={{ width: 88, height: 24 }} contentFit="contain" />
        <Text style={s.creditText}>© MapTiler</Text>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap contributors and copyright"
        onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }}>
        <Text style={s.creditText}>© OpenStreetMap</Text><Text style={s.creditText}>contributors</Text>
      </Pressable>
    </View>}
  </View>;
}

export default function TripMapScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const result = useTripMap(tripId);
  const navigation = useNavigation();
  const model = useMemo(() => buildTripMap(tripId, result.data?.stops ?? []), [tripId, result.data]);
  const [selected, setSelected] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [showStops, setShowStops] = useState(false);
  const [height, setHeight] = useState(700);
  const { fontScale } = useWindowDimensions();
  const panelHeight = Math.min(height * (fontScale > 1.2 ? 0.19 : 0.3), 280);
  const [fitRequest, setFitRequest] = useState(0);
  const [showRoads, setShowRoads] = useState(false);
  const [previews, setPreviews] = useState<RoadProposal[]>([]);
  const [roadDirty, setRoadDirty] = useState(false);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [selectedPin, setSelectedPin] = useState<PhotoMemoryPin | null>(null);
  const segments = useMemo(() => roadSegments(tripId,result.data?.stops ?? []), [tripId,result.data?.stops]);
  const display = useMemo(() => roadDisplay(model, result.data?.roads ?? [], previews), [model, result.data?.roads, previews]);
  const roads = display.roads;
  const onPreview = useCallback((values: RoadProposal[]) => { setPreviews(values); }, []);
  const onDirty = useCallback((value: boolean) => setRoadDirty(value), []);
  usePreventRemove(roadDirty || !!pinDraft, ({ data }) => {
    Alert.alert('Discard unsaved map edits?', 'Saved routes and photo memories will stay unchanged.',
      [{text:'Keep reviewing',style:'cancel'},{text:'Discard and leave',style:'destructive',onPress:() => navigation.dispatch(data.action)}]);
  });
  const select = (id: string) => { setSelected(id); setExpanded(true); setShowStops(false); setShowRoads(false); };
  const fitTrip = () => { setSelected(undefined); setExpanded(false); setShowStops(false); setShowRoads(false); setFitRequest(v => v + 1); };
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showRoads) { setShowRoads(false); return true; }
      if (expanded) { setExpanded(false); setShowStops(false); return true; }
      return false;
    });
    return () => back.remove();
  }, [showRoads, expanded]));
  useEffect(() => { setSelected(undefined); setExpanded(false); setShowStops(false); setShowRoads(false); setPreviews([]); setRoadDirty(false); }, [tripId]);
  useEffect(() => { setPinDraft(null); setSelectedPin(null); }, [tripId]);
  const item = model.route.find(stop => stop.stop.id === selected);
  const summary = result.data && tripMapSummary(result.data.trip, model, result.data.photos);
  const detail = item && result.data ? selectedStopDetails(item, result.data.days, result.data.photos) : null;
  const overlaps = item?.coordinate ? model.mapped.filter(stop => stop.coordinate[0] === item.coordinate![0] && stop.coordinate[1] === item.coordinate![1]) : [];
  return <SafeAreaView style={s.page} edges={['top', 'bottom', 'left', 'right']}
    onLayout={event => setHeight(event.nativeEvent.layout.height)}>
    <StatusBar style="dark" />
    {result.error ? <View style={s.empty}><Button title="‹ Back to trip" onPress={() => router.back()} /><Problem error={result.error} retry={result.retry} /></View>
      : !summary || !result.data ? <View style={s.empty}><LoadingState label="Opening your local trip…" /></View> : <>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to trip" onPress={() => router.back()} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </Pressable>
          <View style={s.headingBlock}><Text style={s.eyebrow}>TRIP MAP</Text>
            <Text accessibilityRole="header" accessibilityLabel={summary.title} style={s.title} numberOfLines={1}>{summary.title}</Text>
            <Text style={s.routeSummary} numberOfLines={1}>{summary.route || 'A journey waiting for its first stop'}</Text>
          </View>
        </View>
        <View style={s.generate}>
          <Button title={showRoads ? 'Hide road review' : display.previews.length ? 'Review road preview' : 'Generate road route'} primary
            onPress={() => { setShowRoads(v => !v); setSelected(undefined); setExpanded(false); }} />
        </View>
        <View style={s.mapArea}>
          <MapBoundary key={tripId}><TripCanvas model={model} selected={selected} select={select} fitRequest={fitRequest} roads={roads} previews={display.previews} approximate={display.approximate}
            pins={result.data.pins} selectPin={pin => { if (!pinDraft?.moving) setSelectedPin(pin); }}
            longPress={point => { try { setPinDraft(longPressPin(point,pinDraft)); setSelectedPin(null); } catch { /* ignore invalid native coordinates */ } }} /></MapBoundary>
        </View>
        <View style={s.sheet}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded || showRoads }} accessibilityLabel={expanded || showRoads ? 'Collapse trip panel' : 'Expand trip panel'}
            onPress={() => { setShowRoads(false); setExpanded(showRoads ? false : !expanded); }} style={s.sheetHeading}>
            <View style={s.handle} />
            <Text style={s.sheetTitle} numberOfLines={1}>{showRoads ? 'Road review · not saved' : detail?.name ?? 'Stops & memories'}</Text>
            <Text style={s.muted}>{detail ? `${stopRole(item!, model.route.length)} ${detail.order} · ${detail.kind} · ${detail.photoCount} associated ${detail.photoCount === 1 ? 'photo' : 'photos'}`
              : `${summary.mappedLabel} · ${summary.photoLabel}`} {expanded || showRoads ? '⌄' : '⌃'}</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={s.actions} style={{ flexGrow: 0 }}>
            <Button title="Fit trip" onPress={fitTrip} />
            <Button title={showStops && expanded ? 'Hide stops' : 'Stops'} onPress={() => { setShowRoads(false); setShowStops(true); setExpanded(!(showStops && expanded)); }} />
            <PhotoMemoryEditor compact tripId={tripId} draft={pinDraft} setDraft={setPinDraft} selected={selectedPin} setSelected={setSelectedPin} pins={result.data.pins} />
          </ScrollView>
          {/* Panel visibility must not own the lifetime of temporary road proposals. */}
          <View style={{display:showRoads ? 'flex' : 'none',height:panelHeight}}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.panelContent}>
            <RoadRouteEditor key={JSON.stringify([tripId,segments])} tripId={tripId} segments={segments} saved={result.data.roads}
              labels={Object.fromEntries(model.route.map(item => [item.stop.id,`${item.order}. ${item.stop.place.name}`]))}
              onPreview={onPreview} onDirty={onDirty} />
          </ScrollView></View>
          {expanded && !showRoads && <View style={{ height: panelHeight }}>
            {showStops || !detail ? <FlatList data={model.route} keyExtractor={stop => stop.stop.id}
              contentContainerStyle={s.panelContent} ListEmptyComponent={<Text style={s.body}>Your map starts with a place. Use Edit stops to add a place; unknown dates and locations can stay unknown.</Text>}
              ListHeaderComponent={<><Text style={s.body}>{summary.title}</Text><Text style={s.muted}>{summary.route}</Text><Text style={s.muted}>{summary.chips.join(' · ')}</Text><Text style={s.muted}>Numbered stops · amber dots mark stays. Photo thumbnails are manually placed memories.</Text></>}
              ListFooterComponent={<View style={s.wrap}><Button title="Edit stops" onPress={() => router.push(`/trips/${tripId}/route`)} /><Button title="Timeline" onPress={() => router.push(`/trips/${tripId}/timeline`)} /><Button title="Trip photos" onPress={() => router.push(`/trips/${tripId}/photos`)} /></View>}
              renderItem={({ item: stop }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: stop.stop.id === selected }}
                accessibilityLabel={`Stop ${stop.order}: ${stop.stop.place.name}, ${stop.stop.kind}`}
                onPress={() => select(stop.stop.id)} style={s.stopRow}>
                <View style={[s.listNumber, { backgroundColor: stop.stop.id === selected ? mapPalette.selected : mapPalette.route }]}><Text style={s.numberText}>{stop.order}</Text></View>
                <View style={{ flex: 1 }}><Text style={s.stopName}>{stop.stop.place.name}</Text>
                  <Text style={s.muted}>{stop.stop.kind}{!stop.stop.visitConfirmed ? ' · Unconfirmed, not plotted' : !stop.coordinate ? ' · Location unknown, not plotted' : ''}</Text></View>
              </Pressable>} /> : <ScrollView contentContainerStyle={s.panelContent}>
                {detail.section && <Text style={s.sectionLabel}>{detail.section}</Text>}
                {detail.lodging && <Text style={s.lodging}>{detail.lodging}</Text>}
                {detail.dates && <Text style={s.body}>{detail.kind === 'stay' ? 'Stay / check-in: ' : ''}{detail.dates}</Text>}
                {detail.checkout && <Text style={s.body}>Check-out: {detail.checkout}</Text>}
                {detail.note && <Text style={s.body}>{detail.note}</Text>}
                {!item?.coordinate && <Text style={s.body}>{item?.stop.visitConfirmed ? 'Location unknown or not usable — not plotted.' : 'Visit unconfirmed — not plotted.'}</Text>}
                {overlaps.length > 1 && <><Text style={s.sectionLabel}>Visits at this location</Text>
                  <View style={s.wrap}>{overlaps.map(stop => <Button key={stop.stop.id} title={`${stop.order === detail.order ? '✓ ' : ''}Stop ${stop.order} · ${stop.stop.kind}`} onPress={() => select(stop.stop.id)} />)}</View></>}
                <Button title="Edit place" onPress={() => router.push({ pathname: '/trips/[tripId]/route', params: { tripId, editPlaceId: item!.stop.placeId } })} />
                <Button title="Trip photos" onPress={() => router.push(`/trips/${tripId}/photos`)} />
                <Button title="Timeline" onPress={() => router.push(`/trips/${tripId}/timeline`)} />
                <Text style={s.muted}>Photos opens this trip’s gallery. Photos without a stop remain part of the trip.</Text>
              </ScrollView>}
          </View>}
          <Text style={s.legend}>{display.covered ? `${display.previews.length} unsaved preview · ${roads.length} confirmed suggestion${roads.length === 1 ? '' : 's'} · historical road unverified` : STOPS_ONLY_LABEL}
            {display.approximate.features.length ? ' · Dashed = approximate' : ''}
            {model.unknownCount + model.unconfirmedCount > 0 ? ' · gaps preserved' : ''}</Text>
          {(roads.length > 0 || previews.length > 0) && <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://account.heigit.org/info/tos'); }}>
            <Text style={s.legend}>© openrouteservice by HeiGIT | Data from OpenStreetMap · CC-BY-SA 4.0</Text>
          </Pressable>}
        </View>
      </>}
  </SafeAreaView>;
}

const s = StyleSheet.create({
  generate: { paddingHorizontal: 16, paddingBottom: 4 },
  page: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', paddingRight: 18, paddingTop: 6, gap: 6, alignItems: 'center' },
  back: { width: 48, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 40, color: theme.colors.primary },
  headingBlock: { flex: 1, gap: 3 },
  eyebrow: { color: '#6c766f', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  title: { color: theme.colors.ink, fontSize: 22, fontWeight: '700' },
  routeSummary: { color: theme.colors.muted, fontSize: 13 },
  mapArea: { flex: 1, minHeight: 160 },
  canvas: { flex: 1, backgroundColor: '#e6eef3' },
  empty: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  body: { color: theme.colors.text, fontSize: 14, lineHeight: 21 },
  mapStatus: { position: 'absolute', top: 10, left: 12, right: 60, alignItems: 'flex-start', gap: 5 },
  statusPill: { backgroundColor: '#faf8f2ee', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { color: theme.colors.text, fontSize: 11, fontWeight: '600' },
  offlineNote: { position: 'absolute', bottom: 32, left: 12, backgroundColor: '#faf8f2ee', borderRadius: 6, padding: 5 },
  mapCredits: { position: 'absolute', bottom: 5, left: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffffffed', borderRadius: 4, padding: 4 },
  creditText: { color: theme.colors.text, fontSize: 9, lineHeight: 12 },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1, borderColor: theme.colors.border, elevation: 7 },
  sheetHeading: { minHeight: 64, paddingHorizontal: 18, paddingBottom: 8, gap: 4 },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: '#c9d2ca', alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  sheetTitle: { fontSize: 18, color: theme.colors.ink, fontWeight: '700' },
  muted: { fontSize: 14, color: theme.colors.muted, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 0, alignItems: 'center' },
  legend: { color: theme.colors.muted, fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },
  panelContent: { paddingHorizontal: 18, paddingVertical: 8, gap: 10 },
  stopRow: { flexDirection: 'row', minHeight: 56, alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: theme.colors.border, paddingBottom: 8 },
  stopName: { fontSize: 15, fontWeight: '600', color: theme.colors.ink },
  listNumber: { minWidth: 36, minHeight: 36, borderRadius: 16, paddingHorizontal: 7, justifyContent: 'center' },
  numberText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  sectionLabel: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  lodging: { color: '#855139', fontSize: 17, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pinLabel: { maxWidth: 220, backgroundColor: '#fffdf7', borderRadius: 8, padding: 7, elevation: 3 },
  pinText: { color: theme.colors.ink, fontSize: 13, fontWeight: '700' },
});
