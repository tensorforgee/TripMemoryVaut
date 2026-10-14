import { record } from '../../domain/validation';
import { parseInput, parseProposal, parseViaPoints, sameCoordinate, type RoadProposal, type SegmentInput, type ViaPoint } from './model';

export const ORS_ENDPOINT = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car';
export const ORS_ATTRIBUTION = '© openrouteservice by HeiGIT | Data from OpenStreetMap';
export const ORS_LICENSE = 'https://creativecommons.org/licenses/by-sa/4.0/';
export const ROUTING_SETUP_REQUIRED = 'Road routing is not configured. Add your openrouteservice API key in Settings → Routing.';

export interface RoutingProvider {
  readonly name: string;
  propose(input: SegmentInput, viaPoints: ViaPoint[], signal: AbortSignal): Promise<RoadProposal>;
}

// Deliberately no public demo, shared client key, or automatic fetch fallback.
export const configuredRoutingProvider: RoutingProvider = {
  name: 'openrouteservice (setup required)',
  async propose() { throw new Error(ROUTING_SETUP_REQUIRED); },
};

export function orsRequest(input: SegmentInput, viaPoints: ViaPoint[]) {
  const p = parseInput(input), via = parseViaPoints(viaPoints);
  const coordinates = [p.from, ...via.map(point => point.coordinate), p.to];
  if (coordinates.every(c => sameCoordinate(c, coordinates[0]))) throw new Error('Identical coordinates: add a via point for a remembered loop, or keep Stops only.');
  if (coordinates.some((p, i) => i > 0 && sameCoordinate(p, coordinates[i - 1]))) throw new Error('Adjacent via points must have different coordinates.');
  return { coordinates, instructions: false, elevation: false, geometry_simplify: false, radiuses: coordinates.map(() => 1000) };
}

export function decodeOrsPolyline(value: unknown): RoadProposal['geometry'] {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000_000)
    throw new Error('Malformed routing geometry.');
  const coordinates: [number, number][] = [];
  let index = 0, latitude = 0, longitude = 0;
  const next = () => {
    let result = 0, shift = 0;
    while (index < value.length) {
      const byte = value.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63 || shift > 30) throw new Error('Malformed routing geometry.');
      result |= (byte & 0x1f) << shift;
      if (byte < 0x20) return (result & 1) ? ~(result >> 1) : result >> 1;
      shift += 5;
    }
    throw new Error('Malformed routing geometry.');
  };
  while (index < value.length) {
    latitude += next(); longitude += next();
    coordinates.push([longitude / 1e5, latitude / 1e5]);
  }
  return { type: 'LineString', coordinates };
}

export function parseOrsResponse(value: unknown, input: SegmentInput, viaPoints: ViaPoint[], generatedAt: string): RoadProposal {
  const root = record(value, 'routing response');
  if (root.error) throw new Error('The provider could not find a road route. Adjust via points or retry.');
  let geometry: RoadProposal['geometry'], summary: Record<string, unknown>;
  if (Array.isArray(root.routes) && root.routes.length === 1) {
    const route = record(root.routes[0], 'routing route');
    geometry = decodeOrsPolyline(route.geometry);
    summary = record(route.summary, 'routing summary');
  } else {
    if (root.type !== 'FeatureCollection' || !Array.isArray(root.features) || root.features.length !== 1) throw new Error('Malformed routing response.');
    const feature = record(root.features[0], 'routing feature');
    if (feature.type !== 'Feature') throw new Error('Malformed routing feature.');
    const properties = record(feature.properties, 'routing properties');
    summary = record(properties.summary, 'routing summary');
    geometry = feature.geometry as RoadProposal['geometry'];
  }
  const metadata = record(root.metadata, 'routing metadata');
  const engine = record(metadata.engine, 'routing engine');
  const supplied = (v: unknown) => typeof v === 'string' && v.length <= 200 ? v : null;
  return parseProposal({ input, viaPoints, geometry,
    distanceMeters: summary.distance === undefined ? null : summary.distance as number,
    provenance: { version: 1, source: 'generated', provider: 'openrouteservice', profile: 'driving-car', generatedAt,
      engineVersion: supplied(engine.version), graphDate: supplied(engine.graph_date), attribution: ORS_ATTRIBUTION, license: ORS_LICENSE } });
}

export type CredentialReader = () => Promise<string | null>;
export type FetchLike = (url: string, init: {
  method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal;
}) => Promise<{ status: number; json(): Promise<unknown> }>;

export function liveOrsProvider(readCredential: CredentialReader, request: FetchLike = fetch): RoutingProvider {
  return orsAdapter(async (body, signal) => {
    const credential = await readCredential();
    if (!credential) throw new Error(ROUTING_SETUP_REQUIRED);
    const response = await request(ORS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: credential, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    let responseBody: unknown = {};
    try { responseBody = await response.json(); } catch { /* status handling below remains credential-safe */ }
    return { status: response.status, body: responseBody };
  });
}

// HTTP stays injected at the provider boundary so error tests never send
// coordinates. The live provider above supplies fetch only for an explicit UI action.
export type RoutingTransport = (body: ReturnType<typeof orsRequest>, signal: AbortSignal) => Promise<{ status: number; body: unknown }>;
export function orsAdapter(transport: RoutingTransport, now = () => new Date().toISOString(), timeoutMs = 30000): RoutingProvider {
  return { name: 'openrouteservice', async propose(input, viaPoints, signal) {
    if (signal.aborted) throw new Error('Route request cancelled.');
    const body = orsRequest(input, viaPoints), controller = new AbortController(), generatedAt = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    try {
      const interrupted = new Promise<never>((_, reject) => {
        cancel = () => { controller.abort(); reject(new Error('Route request cancelled.')); };
        signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new Error('Road route request timed out. Retry this segment.')); }, timeoutMs);
      });
      const request = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('cancelled');
        return transport(body, controller.signal);
      }).catch(error => {
        if (error instanceof Error && error.message === ROUTING_SETUP_REQUIRED) throw error;
        throw new Error('Invalid routing response or network failure. Retry this segment.');
      });
      const response = await Promise.race([request, interrupted]);
      if (!Number.isInteger(response.status)) throw new Error('Malformed routing response.');
      if (response.status === 401 || response.status === 403) throw new Error('Routing credential rejected. Check provider setup.');
      if (response.status === 429) throw new Error('Routing quota reached. Wait before retrying; no automatic retries.');
      if (response.status === 404 || response.status === 400) throw new Error('No routable road found. Check coordinates or adjust via points.');
      if (response.status < 200 || response.status >= 300) throw new Error('Routing provider unavailable. Retry this segment later.');
      return parseOrsResponse(response.body, input, viaPoints, generatedAt);
    } catch (e) {
      // Do not surface provider/transport bodies, URLs, credentials or request coordinates.
      if (e instanceof Error && /^(Route request cancelled|Road route request timed out|Routing credential rejected|Routing quota reached|No routable road found|Routing provider unavailable|Road routing is not configured|Malformed routing|The provider could not|Provider returned|Invalid route|No road geometry|Road geometry)/.test(e.message)) throw e;
      throw new Error('Invalid routing response or network failure. Retry this segment.');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); controller.abort(); }
  } };
}
