import type { Trip } from '../../domain/trip';
import type { TripDay } from '../../domain/trip-day';
import { buildTripMap, fitTripCamera, type MapStop } from './model';
import { dateLabel } from '../trips/presentation';
import { sectionTitle } from '../timeline/presentation';

export type PhotoCounts = { total: number; byStop: Record<string, number> };
export const mapPalette = { route: '#146775', start: '#48735b', destination: '#ad5741', selected: '#b44d32' };

export function tripMapSummary(trip: Trip, model: ReturnType<typeof buildTripMap>, photos: PhotoCounts) {
  const { dates } = trip;
  let duration: string | null = null;
  if (dates.certainty === 'exact' && dates.start.precision === 'day' && dates.end?.precision === 'day') {
    const days = Math.round((Date.parse(`${dates.end.value}T00:00:00Z`) - Date.parse(`${dates.start.value}T00:00:00Z`)) / 86400000) + 1;
    duration = `${days} ${days === 1 ? 'day' : 'days'}`;
  } else if (trip.durationEstimateDays !== null) {
    duration = `About ${trip.durationEstimateDays} ${trip.durationEstimateDays === 1 ? 'day' : 'days'}`;
  }
  const mappedLabel = `${model.mapped.length} mapped ${model.mapped.length === 1 ? 'stop' : 'stops'}`;
  const photoLabel = `${photos.total} ${photos.total === 1 ? 'photo' : 'photos'}`;
  return { title: trip.title, duration, distance: null, mappedLabel, photoLabel,
    route: model.route.map(s => s.stop.place.name).join(' → '),
    mappedCount: model.mapped.length, photoCount: photos.total,
    chips: [...(duration ? [duration] : []), mappedLabel, photoLabel] };
}

export function stopRole(item: MapStop, total: number) {
  return item.order === 1 ? (total === 1 ? 'Only stop' : 'Start') : item.order === total ? 'Destination' : 'Stop';
}

// One native symbol per coordinate; occurrence IDs and order are retained in the
// sheet. Choosing a repeated visit changes the displayed number, never the pin.
export function tripMarkerFeatures(model: ReturnType<typeof buildTripMap>, selected?: string) {
  const groups = new Map<string, typeof model.mapped>();
  for (const item of model.mapped) {
    const key = item.coordinate.join(',');
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  return { type: 'FeatureCollection' as const, features: [...groups.values()].map(group => {
    const item = group.find(s => s.stop.id === selected) ?? group[0];
    const role = stopRole(item, model.route.length);
    const active = item.stop.id === selected;
    const digits = `${item.order}${group.length > 1 ? '+' : ''}`;
    return { type: 'Feature' as const, id: group[0].stop.id,
      geometry: { type: 'Point' as const, coordinates: item.coordinate },
      properties: { stopId: item.stop.id, stopIds: group.map(s => s.stop.id), order: item.order,
        digits, selected: active, stay: item.stop.kind === 'stay', role,
        destination: model.route.length > 1 && group.some(s => s.order === model.route.length),
        ...Object.fromEntries([...digits].flatMap((digit, index) => [
          [`digit${index}`, digit === '+' ? 'plus' : digit], [`offset${index}`, [(index - (digits.length - 1) / 2) * 20, 0]],
        ])),
        radius: Math.max(active ? 22 : 18, digits.length * 5 + 9),
        color: active ? mapPalette.selected : role === 'Start' || role === 'Only stop' ? mapPalette.start
          : role === 'Destination' ? mapPalette.destination : mapPalette.route } };
  }) };
}

export function selectedStopDetails(item: MapStop, days: readonly TripDay[], photos: PhotoCounts) {
  const day = days.find(d => d.id === item.stop.dayId && d.tripId === item.stop.tripId && d.deletedAt === null);
  const known = (dates: MapStop['stop']['dates']) => dates && (dates.certainty !== 'unknown' || dates.label) ? dateLabel(dates) : null;
  return { name: item.stop.place.name, order: item.order, kind: item.stop.kind,
    section: day ? sectionTitle(day) : null, dates: known(item.stop.dates), note: item.stop.note,
    lodging: item.stop.kind === 'stay' ? item.stop.lodgingLabel : null,
    checkout: item.stop.kind === 'stay' ? known(item.stop.checkoutDates) : null,
    photoCount: photos.byStop[item.stop.id] ?? 0 };
}

// Header and sheet occupy layout space outside the Map, so the existing helper's
// 48-point edge padding is applied to the measured, unobscured map viewport.
export function tripMapCamera(model: ReturnType<typeof buildTripMap>, width: number, height: number) {
  return fitTripCamera(model.mapped.map(s => s.coordinate), width, height);
}

export type BasemapState = 'loading' | 'online' | 'offline' | 'unconfigured' | 'unavailable';
export function basemapPresentation(state: BasemapState) {
  return {
    label: state === 'online' ? 'Detailed basemap · tiles may be cached' : state === 'loading' ? 'Loading basemap…' : state === 'unconfigured'
      ? 'Offline overview · online map not configured' : state === 'unavailable' ? 'Map unavailable · your route is still here'
        : 'Offline overview · detailed map unavailable',
    detail: state === 'online' ? 'Map data needs a connection.' : state === 'loading' ? 'Your stops and journal are already on this device.'
      : 'Local stops and sequence remain available. No detailed offline roads.',
    useOfflineStyle: state === 'offline' || state === 'unconfigured',
    canRetry: state === 'offline' || state === 'unavailable',
  };
}

export function resolveMapStyleUrl(value: string | undefined): string | null {
  if (!value?.trim() || /\s/.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    // Explicit configuration in every build; never silently select another provider.
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? value.trim() : null;
  } catch {
    return null;
  }
}
