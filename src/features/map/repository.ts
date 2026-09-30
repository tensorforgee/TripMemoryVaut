import type { LocalDatabase } from '../../core/database/database';
import { parseDateSpec, type DateSpec, type PartialDate } from '../../domain/date-spec';
import { orderedPosition, type StopFields } from '../../domain/stop';
import { uuid } from '../../domain/validation';
import { canonicalCoordinate, type Coordinate } from './model';

type VisitRow = {
  stop_id: string;
  place_id: string;
  place_name: string;
  latitude: number | null;
  longitude: number | null;
  trip_id: string;
  trip_title: string;
  trip_dates_json: string;
  stop_dates_json: string | null;
  stop_kind: string;
  stop_position: number;
  day_id: string | null;
  day_label: string | null;
  day_dates_json: string | null;
};

export type GlobalMapVisit = {
  stopId: string;
  tripId: string;
  tripTitle: string;
  kind: StopFields['kind'];
  position: number;
  dates: DateSpec;
  dateLabel: string;
  timelineSectionLabel: string | null;
};

export type GlobalMapTrip = { id: string; title: string };

export type GlobalMapPlace = {
  id: string;
  name: string;
  coordinate: Coordinate | null;
  visitCount: number;
  tripCount: number;
  firstKnownVisit: string | null;
  mostRecentKnownVisit: string | null;
  trips: GlobalMapTrip[];
  visits: GlobalMapVisit[];
};

