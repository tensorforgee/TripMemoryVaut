import type { LocalDatabase, SqlConnection } from '../../core/database/database';
import { parseDateSpec } from '../../domain/date-spec';
import { ValidationError, uuid } from '../../domain/validation';
import { dateLabel } from '../trips/presentation';
import { rebuildSearchIndex, SEARCH_INDEX_VERSION } from './schema';

type DocumentType = 'trip' | 'place' | 'stop' | 'trip_day' | 'companion' | 'chapter' | 'dream' | 'trip_media';
export type SearchEntityType = 'trip' | 'place' | 'stop' | 'tripDay' | 'companion' | 'chapter' | 'dream' | 'mediaCaption';
export type SearchResult = {
  entityType: SearchEntityType;
  entityId: string;
  tripId: string | null;
  primaryTitle: string;
  subtitle: string;
  contextLabel: string | null;
  navigationTarget: string;
};

type MatchRow = {
  entity_type: DocumentType; entity_id: string; trip_id: string | null; title: string; body: string;
  match_rank: number; relevance: number;
};
type Candidate = MatchRow & { related: boolean; source_type?: DocumentType; source_title?: string };
type TripRow = { id: string; title: string; status: 'draft' | 'saved'; dates_json: string };

const documentLimit = 60;
const maxTerms = 8;
const termPattern = /[\p{L}\p{N}]+/gu;

function queryParts(input: string): { match: string; titleMatch: string; exact: string } | null {
  const normalized = input.normalize('NFKC').trim().slice(0, 200);
  const terms = (normalized.match(termPattern) ?? []).slice(0, maxTerms).map(term => term.slice(0, 64));
  if (!terms.length) return null;
  const phrases = terms.map(term => `"${term}"*`);
  return { match: phrases.join(' AND '), titleMatch: phrases.map(phrase => `title:${phrase}`).join(' AND '), exact: normalized.toLowerCase() };
}

function placeholders(ids: readonly string[]): string { return ids.map(() => '?').join(','); }
function excerpt(value: string | null | undefined, max = 110): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function candidateOrder(a: Candidate, b: Candidate): number {
  return a.match_rank - b.match_rank || a.relevance - b.relevance || Number(a.related) - Number(b.related)
    || compareText(a.title.normalize('NFKC').toLowerCase(), b.title.normalize('NFKC').toLowerCase())
    || compareText(a.entity_type, b.entity_type) || compareText(a.entity_id, b.entity_id);
}
function tripContext(row: TripRow): string {
  const date = dateLabel(parseDateSpec(JSON.parse(row.dates_json)));
  return row.status === 'draft' ? `Draft · ${date}` : date;
}
function countLabel(count: number, singular: string, plural = `${singular}s`): string { return `${count} ${count === 1 ? singular : plural}`; }

async function relatedTrips(connection: SqlConnection, vaultId: string, matches: MatchRow[]): Promise<Candidate[]> {
  const result: Candidate[] = [];
  const add = async (type: 'companion' | 'chapter' | 'place', sql: string) => {
    const source = matches.filter(match => match.entity_type === type);
    if (!source.length) return;
    const byId = new Map(source.map(match => [match.entity_id, match]));
    const rows = await connection.getAllAsync<{ source_id: string; trip_id: string }>(sql.replace('SOURCE_IDS', placeholders(source.map(match => match.entity_id))), vaultId, ...source.map(match => match.entity_id));
    for (const row of rows) {
      const match = byId.get(row.source_id);
      if (match) result.push({ ...match, entity_type: 'trip', entity_id: row.trip_id, trip_id: row.trip_id,
        match_rank: match.match_rank + 3, related: true, source_type: type, source_title: match.title });
    }
  };
  await add('companion', `SELECT tc.companion_id source_id,t.id trip_id FROM trip_companions tc
    JOIN trips t ON t.id=tc.trip_id AND t.vault_id=tc.vault_id
    WHERE tc.vault_id=? AND tc.companion_id IN (SOURCE_IDS) AND tc.deleted_at IS NULL AND t.deleted_at IS NULL
    ORDER BY tc.companion_id,t.id LIMIT 60`);
  await add('chapter', `SELECT tc.chapter_id source_id,t.id trip_id FROM trip_chapters tc
    JOIN trips t ON t.id=tc.trip_id AND t.vault_id=tc.vault_id
    WHERE tc.vault_id=? AND tc.chapter_id IN (SOURCE_IDS) AND tc.deleted_at IS NULL AND t.deleted_at IS NULL
    ORDER BY tc.chapter_id,t.id LIMIT 60`);
  await add('place', `SELECT DISTINCT s.place_id source_id,t.id trip_id FROM stops s
    JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id
    WHERE s.vault_id=? AND s.place_id IN (SOURCE_IDS) AND s.deleted_at IS NULL AND s.visit_confirmed=1
      AND t.deleted_at IS NULL ORDER BY s.place_id,t.id LIMIT 60`);
  return result;
}

