import { buildTripMap, type Coordinate } from '../map/model';
import type { RouteStop } from '../route/repository';
import { keys, record, utcTimestamp, uuid } from '../../domain/validation';

export const STOPS_ONLY_LABEL = 'Stops only — exact road unknown';
export const MAX_VERTICES = 100_000;
export const MAX_VIA_POINTS = 20;
export type SegmentInput = { fromStopId: string; toStopId: string; from: Coordinate; to: Coordinate };
export type ViaPoint = { id: string; coordinate: Coordinate };
export type RoadGeometry = { type: 'LineString'; coordinates: Coordinate[] };
export type RouteProvenance = {
  version: 1; source: 'generated'; provider: 'openrouteservice'; profile: 'driving-car';
  generatedAt: string; engineVersion: string | null; graphDate: string | null;
  attribution: string; license: string;
};
export type RoadProposal = { input: SegmentInput; viaPoints: ViaPoint[]; geometry: RoadGeometry;
  provenance: RouteProvenance; distanceMeters: number | null };
export type SavedRoadRoute = RoadProposal & { id: string; tripId: string; confirmedAt: string; updatedAt: string; stale: boolean };

export function coordinate(value: unknown): Coordinate {
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v))
    || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error('Invalid route coordinate; expected longitude, latitude.');
  return [value[0], value[1]];
}
export const sameCoordinate = (a: Coordinate, b: Coordinate) => a[0] === b[0] && a[1] === b[1];
export const segmentKey = (input: SegmentInput) => `${input.fromStopId}:${input.toStopId}`;
export const sameInput = (a: SegmentInput, b: SegmentInput) => segmentKey(a) === segmentKey(b)
  && sameCoordinate(a.from, b.from) && sameCoordinate(a.to, b.to);

export function roadSegments(tripId: string, stops: readonly RouteStop[]): SegmentInput[] {
  const { route } = buildTripMap(tripId, stops);
  const result: SegmentInput[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    if (a.coordinate && b.coordinate) result.push({ fromStopId: a.stop.id, toStopId: b.stop.id, from: a.coordinate, to: b.coordinate });
  }
  return result;
}

export function parseInput(value: unknown): SegmentInput {
  const v = record(value, 'route input'); keys(v, ['fromStopId','toStopId','from','to'], 'route input');
  const fromStopId = uuid(v.fromStopId, 'fromStopId'), toStopId = uuid(v.toStopId, 'toStopId');
  if (fromStopId === toStopId) throw new Error('A segment requires two distinct Stop occurrences.');
  return { fromStopId, toStopId, from: coordinate(v.from), to: coordinate(v.to) };
}

export function parseViaPoints(value: unknown): ViaPoint[] {
  if (!Array.isArray(value) || value.length > MAX_VIA_POINTS) throw new Error(`Use at most ${MAX_VIA_POINTS} via points per segment.`);
  const points = value.map(item => {
    const v = record(item, 'via point'); keys(v, ['id','coordinate'], 'via point');
    return { id: uuid(v.id, 'via point id'), coordinate: coordinate(v.coordinate) };
  });
  if (new Set(points.map(p => p.id)).size !== points.length) throw new Error('Duplicate via point identity.');
  return points;
}

export function parseGeometry(value: unknown): RoadGeometry {
  const v = record(value, 'road geometry'); keys(v, ['type','coordinates'], 'road geometry');
  if (v.type !== 'LineString' || !Array.isArray(v.coordinates) || v.coordinates.length < 2 || v.coordinates.length > MAX_VERTICES)
    throw new Error('Provider returned invalid or oversized road geometry.');
  const coordinates = v.coordinates.map(coordinate);
  if (coordinates.every(p => sameCoordinate(p, coordinates[0]))) throw new Error('No road geometry between these points.');
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i-1], b = coordinates[i];
    const longitude = Math.min(Math.abs(a[0]-b[0]),360-Math.abs(a[0]-b[0]));
    const distance = Math.hypot(longitude*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111195;
    if (distance > 20000) throw new Error('Provider returned discontinuous road geometry.');
  }
  return { type: 'LineString', coordinates };
}

