import type { LocalDatabase } from '../../core/database/database';
import { parseDateSpec, type DateSpec } from '../../domain/date-spec';
import { uuid } from '../../domain/validation';

type CountRow = {
  trip_count: number;
  place_count: number;
  visit_count: number;
  photo_count: number;
  photo_placement_count: number;
  companion_count: number;
  chapter_count: number;
};

type CompanionRow = { id: string; label: string; trip_count: number };
type ChapterRow = { id: string; name: string; position: number; trip_count: number };
type HistoryRow = { id: string; title: string; dates_json: string };

export type TravelLifeMetrics = {
  trips: number;
  places: number;
  visits: number;
  photos: number;
  photoPlacements: number;
  companions: number;
  chapters: number;
  recordedDistance: {
    status: 'unavailable';
    kilometres: null;
    explanation: string;
  };
};

export type TravelLifeCompanion = { id: string; displayName: string; tripCount: number };
export type TravelLifeChapter = { id: string; title: string; tripCount: number };
export type TravelHistoryTrip = { id: string; title: string; dateLabel: string };
export type TravelHistoryGroup = { key: string; title: string; trips: TravelHistoryTrip[] };
export type TravelLifePlace = { id: string; name: string; visitCount: number; tripCount: number };
export type TravelLifeOverview = {
  metrics: TravelLifeMetrics;
  companions: TravelLifeCompanion[];
  chapters: TravelLifeChapter[];
  history: TravelHistoryGroup[];
};

const activeTrips = `SELECT id,title,dates_json,sort_date FROM trips
  WHERE vault_id=? AND status='saved' AND deleted_at IS NULL`;