async function resolve(connection: SqlConnection, vaultId: string, candidates: Candidate[]): Promise<SearchResult[]> {
  const ids = (type: DocumentType) => [...new Set(candidates.filter(item => item.entity_type === type).map(item => item.entity_id))];
  const get = async <T extends { id: string }>(type: DocumentType, sql: string): Promise<Map<string, T>> => {
    const values = ids(type); if (!values.length) return new Map();
    const rows = await connection.getAllAsync<T>(sql.replace('ENTITY_IDS', placeholders(values)), vaultId, ...values);
    return new Map(rows.map(row => [row.id, row]));
  };
  const trips = await get<TripRow>('trip', `SELECT id,title,status,dates_json FROM trips WHERE vault_id=? AND id IN (ENTITY_IDS) AND deleted_at IS NULL`);
  const places = await get<{ id: string; name: string; visit_count: number; trip_count: number }>('place', `SELECT p.id,p.name,
    COUNT(DISTINCT CASE WHEN t.id IS NOT NULL THEN s.id END) visit_count,COUNT(DISTINCT t.id) trip_count
    FROM places p LEFT JOIN stops s ON s.place_id=p.id AND s.vault_id=p.vault_id AND s.deleted_at IS NULL
      AND s.visit_confirmed=1 AND s.kind IN ('visit','stay')
    LEFT JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id AND t.deleted_at IS NULL AND t.status='saved'
    WHERE p.vault_id=? AND p.id IN (ENTITY_IDS) AND p.deleted_at IS NULL GROUP BY p.id`);
  const stops = await get<{ id: string; trip_id: string; trip_title: string; trip_status: string; place_name: string; note: string | null; lodging_label: string | null }>('stop', `SELECT s.id,s.trip_id,t.title trip_title,t.status trip_status,p.name place_name,s.note,s.lodging_label
    FROM stops s JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id JOIN places p ON p.id=s.place_id AND p.vault_id=s.vault_id
    WHERE s.vault_id=? AND s.id IN (ENTITY_IDS) AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND t.deleted_at IS NULL`);
  const days = await get<{ id: string; trip_id: string; trip_title: string; trip_status: string; label: string }>('trip_day', `SELECT d.id,d.trip_id,t.title trip_title,t.status trip_status,d.label FROM trip_days d
    JOIN trips t ON t.id=d.trip_id AND t.vault_id=d.vault_id WHERE d.vault_id=? AND d.id IN (ENTITY_IDS)
      AND d.deleted_at IS NULL AND t.deleted_at IS NULL`);
  const companions = await get<{ id: string; label: string; note: string | null; trip_count: number }>('companion', `SELECT c.id,c.label,c.note,COUNT(DISTINCT t.id) trip_count FROM companions c
    LEFT JOIN trip_companions tc ON tc.companion_id=c.id AND tc.vault_id=c.vault_id AND tc.deleted_at IS NULL
    LEFT JOIN trips t ON t.id=tc.trip_id AND t.vault_id=tc.vault_id AND t.deleted_at IS NULL
    WHERE c.vault_id=? AND c.id IN (ENTITY_IDS) AND c.deleted_at IS NULL GROUP BY c.id`);
  const chapters = await get<{ id: string; name: string; description: string | null; trip_count: number }>('chapter', `SELECT c.id,c.name,c.description,COUNT(DISTINCT t.id) trip_count FROM chapters c
    LEFT JOIN trip_chapters tc ON tc.chapter_id=c.id AND tc.vault_id=c.vault_id AND tc.deleted_at IS NULL
    LEFT JOIN trips t ON t.id=tc.trip_id AND t.vault_id=tc.vault_id AND t.deleted_at IS NULL
    WHERE c.vault_id=? AND c.id IN (ENTITY_IDS) AND c.deleted_at IS NULL GROUP BY c.id`);
  const dreams = await get<{ id: string; name: string; note: string | null; location_text: string | null; dream_status: string }>('dream', `SELECT d.id,p.name,d.note,d.location_text,
    CASE WHEN EXISTS(SELECT 1 FROM dream_visits dv JOIN stops s ON s.id=dv.stop_id AND s.vault_id=dv.vault_id
      JOIN trips t ON t.id=s.trip_id AND t.vault_id=s.vault_id WHERE dv.dream_id=d.id AND dv.vault_id=d.vault_id
      AND dv.deleted_at IS NULL AND s.deleted_at IS NULL AND s.visit_confirmed=1 AND t.deleted_at IS NULL AND t.status='saved')
    THEN 'Visited' ELSE 'Dreaming' END dream_status
    FROM dream_destinations d JOIN places p ON p.id=d.place_id AND p.vault_id=d.vault_id
    WHERE d.vault_id=? AND d.id IN (ENTITY_IDS) AND d.deleted_at IS NULL AND d.is_archived=0 AND p.deleted_at IS NULL`);
  const captions = await get<{ id: string; trip_id: string; trip_title: string; trip_status: string; caption: string }>('trip_media', `SELECT tm.id,tm.trip_id,t.title trip_title,t.status trip_status,tm.caption FROM trip_media tm
    JOIN trips t ON t.id=tm.trip_id AND t.vault_id=tm.vault_id JOIN media m ON m.id=tm.media_id AND m.vault_id=tm.vault_id
    WHERE tm.vault_id=? AND tm.id IN (ENTITY_IDS) AND tm.deleted_at IS NULL AND tm.caption IS NOT NULL
      AND t.deleted_at IS NULL AND m.deleted_at IS NULL`);

  const output: SearchResult[] = [];
  for (const item of candidates) {
    if (item.entity_type === 'trip') {
      const row = trips.get(item.entity_id); if (!row) continue;
      const source = item.related ? `Matched ${item.source_type === 'companion' ? 'Companion' : item.source_type === 'chapter' ? 'Chapter' : 'Place'}: ${item.source_title}` : tripContext(row);
      output.push({ entityType: 'trip', entityId: row.id, tripId: row.id, primaryTitle: row.title,
        subtitle: item.related ? `${source} · ${tripContext(row)}` : source, contextLabel: row.status === 'draft' ? 'Draft' : null,
        navigationTarget: `/trips/${row.id}` });
    } else if (item.entity_type === 'place') {
      const row = places.get(item.entity_id); if (!row) continue;
      output.push({ entityType: 'place', entityId: row.id, tripId: null, primaryTitle: row.name,
        subtitle: `${countLabel(Number(row.visit_count), 'visit')} · ${countLabel(Number(row.trip_count), 'trip')}`,
        contextLabel: null, navigationTarget: '/life/places' });
    } else if (item.entity_type === 'stop') {
      const row = stops.get(item.entity_id); if (!row) continue; const matched = excerpt(row.note ?? row.lodging_label);
      output.push({ entityType: 'stop', entityId: row.id, tripId: row.trip_id, primaryTitle: row.trip_title,
        subtitle: `Stop at ${row.place_name}${matched ? ` · ${matched}` : ''}`, contextLabel: row.trip_status === 'draft' ? 'Draft' : null,
        navigationTarget: `/trips/${row.trip_id}` });
    } else if (item.entity_type === 'trip_day') {
      const row = days.get(item.entity_id); if (!row) continue;
      output.push({ entityType: 'tripDay', entityId: row.id, tripId: row.trip_id, primaryTitle: row.trip_title,
        subtitle: `Section: ${row.label}`, contextLabel: row.trip_status === 'draft' ? 'Draft' : null, navigationTarget: `/trips/${row.trip_id}` });
    } else if (item.entity_type === 'companion') {
      const row = companions.get(item.entity_id); if (!row) continue;
      output.push({ entityType: 'companion', entityId: row.id, tripId: null, primaryTitle: row.label,
        subtitle: `${countLabel(Number(row.trip_count), 'trip')}${row.note ? ` · ${excerpt(row.note)}` : ''}`,
        contextLabel: null, navigationTarget: `/companions/${row.id}` });
    } else if (item.entity_type === 'chapter') {
      const row = chapters.get(item.entity_id); if (!row) continue;
      output.push({ entityType: 'chapter', entityId: row.id, tripId: null, primaryTitle: row.name,
        subtitle: `${countLabel(Number(row.trip_count), 'trip')}${row.description ? ` · ${excerpt(row.description)}` : ''}`,
        contextLabel: null, navigationTarget: `/chapters/${row.id}` });
    } else if (item.entity_type === 'dream') {
      const row = dreams.get(item.entity_id); if (!row) continue;
      const detail = excerpt(row.note ?? row.location_text);
      output.push({ entityType: 'dream', entityId: row.id, tripId: null, primaryTitle: row.name,
        subtitle: `${row.dream_status}${detail ? ` · ${detail}` : ''}`, contextLabel: null, navigationTarget: `/dreams/${row.id}` });
    } else {
      const row = captions.get(item.entity_id); if (!row) continue;
      output.push({ entityType: 'mediaCaption', entityId: row.id, tripId: row.trip_id, primaryTitle: row.trip_title,
        subtitle: `Photo caption: ${excerpt(row.caption)}`, contextLabel: row.trip_status === 'draft' ? 'Draft' : null,
        navigationTarget: `/trips/${row.trip_id}` });
    }
  }
  return output;
}