export function parseProvenance(value: unknown): RouteProvenance {
  const v = record(value, 'route provenance');
  keys(v, ['version','source','provider','profile','generatedAt','engineVersion','graphDate','attribution','license'], 'route provenance');
  if (v.version !== 1 || v.source !== 'generated' || v.provider !== 'openrouteservice' || v.profile !== 'driving-car'
    || v.license !== 'https://creativecommons.org/licenses/by-sa/4.0/'
    || typeof v.attribution !== 'string' || !v.attribution.includes('openrouteservice') || !v.attribution.includes('OpenStreetMap') || v.attribution.length > 1000)
    throw new Error('Unsupported road provenance or missing attribution/license.');
  for (const key of ['engineVersion','graphDate']) if (v[key] !== null && (typeof v[key] !== 'string' || (v[key] as string).length > 200)) throw new Error('Invalid provider metadata.');
  utcTimestamp(v.generatedAt, 'generatedAt');
  return v as RouteProvenance;
}

export function parseProposal(value: RoadProposal): RoadProposal {
  const input = parseInput(value.input), viaPoints = parseViaPoints(value.viaPoints), geometry = parseGeometry(value.geometry);
  if (value.distanceMeters !== null && (typeof value.distanceMeters !== 'number' || !Number.isFinite(value.distanceMeters) || value.distanceMeters < 0))
    throw new Error('Invalid provider distance.');
  // Snap tolerance is deliberately bounded. Never add straight connectors to fill a gap.
  const waypoints = [input.from, ...viaPoints.map(p => p.coordinate), input.to];
  const near = (a: Coordinate, b: Coordinate) => {
    const lat = (a[1] + b[1]) * Math.PI / 360;
    const dx = Math.min(Math.abs(a[0] - b[0]), 360 - Math.abs(a[0] - b[0])) * Math.cos(lat);
    return Math.hypot(dx, a[1] - b[1]) * 111195 <= 1500;
  };
  if (!near(geometry.coordinates[0], input.from) || !near(geometry.coordinates[geometry.coordinates.length - 1], input.to))
    throw new Error('Road geometry does not match the requested Stops.');
  let cursor = 0;
  for (const point of waypoints) {
    while (cursor < geometry.coordinates.length && !near(geometry.coordinates[cursor], point)) cursor++;
    if (cursor === geometry.coordinates.length) throw new Error('Road geometry does not follow the ordered via points.');
  }
  return { input, viaPoints, geometry, provenance: parseProvenance(value.provenance), distanceMeters: value.distanceMeters };
}

// Split only at the geographic seam; interpolation is a display operation, not
// invented routing. The full provider geometry stays unchanged in SQLite/export.
export function splitAtDateline(coordinates: Coordinate[]): Coordinate[][] {
  const parts: Coordinate[][] = []; let part: Coordinate[] = [coordinates[0]];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    if (Math.abs(b[0] - a[0]) > 180) {
      const unwrapped = b[0] + (b[0] < a[0] ? 360 : -360), edge = unwrapped > 180 ? 180 : -180;
      if (unwrapped === a[0]) {
        part.push([a[0],b[1]]); parts.push(part); part = [b]; continue;
      }
      const latitude = a[1] + (b[1] - a[1]) * (edge - a[0]) / (unwrapped - a[0]);
      part.push([edge, latitude]); parts.push(part); part = [[-edge, latitude], b];
    } else part.push(b);
  }
  parts.push(part);
  return parts.filter(p => p.length > 1 && p.some(c => !sameCoordinate(c, p[0])));
}

export function roadFeatures(routes: readonly RoadProposal[]) {
  return { type: 'FeatureCollection' as const, features: routes.flatMap(route => splitAtDateline(route.geometry.coordinates).map((coordinates, index) => ({
    type: 'Feature' as const, id: `${segmentKey(route.input)}:${index}`,
    properties: { kind: 'generated_road', fromStopId: route.input.fromStopId, toStopId: route.input.toStopId },
    geometry: { type: 'LineString' as const, coordinates },
  }))) };
}

export function currentRoadRoutes(saved: SavedRoadRoute[], segments: SegmentInput[]): SavedRoadRoute[] {
  return saved.filter(route => !route.stale && segments.some(input => sameInput(input, route.input)));
}
