import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import land from '../../../assets/maps/land.json';

// All resources are bundled; no tiles, remote fonts, sprites or provider keys.
export const offlineStyle: StyleSpecification = {
  version: 8,
  sources: { land: { type: 'geojson', data: land as unknown as GeoJSON.FeatureCollection } },
  layers: [
    { id: 'water', type: 'background', paint: { 'background-color': '#e6eef3' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#edf0e4' } },
    { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#a5b5ae', 'line-width': 1 } },
  ],
};
