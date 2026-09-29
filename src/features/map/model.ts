import type { RouteStop } from '../route/repository';

export type Coordinate = [number, number]; // longitude, latitude
export type MapStop = { stop: RouteStop; order: number; coordinate: Coordinate | null };
type SequenceLine = { type: 'Feature'; id: string;
  properties: { fromStopId: string; toStopId: string; kind: 'trip_sequence' };
  geometry: { type: 'LineString'; coordinates: Coordinate[] } };

export function confirmedCoordinate(stop: RouteStop): Coordinate | null {
  const { latitude: lat, longitude: lon } = stop.place;
  if (!stop.visitConfirmed || typeof lat !== 'number' || typeof lon !== 'number'
    || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180
    || (lat === 0 && lon === 0)) return null;
  return [lon, lat];
}

// Only the canonical repository supplies this view. Suggestions are never inputs.
export function buildTripMap(tripId: string, stops: readonly RouteStop[]) {
  const route: MapStop[] = stops.filter(s => s.tripId === tripId && s.deletedAt === null
    && s.place.deletedAt === null && s.placeId === s.place.id && s.vaultId === s.place.vaultId)
    .slice().sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((stop, index) => ({ stop, order: index + 1, coordinate: confirmedCoordinate(stop) }));
  const mapped = route.filter((s): s is MapStop & { coordinate: Coordinate } => s.coordinate !== null);
  const features: SequenceLine[] = [];
  let datelineGaps = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    if (!a.coordinate || !b.coordinate) continue;
    // Avoid a misleading line across the entire world. Do not invent intermediate points.
    if (Math.abs(a.coordinate[0] - b.coordinate[0]) > 180) { datelineGaps++; continue; }
    if (a.coordinate[0] === b.coordinate[0] && a.coordinate[1] === b.coordinate[1]) continue;
    features.push({ type: 'Feature', id: `${a.stop.id}:${b.stop.id}`,
      properties: { fromStopId: a.stop.id, toStopId: b.stop.id, kind: 'trip_sequence' },
      geometry: { type: 'LineString', coordinates: [a.coordinate, b.coordinate] } });
  }
  return { route, mapped, datelineGaps,
    unknownCount: route.filter(s => s.stop.visitConfirmed && s.coordinate === null).length,
    unconfirmedCount: route.filter(s => !s.stop.visitConfirmed).length,
    lines: { type: 'FeatureCollection' as const, features } };
}

const mercatorY = (lat: number) => {
  const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2;
};

// Fit actual viewport dimensions. Circular longitude bounds handle the antimeridian.
// Camera projection limits never modify archived coordinates or marker geometry.
export function fitTripCamera(points: readonly Coordinate[], width = 320, height = 300): { center: Coordinate; zoom: number } | null {
  if (!points.length) return null;
  const longitudes = points.map(p => (p[0] + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
    if (next - longitudes[i] > gap) { gap = next - longitudes[i]; start = next % 360; }
  }
  const span = 360 - gap;
  const ys = points.map(p => mercatorY(p[1]));
  const north = Math.min(...ys), south = Math.max(...ys);
  const center: Coordinate = [((start + span / 2 + 180) % 360) - 180,
    Math.atan(Math.sinh(Math.PI * (1 - 2 * (north + south) / 2))) * 180 / Math.PI];
  const zoom = Math.min(11,
    span === 0 ? 11 : Math.log2(Math.max(1, width - 96) / (512 * span / 360)),
    south === north ? 11 : Math.log2(Math.max(1, height - 96) / (512 * (south - north))));
  return { center, zoom: Math.max(0, zoom) };
}