function count(value: number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid Travel Life ${field}`);
  return parsed;
}

function historyYear(dates: DateSpec): string | null {
  return dates.start.precision === 'unknown' ? null : dates.start.value.slice(0, 4);
}

function historyDateLabel(dates: DateSpec): string {
  if (dates.start.precision === 'unknown') return dates.label ? `Date unknown · ${dates.label}` : 'Date unknown';
  const marker = dates.certainty === 'approximate' ? '~' : '';
  let label = `${marker}${dates.start.value}`;
  if (dates.end && dates.end.precision !== 'unknown' && dates.end.value !== dates.start.value) {
    label += ` – ${marker}${dates.end.value}`;
  }
  return dates.label ? `${label} · ${dates.label}` : label;
}

function groupHistory(rows: HistoryRow[]): TravelHistoryGroup[] {
  const groups = new Map<string, TravelHistoryTrip[]>();
  const unknown: TravelHistoryTrip[] = [];
  for (const row of rows) {
    const dates = parseDateSpec(JSON.parse(row.dates_json));
    const trip = { id: uuid(row.id, 'trip.id'), title: row.title, dateLabel: historyDateLabel(dates) };
    const year = historyYear(dates);
    if (year === null) unknown.push(trip);
    else groups.set(year, [...(groups.get(year) ?? []), trip]);
  }
  const known = [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([year, trips]) => ({ key: year, title: year, trips }));
  return unknown.length ? [...known, { key: 'unknown', title: 'Date unknown', trips: unknown }] : known;
}

// All Travel Life SQL lives here. Every relationship starts from saved, live
// Trips in this vault, so drafts and recoverable Trash rows cannot leak in.
export class TravelLifeRepository {
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string) {
    uuid(vaultId, 'vaultId');
  }

  async overview(): Promise<TravelLifeOverview> {
    return this.database.run(async connection => {
      const metrics = await connection.getFirstAsync<CountRow>(`
        WITH active_trips AS (${activeTrips}),
        qualifying_stops AS (
          SELECT s.id,s.place_id,s.trip_id FROM stops s
          JOIN active_trips t ON t.id=s.trip_id
          JOIN places p ON p.id=s.place_id AND p.vault_id=? AND p.deleted_at IS NULL
          WHERE s.vault_id=? AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
        ),
        active_placements AS (
          SELECT tm.id,tm.media_id FROM trip_media tm
          JOIN active_trips t ON t.id=tm.trip_id
          JOIN media m ON m.id=tm.media_id AND m.vault_id=? AND m.deleted_at IS NULL
          WHERE tm.vault_id=? AND tm.deleted_at IS NULL
        ),
        active_companions AS (
          SELECT tc.companion_id FROM trip_companions tc
          JOIN active_trips t ON t.id=tc.trip_id
          JOIN companions c ON c.id=tc.companion_id AND c.vault_id=? AND c.deleted_at IS NULL
          WHERE tc.vault_id=? AND tc.deleted_at IS NULL
        ),
        active_chapters AS (
          SELECT tc.chapter_id FROM trip_chapters tc
          JOIN active_trips t ON t.id=tc.trip_id
          JOIN chapters c ON c.id=tc.chapter_id AND c.vault_id=? AND c.deleted_at IS NULL
          WHERE tc.vault_id=? AND tc.deleted_at IS NULL
        )
        SELECT
          (SELECT COUNT(*) FROM active_trips) trip_count,
          (SELECT COUNT(DISTINCT place_id) FROM qualifying_stops) place_count,
          (SELECT COUNT(*) FROM qualifying_stops) visit_count,
          (SELECT COUNT(DISTINCT media_id) FROM active_placements) photo_count,
          (SELECT COUNT(*) FROM active_placements) photo_placement_count,
          (SELECT COUNT(DISTINCT companion_id) FROM active_companions) companion_count,
          (SELECT COUNT(DISTINCT chapter_id) FROM active_chapters) chapter_count`,
      this.vaultId, this.vaultId, this.vaultId, this.vaultId, this.vaultId,
      this.vaultId, this.vaultId, this.vaultId, this.vaultId);
      if (!metrics) throw new Error('Travel Life metrics could not be read');

      const companions = await connection.getAllAsync<CompanionRow>(`
        WITH active_trips AS (${activeTrips})
        SELECT c.id,c.label,COUNT(DISTINCT t.id) trip_count
        FROM companions c
        JOIN trip_companions tc ON tc.companion_id=c.id AND tc.vault_id=c.vault_id AND tc.deleted_at IS NULL
        JOIN active_trips t ON t.id=tc.trip_id
        WHERE c.vault_id=? AND c.deleted_at IS NULL
        GROUP BY c.id,c.label
        ORDER BY trip_count DESC,c.label COLLATE NOCASE,c.id`, this.vaultId, this.vaultId);

      const chapters = await connection.getAllAsync<ChapterRow>(`
        WITH active_trips AS (${activeTrips})
        SELECT c.id,c.name,c.position,COUNT(DISTINCT t.id) trip_count
        FROM chapters c
        JOIN trip_chapters tc ON tc.chapter_id=c.id AND tc.vault_id=c.vault_id AND tc.deleted_at IS NULL
        JOIN active_trips t ON t.id=tc.trip_id
        WHERE c.vault_id=? AND c.deleted_at IS NULL
        GROUP BY c.id,c.name,c.position
        ORDER BY c.position,c.name COLLATE NOCASE,c.id`, this.vaultId, this.vaultId);

      const history = await connection.getAllAsync<HistoryRow>(`
        SELECT id,title,dates_json FROM (${activeTrips})
        ORDER BY sort_date IS NULL,sort_date DESC,title COLLATE NOCASE,id`, this.vaultId);

      return {
        metrics: {
          trips: count(metrics.trip_count, 'Trip count'),
          places: count(metrics.place_count, 'Place count'),
          visits: count(metrics.visit_count, 'visit count'),
          photos: count(metrics.photo_count, 'photo count'),
          photoPlacements: count(metrics.photo_placement_count, 'photo placement count'),
          companions: count(metrics.companion_count, 'Companion count'),
          chapters: count(metrics.chapter_count, 'Chapter count'),
          recordedDistance: {
            status: 'unavailable', kilometres: null,
            explanation: 'No canonical Trip distance is stored yet. Stop coordinates are never used to estimate it.',
          },
        },
        companions: companions.map(row => ({ id: uuid(row.id, 'companion.id'), displayName: row.label, tripCount: count(row.trip_count, 'Companion Trip count') })),
        chapters: chapters.map(row => ({ id: uuid(row.id, 'chapter.id'), title: row.name, tripCount: count(row.trip_count, 'Chapter Trip count') })),
        history: groupHistory(history),
      };
    });
  }

  listPlaces(): Promise<TravelLifePlace[]> {
    return this.database.run(async connection => (await connection.getAllAsync<{
      id: string; name: string; visit_count: number; trip_count: number;
    }>(`
      WITH active_trips AS (${activeTrips}),
      qualifying_stops AS (
        SELECT s.id,s.place_id,s.trip_id FROM stops s
        JOIN active_trips t ON t.id=s.trip_id
        WHERE s.vault_id=? AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
      )
      SELECT p.id,p.name,COUNT(q.id) visit_count,COUNT(DISTINCT q.trip_id) trip_count
      FROM places p JOIN qualifying_stops q ON q.place_id=p.id
      WHERE p.vault_id=? AND p.deleted_at IS NULL
      GROUP BY p.id,p.name
      ORDER BY visit_count DESC,p.name COLLATE NOCASE,p.id`, this.vaultId, this.vaultId, this.vaultId)).map(row => ({
        id: uuid(row.id, 'place.id'), name: row.name,
        visitCount: count(row.visit_count, 'Place visit count'), tripCount: count(row.trip_count, 'Place Trip count'),
      })));
  }
}
