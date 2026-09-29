import { Component, useMemo, useRef, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { offlineStyle } from '../../core/maps/offline-style';
import { useTimeline } from '../timeline/useTimeline';
import { sectionTitle } from '../timeline/presentation';
import { dateLabel } from '../trips/presentation';
import { Action, Problem, styles } from '../trips/ui';
import { buildTripMap, fitTripCamera, type MapStop } from './model';

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Text>Map unavailable. Your complete route is below.</Text> : this.props.children; }
}

function GeometryMap({ model, select, selected }: {
  model: ReturnType<typeof buildTripMap>; select: (id: string) => void; selected?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(320);
  const camera = useMemo(() => fitTripCamera(model.mapped.map(s => s.coordinate), width, 300), [model, width]);
  if (failed) return <Text>Map unavailable. Your complete route is below.</Text>;
  if (!camera) return <Text style={styles.section}>No mapped stops yet.</Text>;
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Map style={{ height: 300 }} mapStyle={offlineStyle} onDidFailLoadingMap={() => setFailed(true)}
      onDidFinishRenderingMapFully={() => setReady(true)}>
      <Camera {...camera} />
      <GeoJSONSource id="trip-sequence" data={model.lines}>
        <Layer id="trip-sequence-line" type="line" paint={{ 'line-color': '#506880', 'line-width': 2, 'line-dasharray': [3, 3] }} />
      </GeoJSONSource>
      {model.mapped.map(item => <Marker key={item.stop.id} id={item.stop.id} lngLat={item.coordinate}
        onPress={() => select(item.stop.id)}>
        <View accessible accessibilityRole="button" accessibilityLabel={`Stop ${item.order}: ${item.stop.place.name}`}
          style={{ minWidth: 36, minHeight: 36, padding: 7, borderRadius: 18, borderWidth: 2, borderColor: '#fff',
            backgroundColor: selected === item.stop.id ? '#935000' : '#183e63' }}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>{model.mapped
            .filter(s => s.coordinate[0] === item.coordinate[0] && s.coordinate[1] === item.coordinate[1])
            .map(s => s.order).join(' · ')}</Text>
        </View>
      </Marker>)}
    </Map>
    <Text>{ready ? 'Local map ready' : 'Loading local map…'}</Text>
  </View>;
}

export default function TripMapScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const result = useTimeline(tripId);
  const model = useMemo(() => buildTripMap(tripId, result.data?.stops ?? []), [tripId, result.data]);
  const [selected, setSelected] = useState<string>();
  const list = useRef<FlatList<MapStop>>(null);
  const selectionOffset = useRef(0);
  const select = (id: string) => {
    setSelected(id);
    list.current?.scrollToOffset({ offset: selectionOffset.current, animated: true });
  };
  const item = model.route.find(s => s.stop.id === selected);
  // Co-located occurrences share a pin position, but every Stop remains selectable.
  const overlaps = item?.coordinate ? model.mapped.filter(s => s.coordinate[0] === item.coordinate![0]
    && s.coordinate[1] === item.coordinate![1]) : [];
  const day = result.data?.days.find(d => d.id === item?.stop.dayId);
  return <FlatList ref={list} style={styles.page} contentContainerStyle={styles.content}
    data={result.error ? [] : model.route} keyExtractor={s => s.stop.id}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      <Text style={styles.heading}>Trip Map</Text>
      {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Loading local route…</Text> : <>
        <Text>Offline overview · Natural Earth. No detailed road tiles.</Text>
        <MapBoundary key={tripId}><GeometryMap model={model} selected={selected} select={select} /></MapBoundary>
        <Text>Dashed lines show trip sequence only, not the road or path travelled. Gaps remain around unknown or unconfirmed stops.</Text>
        {model.lines.features.length > 0 && <Text>Shown sequence links: {model.lines.features.map(f =>
          `${model.route.find(s => s.stop.id === f.properties.fromStopId)!.order} → ${model.route.find(s => s.stop.id === f.properties.toStopId)!.order}`).join(' · ')}</Text>}
        {model.datelineGaps > 0 && <Text>Lines also break at the antimeridian.</Text>}
        {model.unknownCount > 0 && <Text>{model.unknownCount} {model.unknownCount === 1 ? 'stop is' : 'stops are'} not shown on the map: location unknown or not usable. No zero-coordinate placeholders are plotted.</Text>}
        {model.unconfirmedCount > 0 && <Text>{model.unconfirmedCount} unconfirmed stops remain in the list only.</Text>}
        <Text>Repeated visits keep separate stop numbers. Pins at identical coordinates overlap; select each visit below.</Text>
        {item && <View style={styles.card} onLayout={event => {
          selectionOffset.current = event.nativeEvent.layout.y;
          list.current?.scrollToOffset({ offset: selectionOffset.current, animated: true });
        }}>
          <Text style={styles.section}>Selected: {item.order}. {item.stop.place.name}</Text>
          <Text>{item.stop.kind}</Text>
          {item.stop.dates && <Text>{dateLabel(item.stop.dates)}</Text>}
          {item.stop.note && <Text>{item.stop.note}</Text>}
          {day && <Text>Section: {sectionTitle(day)}</Text>}
          {overlaps.length > 1 && <><Text>Visits at this location:</Text>{overlaps.map(s =>
            <Action key={s.stop.id} title={`Select stop ${s.order}: ${s.stop.place.name}`} onPress={() => select(s.stop.id)} />)}</>}
          <Action title={`Edit place ${item.stop.place.name}`} onPress={() => router.push({ pathname: '/trips/[tripId]/route', params: { tripId, editPlaceId: item.stop.placeId } })} />
        </View>}
        <Text style={styles.section}>Route · {model.route.length} {model.route.length === 1 ? 'stop' : 'stops'}</Text>
        {!model.route.length && <Text>No stops added yet.</Text>}
      </>}
    </View>}
    renderItem={({ item: s }) => <View style={styles.card}>
      <Action title={`${s.order}. ${s.stop.place.name} · ${s.stop.kind}`} onPress={() => select(s.stop.id)} />
      <Text>{!s.stop.visitConfirmed ? 'Visit unconfirmed — not plotted' : s.coordinate ? `${s.coordinate[1]}, ${s.coordinate[0]}` : 'Location unknown or not usable — not plotted'}</Text>
      {s.stop.dates && <Text>{dateLabel(s.stop.dates)}</Text>}
      <Action title={`Edit coordinates for stop ${s.order}`} onPress={() => router.push({ pathname: '/trips/[tripId]/route', params: { tripId, editPlaceId: s.stop.placeId } })} />
    </View>} />;
}