export type GlobalMapArchive = {
  places: GlobalMapPlace[];
  mappedPlaces: GlobalMapPlace[];
  unmappedPlaces: GlobalMapPlace[];
  totalPlaceCount: number;
  mappedPlaceCount: number;
  unmappedPlaceCount: number;
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function partialDateLabel(date: PartialDate): string {
  if (date.precision === 'unknown') return 'Date unknown';
  const [year, month, day] = date.value.split('-');
  if (date.precision === 'year') return year;
  if (date.precision === 'month') return `${monthNames[Number(month) - 1]} ${year}`;
  return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`;
}

export function visitDateLabel(dates: DateSpec): string {
  const start = dates.start.precision === 'unknown' ? null : partialDateLabel(dates.start);
  const end = dates.end && dates.end.precision !== 'unknown' ? partialDateLabel(dates.end) : null;
  let value = start ?? (end ? `Start unknown – ${end}` : 'Date unknown');
  if (start && end && partialDateLabel(dates.start) !== end) value = `${start} – ${end}`;
  if (dates.certainty === 'approximate' && value !== 'Date unknown') value = `~${value}`;
  return dates.label ? `${value} · ${dates.label}` : value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function partialBounds(date: PartialDate): [string, string] | null {
  if (date.precision === 'unknown') return null;
  if (date.precision === 'day') return [date.value, date.value];
  if (date.precision === 'year') return [`${date.value}-01-01`, `${date.value}-12-31`];
  const [year, month] = date.value.split('-').map(Number);
  return [`${date.value}-01`, `${date.value}-${String(daysInMonth(year, month)).padStart(2, '0')}`];
}

function dateBounds(dates: DateSpec): [string, string] | null {
  const start = partialBounds(dates.start);
  const end = dates.end ? partialBounds(dates.end) : null;
  if (!start && !end) return null;
  return [start?.[0] ?? end![0], end?.[1] ?? start![1]];
}

function stopKind(value: string): StopFields['kind'] {
  if (value !== 'visit' && value !== 'stay' && value !== 'transit') throw new Error('Invalid My Map stop kind');
  return value;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en', { sensitivity: 'base' }) || left.localeCompare(right);
}

function compareVisits(left: GlobalMapVisit, right: GlobalMapVisit): number {
  const leftBounds = dateBounds(left.dates);
  const rightBounds = dateBounds(right.dates);
  if (leftBounds && !rightBounds) return -1;
  if (!leftBounds && rightBounds) return 1;
  if (leftBounds && rightBounds) {
    const byStart = leftBounds[0].localeCompare(rightBounds[0]);
    if (byStart) return byStart;
  }
  return compareText(left.tripTitle, right.tripTitle) || left.tripId.localeCompare(right.tripId)
    || left.position - right.position || left.stopId.localeCompare(right.stopId);
}

function knownVisitLabels(visits: readonly GlobalMapVisit[]): { first: string | null; recent: string | null } {
  const known = visits.flatMap(visit => {
    const bounds = dateBounds(visit.dates);
    return bounds ? [{ visit, bounds }] : [];
  });
  if (!known.length) return { first: null, recent: null };
  const first = known.slice().sort((a, b) => a.bounds[0].localeCompare(b.bounds[0]) || compareVisits(a.visit, b.visit))[0];
  const recent = known.slice().sort((a, b) => b.bounds[1].localeCompare(a.bounds[1]) || compareVisits(a.visit, b.visit))[0];
  return { first: first.visit.dateLabel, recent: recent.visit.dateLabel };
}

function timelineLabel(row: VisitRow): string | null {
  if (row.day_id === null) return null;
  if (row.day_label !== null) return row.day_label;
  if (row.day_dates_json !== null) return visitDateLabel(parseDateSpec(JSON.parse(row.day_dates_json)));
  return 'Untitled section';
}

// This is the only read path for My Map. Its SQL starts at live saved Trips and
// confirmed live visit/stay Stops; Dreams and reconstruction suggestions are not inputs.
export class GlobalMapRepository {
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string) {
    uuid(vaultId, 'vaultId');
  }

  archive(): Promise<GlobalMapArchive> {
    return this.database.run(async connection => {
      const rows = await connection.getAllAsync<VisitRow>(`
        SELECT s.id stop_id,p.id place_id,p.name place_name,p.latitude,p.longitude,
          t.id trip_id,t.title trip_title,t.dates_json trip_dates_json,
          s.dates_json stop_dates_json,s.kind stop_kind,s.position stop_position,
          d.id day_id,d.label day_label,d.dates_json day_dates_json
        FROM trips t
        JOIN stops s ON s.trip_id=t.id AND s.vault_id=t.vault_id
        JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
        LEFT JOIN trip_days d ON d.id=s.day_id AND d.trip_id=s.trip_id
          AND d.vault_id=s.vault_id AND d.deleted_at IS NULL
        WHERE t.vault_id=? AND t.status='saved' AND t.deleted_at IS NULL
          AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
          AND p.deleted_at IS NULL
        ORDER BY p.name COLLATE NOCASE,p.id,t.title COLLATE NOCASE,t.id,s.position,s.id`, this.vaultId);

      const grouped = new Map<string, { name: string; coordinate: Coordinate | null; visits: GlobalMapVisit[] }>();
      for (const row of rows) {
        const placeId = uuid(row.place_id, 'place.id');
        const dates = parseDateSpec(JSON.parse(row.stop_dates_json ?? row.trip_dates_json));
        const visit: GlobalMapVisit = {
          stopId: uuid(row.stop_id, 'stop.id'), tripId: uuid(row.trip_id, 'trip.id'), tripTitle: row.trip_title,
          kind: stopKind(row.stop_kind), position: orderedPosition(row.stop_position), dates,
          dateLabel: visitDateLabel(dates), timelineSectionLabel: timelineLabel(row),
        };
        const existing = grouped.get(placeId);
        if (existing) existing.visits.push(visit);
        else grouped.set(placeId, { name: row.place_name, coordinate: canonicalCoordinate(row.latitude, row.longitude), visits: [visit] });
      }

      const places: GlobalMapPlace[] = [...grouped.entries()].map(([id, value]) => {
        const visits = value.visits.slice().sort(compareVisits);
        const trips = [...new Map(visits.map(visit => [visit.tripId, { id: visit.tripId, title: visit.tripTitle }])).values()]
          .sort((a, b) => compareText(a.title, b.title) || a.id.localeCompare(b.id));
        const labels = knownVisitLabels(visits);
        return { id, name: value.name, coordinate: value.coordinate, visitCount: visits.length, tripCount: trips.length,
          firstKnownVisit: labels.first, mostRecentKnownVisit: labels.recent, trips, visits };
      }).sort((a, b) => b.visitCount - a.visitCount || compareText(a.name, b.name) || a.id.localeCompare(b.id));
      const mappedPlaces = places.filter(place => place.coordinate !== null);
      const unmappedPlaces = places.filter(place => place.coordinate === null);
      return { places, mappedPlaces, unmappedPlaces, totalPlaceCount: places.length,
        mappedPlaceCount: mappedPlaces.length, unmappedPlaceCount: unmappedPlaces.length };
    });
  }
}
