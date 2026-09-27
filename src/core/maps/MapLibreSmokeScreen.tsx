import { Map, type StyleSpecification } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Synthetic geometry only: no travel history or network-dependent resources.
// Replace this disposable renderer check before implementing product maps.
const smokeStyle: StyleSpecification = {
  version: 8,
  sources: {
    fixture: {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[-30, -20], [30, -20], [0, 30], [-30, -20]]],
        },
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#e6eef3' } },
    { id: 'fixture-fill', type: 'fill', source: 'fixture', paint: { 'fill-color': '#d68b32' } },
    {
      id: 'fixture-outline', type: 'line', source: 'fixture',
      paint: { 'line-color': '#714613', 'line-width': 3 },
    },
  ],
};

export default function MapLibreSmokeScreen() {
  const [status, setStatus] = useState('Waiting for native map rendering…');

  return (
    <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
      <Text style={styles.note}>Offline renderer test: synthetic triangle, not a real place. Pan and zoom to test.</Text>
      <Text style={styles.note} accessibilityLiveRegion="polite">{status}</Text>
      <Map
        style={styles.map}
        mapStyle={smokeStyle}
        onDidFinishRenderingMapFully={() => setStatus('MapLibre: native map fully rendered.')}
        onDidFailLoadingMap={() => setStatus('MapLibre failed to load the local smoke-test style.')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  note: { paddingHorizontal: 16, paddingVertical: 8 },
  map: { flex: 1 },
});