export class SearchRepository {
  constructor(private readonly database: LocalDatabase, private readonly vaultId: string) { uuid(vaultId, 'vaultId'); }

  search(input: string, limit = 30): Promise<SearchResult[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new ValidationError('limit', 'requires 1–30');
    const parts = queryParts(input); if (!parts) return Promise.resolve([]);
    return this.database.run(async connection => {
      const rows = await connection.getAllAsync<MatchRow>(`SELECT d.entity_type,d.entity_id,d.trip_id,d.title,d.body,
        CASE WHEN lower(trim(d.title))=lower(?) THEN 0
          WHEN d.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?) THEN 1 ELSE 2 END match_rank,
        bm25(search_fts,8.0,1.0) relevance
        FROM search_fts JOIN search_documents d ON d.rowid=search_fts.rowid
        WHERE search_fts MATCH ? AND d.vault_id=?
        ORDER BY match_rank,relevance,d.title COLLATE NOCASE,d.entity_type,d.entity_id LIMIT ?`,
      parts.exact, parts.titleMatch, parts.match, this.vaultId, documentLimit);
      const direct = rows.map(row => ({ ...row, match_rank: row.title.normalize('NFKC').trim().toLowerCase() === parts.exact ? 0 : row.match_rank }));
      const candidates: Candidate[] = [...direct.map(match => ({ ...match, related: false })), ...await relatedTrips(connection, this.vaultId, direct)];
      candidates.sort(candidateOrder);
      const unique: Candidate[] = []; const seen = new Set<string>();
      for (const candidate of candidates) {
        const key = `${candidate.entity_type}\0${candidate.entity_id}`;
        if (!seen.has(key)) { seen.add(key); unique.push(candidate); }
        if (unique.length === limit) break;
      }
      return resolve(connection, this.vaultId, unique);
    });
  }

  rebuild(): Promise<void> {
    return this.database.transaction(connection => rebuildSearchIndex(connection, this.vaultId));
  }

  async indexVersion(): Promise<number | null> {
    return this.database.run(async connection => (await connection.getFirstAsync<{ index_version: number }>(
      'SELECT index_version FROM search_index_state WHERE vault_id=?', this.vaultId))?.index_version ?? null);
  }

  static readonly indexVersion = SEARCH_INDEX_VERSION;
}
