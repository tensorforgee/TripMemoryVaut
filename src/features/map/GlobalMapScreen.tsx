import { Component, useCallback, useMemo, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VaultDatabase } from '../../core/database/open';
import { offlineStyle } from '../../core/maps/offline-style';
import { useOrganizationQuery } from '../organization/useOrganizationQuery';
import { Action, Problem, styles } from '../trips/ui';
import { fitTripCamera } from './model';
import type { GlobalMapArchive, GlobalMapPlace } from './repository';

class GlobalMapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Text>Map unavailable. Your visited Places and visit history remain available below.</Text> : this.props.children; }
}

function ArchiveMap({ archive, selectedId, select }: {
  archive: GlobalMapArchive; selectedId?: string; select: (placeId: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(320);
  const camera = useMemo(() => fitTripCamera(archive.mappedPlaces.flatMap(place => place.coordinate ? [place.coordinate] : []), width, 320), [archive, width]);
  if (!camera) return <View style={local.emptyMap}><Text style={styles.section}>No mapped places yet</Text>
    <Text style={styles.text}>Confirmed visited Places will appear when their canonical Place has coordinates.</Text></View>;
  if (failed) return <Text>Map unavailable. Your visited Places and visit history remain available below.</Text>;
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Map style={{ height: 320 }} mapStyle={offlineStyle} onDidFailLoadingMap={() => setFailed(true)}
      onDidFinishRenderingMapFully={() => setReady(true)}>
      <Camera {...camera} />
      {archive.mappedPlaces.map(place => <Marker key={place.id} id={place.id} lngLat={place.coordinate!} onPress={() => select(place.id)}>
        <View accessible accessibilityRole="button"
          accessibilityLabel={`${place.name}: ${place.visitCount} ${place.visitCount === 1 ? 'visit' : 'visits'} across ${place.tripCount} ${place.tripCount === 1 ? 'Trip' : 'Trips'}`}
          style={[local.marker, selectedId === place.id && local.selectedMarker]}>
          <Text style={local.markerText}>{place.visitCount}</Text>
        </View>
      </Marker>)}
    </Map>
    <Text style={local.mapStatus}>{ready ? 'Local archive map ready' : 'Loading local archive map…'}</Text>
  </View>;
}

function plural(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function PlaceDetails({ place }: { place: GlobalMapPlace }) {
  return <View style={styles.card}>
    <Text style={styles.section}>{place.name}</Text>
    <Text style={styles.text}>{plural(place.visitCount, 'visit')} · {plural(place.tripCount, 'Trip')}</Text>
    <Text style={styles.text}>First known visit: {place.firstKnownVisit ?? 'Date unknown'}</Text>
    <Text style={styles.text}>Most recent known visit: {place.mostRecentKnownVisit ?? 'Date unknown'}</Text>
    <Text style={local.subheading}>Associated Trips</Text>
    {place.trips.map(trip => <Action key={trip.id} title={trip.title} onPress={() => router.push(`/trips/${trip.id}`)} />)}
    <Text style={local.subheading}>Confirmed visit history</Text>
    {place.visits.map(visit => <View key={visit.stopId} style={local.visit}>
      <Text style={local.visitTitle}>{visit.tripTitle}</Text>
      <Text style={styles.text}>{visit.kind} · {visit.dateLabel}</Text>
      {visit.timelineSectionLabel ? <Text style={styles.text}>Section: {visit.timelineSectionLabel}</Text> : null}
      <Action title={`Open ${visit.tripTitle}`} onPress={() => router.push(`/trips/${visit.tripId}`)} />
    </View>)}
  </View>;
}

export default function GlobalMapScreen() {
  const query = useCallback((vault: VaultDatabase) => vault.map.archive(), []);
  const result = useOrganizationQuery(query);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = result.data?.places.find(place => place.id === selectedId);
  const sections = result.data ? [
    ...(result.data.mappedPlaces.length ? [{ title: 'Mapped Places', data: result.data.mappedPlaces }] : []),
    ...(result.data.unmappedPlaces.length ? [{ title: 'Places without coordinates', data: result.data.unmappedPlaces }] : []),
  ] : [];
  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <SectionList sections={sections} keyExtractor={place => place.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={{ gap: 12 }}>
        <Text style={styles.heading}>My Map</Text>
        <Text style={styles.text}>Your confirmed visited geography across active saved Trips. Dreams, drafts, transit Stops and Trash are not plotted.</Text>
        {result.error ? <Problem error={result.error} retry={result.retry} /> : !result.data ? <Text>Reading your local archive…</Text> : <>
          <Text style={local.summary}>{plural(result.data.mappedPlaceCount, 'mapped place')} · {plural(result.data.unmappedPlaceCount, 'place')} without coordinates</Text>
          {result.data.unmappedPlaceCount > 0 ? <Text style={styles.text}>{plural(result.data.unmappedPlaceCount, 'visited place')} {result.data.unmappedPlaceCount === 1 ? 'is' : 'are'} not shown because {result.data.unmappedPlaceCount === 1 ? 'its location is' : 'their locations are'} unknown.</Text> : null}
          <Text style={styles.text}>Offline overview · Natural Earth. Markers and archive details are local; no detailed road tiles.</Text>
          <GlobalMapBoundary><ArchiveMap archive={result.data} selectedId={selectedId} select={setSelectedId} /></GlobalMapBoundary>
          {selected ? <PlaceDetails place={selected} /> : result.data.mappedPlaceCount > 0 ? <Text style={styles.text}>Select a marker or Place below to view its confirmed visits.</Text> : null}
          {result.data.totalPlaceCount === 0 ? <View style={styles.card}><Text style={styles.section}>No mapped places yet</Text>
            <Text style={styles.text}>Save a Trip with a confirmed visit or stay to begin your personal map. Places without coordinates will remain visible here.</Text></View> : null}
        </>}
      </View>}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => <View style={styles.card}>
        <Action title={item.name} onPress={() => setSelectedId(item.id)} />
        <Text style={styles.text}>{plural(item.visitCount, 'visit')} · {plural(item.tripCount, 'Trip')} · {item.coordinate ? 'Mapped' : 'Location unknown'}</Text>
      </View>} />
  </SafeAreaView>;
}

const local = StyleSheet.create({
  summary: { color: '#17283b', fontSize: 19, fontWeight: '700' },
  emptyMap: { minHeight: 180, padding: 18, borderRadius: 10, backgroundColor: '#e6eef3', justifyContent: 'center' },
  marker: { minWidth: 38, minHeight: 38, padding: 8, borderRadius: 19, borderWidth: 2, borderColor: '#fff', backgroundColor: '#183e63', justifyContent: 'center' },
  selectedMarker: { backgroundColor: '#935000' },
  markerText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  mapStatus: { color: '#52657a', paddingTop: 6 },
  subheading: { color: '#17283b', fontSize: 17, fontWeight: '700', paddingTop: 8 },
  visit: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#dce2e8', gap: 4 },
  visitTitle: { color: '#17283b', fontSize: 16, fontWeight: '600' },
});
