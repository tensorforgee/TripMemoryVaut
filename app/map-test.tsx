import MapLibreSmokeScreen from '../src/core/maps/MapLibreSmokeScreen';

export default function MapTest() {
  return __DEV__ ? <MapLibreSmokeScreen /> : null;
}
