import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { AppState, BackHandler, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VaultDatabase } from '../../core/database/open';
import { offlineStyle } from '../../core/maps/offline-style';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';
import { Action, LoadingState, Problem, styles } from '../trips/ui';
import { fitTripCamera } from './model';
import type { GlobalMapPlace } from './repository';
import { theme } from '../../shared/ui/theme';
import { lifetimePlaces, type LifetimePlace } from './lifetime-map';
import { basemapPresentation, resolveMapStyleUrl, type BasemapState } from './trip-map-v2';

const styleUrl = resolveMapStyleUrl(process.env.EXPO_PUBLIC_MAP_STYLE_URL);
const isMapTiler = styleUrl !== null && new URL(styleUrl).hostname === 'api.maptiler.com';

class GlobalMapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <View style={local.message}><Text style={styles.text}>Map unavailable. Your places remain in the list below.</Text>
    <Action secondary title="Retry map" onPress={() => this.setState({ failed: false })} /></View> : this.props.children; }
}

function ArchiveMap({ places, selectedId, select, fitRequest }: {
  places: LifetimePlace[]; selectedId?: string; select: (id: string) => void; fitRequest: number;
}) {
  const [state, setState] = useState<BasemapState>(styleUrl ? 'loading' : 'unconfigured');
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const camera = useRef<CameraRef>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);
  const initialized = useRef(false);
  const stateRef = useRef(state); stateRef.current = state;
  const view = useRef({ center: [0, 20] as [number, number], zoom: 1 });
  const mapped = useMemo(() => places.filter(place => place.coordinate), [places]);
  const localMap = state === 'offline' || state === 'unconfigured';
  const retry = () => { ready.current = false; setState('loading'); setAttempt(value => value + 1); };
  const armTimer = () => {
    clearTimeout(timer.current);
    if (styleUrl && ['loading', 'online'].includes(stateRef.current)) timer.current = setTimeout(() => { ready.current = false; setState('offline'); }, 12000);
  };
  useEffect(() => {
    armTimer(); const controller = new AbortController(); let active = true;
    const deadline = setTimeout(() => controller.abort(), 8000);
    if (styleUrl) void fetch(styleUrl, { signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'com.tripmemoryvault.app/basemap-probe' } })
      .then(response => { if (!response.ok) throw new Error('Basemap unavailable'); })
      .catch(() => { if (active) { clearTimeout(timer.current); setState('offline'); } })
      .finally(() => clearTimeout(deadline));
    return () => { active = false; controller.abort(); clearTimeout(deadline); clearTimeout(timer.current); };
  }, [attempt]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active' && styleUrl && ['offline', 'online'].includes(stateRef.current)) retry();
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!size.width || !size.height) return;
    const selected = mapped.find(place => place.id === selectedId);
    view.current = selected ? { center: selected.coordinate!, zoom: 9 }
      : fitTripCamera(mapped.map(place => place.coordinate!), size.width, size.height) ?? { center: [0, 20], zoom: 1 };
    camera.current?.easeTo({ ...view.current, bearing: 0, pitch: 0, duration: 550 });
  }, [mapped, selectedId, size, fitRequest, localMap, attempt]);
  return <View style={local.canvas} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (!initialized.current && width > 0 && height > 0) {
      view.current = fitTripCamera(mapped.map(place => place.coordinate!), width, height) ?? view.current;
      initialized.current = true;
    }
    setSize(old => old.width === width && old.height === height ? old : { width, height });
  }}>
    {state === 'unavailable' ? <View style={local.message}><Text style={styles.text}>Map unavailable. Explore the place list below.</Text></View>
      : size.width > 0 && size.height > 0 && <Map key={`${localMap}-${attempt}`} style={StyleSheet.absoluteFill}
        mapStyle={localMap ? offlineStyle : styleUrl!} logo={false} attribution attributionPosition={{ top: 8, right: 8 }}
        dragPan touchZoom touchRotate doubleTapZoom touchPitch={false}
        onDidFinishLoadingStyle={() => { ready.current = true; camera.current?.jumpTo(view.current); }}
        onDidFailLoadingMap={() => { clearTimeout(timer.current); ready.current = false; setState(localMap ? 'unavailable' : 'offline'); }}
        onRegionWillChange={armTimer}
        onRegionDidChange={event => { view.current = { center: event.nativeEvent.center, zoom: event.nativeEvent.zoom }; }}
        onDidFinishRenderingFrameFully={() => {
          if (ready.current && !localMap && ['loading', 'online'].includes(stateRef.current)) { clearTimeout(timer.current); setState('online'); }
        }}>
        <Camera ref={camera} initialViewState={view.current} />
        {mapped.map(place => <Marker key={place.id} id={place.id} lngLat={place.coordinate!}
          onPress={event => { event.stopPropagation(); select(place.id); }}
          accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.layer === 'been' ? 'confirmed visit' : 'Dreaming'}`}>
          <View pointerEvents="none" style={[local.marker, place.layer === 'dreaming' && local.dreamMarker, selectedId === place.id && local.selectedMarker]}>
            <Text style={[local.markerText, place.layer === 'dreaming' && { color: theme.colors.primary }]}>{place.layer === 'dreaming' ? '☆' : place.visit!.visitCount}</Text>
          </View>
        </Marker>)}
      </Map>}
    {state !== 'online' && <View pointerEvents="box-none" style={local.mapStatus}>
      <Text accessibilityLiveRegion="polite" style={local.status}>{basemapPresentation(state).label}</Text>
      {styleUrl && ['offline', 'unavailable'].includes(state) && <Action secondary title="Retry basemap" onPress={retry} />}
    </View>}
    <View style={local.credits}>
      {isMapTiler && !localMap && state !== 'unavailable' ? <>
        <Pressable accessibilityRole="link" accessibilityLabel="MapTiler maps and copyright" onPress={() => { void Linking.openURL('https://www.maptiler.com/copyright/'); }}>
          <Image source={require('../../../assets/maps/maptiler-logo.svg')} style={{ width: 88, height: 24 }} contentFit="contain" />
          <Text style={local.credit}>© MapTiler</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }}><Text style={local.credit}>© OpenStreetMap contributors</Text></Pressable>
      </> : localMap ? <Text style={local.credit}>Natural Earth · overview only, no offline streets</Text> : null}
    </View>
  </View>;
}

function plural(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function PlaceDetails({ place }: { place: GlobalMapPlace }) {
  return <View style={{ gap: 8 }}>
    <Text style={styles.text}>{plural(place.visitCount, 'visit')} · {plural(place.tripCount, 'Trip')}</Text>
    <Text style={styles.text}>First known visit: {place.firstKnownVisit ?? 'Date unknown'}</Text>
    <Text style={styles.text}>Most recent known visit: {place.mostRecentKnownVisit ?? 'Date unknown'}</Text>
    <Text style={local.subheading}>Confirmed visit history</Text>
    {place.visits.map(visit => <View key={visit.stopId} style={local.visit}>
      <Text style={local.visitTitle}>{visit.tripTitle}</Text>
      <Text style={styles.text}>{visit.kind} · {visit.dateLabel}</Text>
      {visit.timelineSectionLabel ? <Text style={styles.text}>Section: {visit.timelineSectionLabel}</Text> : null}
      <Action secondary title={`Open ${visit.tripTitle}`} onPress={() => router.push(`/trips/${visit.tripId}`)} />
    </View>)}
  </View>;
}

export default function GlobalMapScreen() {
  const query = useCallback(async (vault: VaultDatabase) => {
    const archive = await vault.map.archive(); const dreams = await vault.dreams.listActive();
    return { archive, places: lifetimePlaces(archive, dreams) };
  }, []);
  const result = useOrganizationQuery(query);
  const [been, setBeen] = useState(true), [dreaming, setDreaming] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [fitRequest, setFitRequest] = useState(0);
  const { height } = useWindowDimensions();
  const places = useMemo(() => result.data?.places.filter(place => place.layer === 'been' ? been : dreaming) ?? [], [result.data, been, dreaming]);
  const selected = places.find(place => place.id === selectedId);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selectedId) return false;
      setSelectedId(undefined); return true;
    });
    return () => back.remove();
  }, [selectedId]));
  const counts = { been: result.data?.archive.totalPlaceCount ?? 0, dreaming: result.data?.places.filter(p => p.layer === 'dreaming').length ?? 0 };
  return <SafeAreaView style={styles.page} edges={['left', 'right']}>
    <View style={local.header}>
      <Text accessibilityRole="header" style={local.heading}>Your lifetime map</Text>
      <Text style={local.hint}>Confirmed visits & future wishes</Text>
      <View style={local.controls}>
        {(['been', 'dreaming'] as const).map(layer => {
          const active = layer === 'been' ? been : dreaming;
          return <Pressable key={layer} accessibilityRole="checkbox" accessibilityState={{ checked: active }}
            accessibilityLabel={`${layer === 'been' ? 'Been' : 'Dreaming'} layer, ${counts[layer]} places`}
            onPress={() => { setSelectedId(undefined); layer === 'been' ? setBeen(!been) : setDreaming(!dreaming); }}
            style={({ pressed }) => [local.layer, active && local.activeLayer, pressed && { opacity: 0.7 }]}>
            <Text style={[local.layerText, active && { color: theme.colors.surface }]}>{layer === 'been' ? '● Been' : '☆ Dreaming'} · {counts[layer]}</Text>
          </Pressable>;
        })}
      </View>
    </View>
    {result.error ? <View style={local.message}><Problem error={result.error} retry={result.retry} /></View>
      : !result.data ? <View style={local.message}><LoadingState label="Opening your local places…" /></View> : <>
        <View style={{ flex: 1, minHeight: 140 }}><GlobalMapBoundary><ArchiveMap places={places} selectedId={selectedId} select={setSelectedId} fitRequest={fitRequest} /></GlobalMapBoundary></View>
        <View style={local.panel}>
          <View style={local.panelHeader}>
            <Text accessibilityRole="header" style={[local.placeName, { flex: 1 }]}>{selected?.name ?? `${plural(places.filter(p => p.coordinate).length, 'mapped place')}`}</Text>
            <Action secondary title={selected ? 'All places' : 'Fit places'} onPress={() => { setSelectedId(undefined); setFitRequest(v => v + 1); }} />
          </View>
          <View style={{ maxHeight: height * 0.22 }}>
            {selected ? <ScrollView contentContainerStyle={local.panelContent}>
              {!selected.coordinate && <Text style={styles.text}>Location unknown · not plotted</Text>}
              {selected.visit ? <PlaceDetails place={selected.visit} /> : <>
                <Text style={styles.text}>Dreaming · not a confirmed visit</Text>
                {selected.dream?.note && <Text style={styles.text}>{selected.dream.note}</Text>}
                <Action title="Open Dream Place" onPress={() => router.push(`/dreams/${selected.dream!.id}`)} />
              </>}
            </ScrollView> : <FlatList data={places} keyExtractor={place => place.id} contentContainerStyle={local.panelContent}
              ListHeaderComponent={places.length ? <Text style={local.hint}>Select a marker or a place below.</Text> : null}
              ListEmptyComponent={<View style={{ gap: 8 }}>
                <Text style={local.placeName}>{!been && !dreaming ? 'Choose a layer to explore' : 'Your places will appear here'}</Text>
                <Text style={styles.text}>{!been && !dreaming ? 'Turn on Been or Dreaming above.' : 'Been shows confirmed visits and stays in saved trips. Dreaming shows unfulfilled Dream Places.'}</Text>
                {(been || dreaming) && <Action secondary title={dreaming ? 'Explore Dream Places' : 'Explore your trips'} onPress={() => router.push(dreaming ? '/dreams' : '/')} />}
              </View>}
              renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => setSelectedId(item.id)}
                style={({ pressed }) => [local.placeRow, pressed && { backgroundColor: theme.colors.selected }]}>
                <Text style={local.placeName}>{item.layer === 'dreaming' ? '☆ ' : '● '}{item.name}</Text>
                <Text style={local.hint}>{item.visit ? `${plural(item.visit.visitCount, 'visit')} · ${plural(item.visit.tripCount, 'trip')}` : 'Dreaming · not visited'}{!item.coordinate ? ' · Location unknown' : ''}</Text>
              </Pressable>} />}
          </View>
        </View>
      </>}
  </SafeAreaView>;
}

const local = StyleSheet.create({
  heading: { color: theme.colors.ink, fontSize: 22, fontWeight: '700' },
  header: { paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  layer: { minHeight: 48, padding: 12, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.colors.border, justifyContent: 'center' },
  activeLayer: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  layerText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  canvas: { flex: 1, backgroundColor: theme.colors.selected },
  message: { flex: 1, padding: 20, justifyContent: 'center' },
  marker: { minWidth: 48, minHeight: 48, padding: 8, borderRadius: 24, borderWidth: 3, borderColor: theme.colors.surface, backgroundColor: theme.colors.primary, justifyContent: 'center' },
  dreamMarker: { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary },
  selectedMarker: { borderWidth: 5, borderColor: '#b44d32', transform: [{ scale: 1.12 }] },
  markerText: { color: theme.colors.surface, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  mapStatus: { position: 'absolute', top: 8, left: 8, right: 56, alignItems: 'flex-start' },
  status: { color: theme.colors.text, fontSize: 12, backgroundColor: '#ffffffee', padding: 8, borderRadius: 8 },
  credits: { position: 'absolute', bottom: 6, left: 8, right: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  credit: { color: theme.colors.text, fontSize: 10, backgroundColor: '#ffffffee', padding: 2 },
  panel: { backgroundColor: theme.colors.surface, borderTopWidth: 1, borderColor: theme.colors.border },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 4 },
  panelContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  placeRow: { minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, gap: 4 },
  placeName: { color: theme.colors.ink, fontSize: 17, fontWeight: '600' },
  hint: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 },
  subheading: { color: theme.colors.ink, fontSize: 17, fontWeight: '600' },
  visitTitle: { color: theme.colors.ink, fontSize: 16, fontWeight: '600' },
  visit: { paddingVertical: 8, borderTopWidth: 1, borderColor: theme.colors.border, gap: 4 },
});
