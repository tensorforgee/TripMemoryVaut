import type { LocalDatabase, SqlConnection, SqlValue } from '../../core/database/database';
import { mediaPath, type MediaFiles } from '../../core/media/files';
import { migrations } from '../../core/database/migrate';
import { parseDateSpec } from '../../domain/date-spec';

export const PORTABLE_FORMAT = 'trip-memory-vault';
export const PORTABLE_FORMAT_VERSION = 1;
export const APP_VERSION = '0.1.0';
const MAX_JSON_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024 * 1024;
const MAX_RECORDS = 250_000;
// A neutral suffix prevents Android media providers from privacy-transforming
// EXIF-bearing originals when an export is verified or restored through SAF.
const portableMediaPath = (sha256: string) => `media/originals/${sha256.slice(0, 2)}/${sha256}.original`;

type Row = Record<string, unknown>;
type FileKind = 'data' | 'media-original' | 'documentation' | 'schema' | 'journal' | 'route';
export type ArchiveFileEntry = { path: string; sha256: string; bytes: number; kind: FileKind };
export type ArchiveCounts = Record<EntityName, number>;
export type PortableManifest = {
  export_format: typeof PORTABLE_FORMAT;
  format_version: typeof PORTABLE_FORMAT_VERSION;
  created_at: string;
  app_version: string;
  schema_version: number;
  vault: { id: string; name: string; format_version: number };
  counts: ArchiveCounts;
  media_count: number;
  total_media_bytes: number;
  checksum_algorithm: 'SHA-256';
  capabilities: {
    original_media: true;
    tombstones: true;
    resolved_reconstruction_history: true;
    regenerable_derivatives_omitted: true;
  };
  files: ArchiveFileEntry[];
};

export interface ArchiveIO {
  createRoot(root: string): Promise<void>;
  removeRoot(root: string): Promise<void>;
  writeText(root: string, relativePath: string, contents: string): Promise<void>;
  readText(root: string, relativePath: string): Promise<string>;
  copyFromUri(sourceUri: string, root: string, relativePath: string): Promise<void>;
  copyTree(sourceRoot: string, destinationRoot: string): Promise<void>;
  exists(root: string, relativePath: string): Promise<boolean>;
  size(root: string, relativePath: string): Promise<number>;
  fileUri(root: string, relativePath: string): string;
  sha256Text(contents: string): Promise<string>;
  verifyFile(root: string, relativePath: string, sha256: string, bytes: number): Promise<boolean>;
}

type EntityName = keyof typeof entitySpecs;
type EntitySpec = {
  path: string;
  table: string;
  columns: readonly string[];
  json?: Readonly<Record<string, string>>;
  booleans?: readonly string[];
  order?: string;
  where?: string;
};

const entitySpecs = {
  vaults: { path: 'data/vault.json', table: 'vaults', columns: ['id','name','format_version','created_at','updated_at','deleted_at'], order: 'id' },
  trips: { path: 'data/trips.json', table: 'trips', columns: ['id','vault_id','title','status','dates_json','sort_date','sort_precision','duration_estimate_days','summary','is_favourite','created_at','updated_at','deleted_at','order_revision'], json: { dates_json: 'dates' }, booleans: ['is_favourite'], order: 'id' },
  places: { path: 'data/places.json', table: 'places', columns: ['id','vault_id','name','latitude','longitude','coordinate_precision','source','provenance_json','aliases_json','created_at','updated_at','deleted_at'], json: { provenance_json: 'provenance', aliases_json: 'aliases' }, order: 'id' },
  trip_days: { path: 'data/trip-days.json', table: 'trip_days', columns: ['id','vault_id','trip_id','position','label','dates_json','created_at','updated_at','deleted_at'], json: { dates_json: 'dates' }, order: 'trip_id,position,id' },
  stops: { path: 'data/stops.json', table: 'stops', columns: ['id','vault_id','trip_id','place_id','day_id','position','kind','visit_confirmed','detail_certainty','source','dates_json','note','lodging_label','checkout_dates_json','created_at','updated_at','deleted_at','deleted_by_trip'], json: { dates_json: 'dates', checkout_dates_json: 'checkout_dates' }, booleans: ['visit_confirmed','deleted_by_trip'], order: 'trip_id,position,id' },
  media: { path: 'data/media.json', table: 'media', columns: ['id','vault_id','sha256','byte_size','mime_type','extension','width','height','original_filename','source_fidelity','source_metadata_json','capture_override_json','location_override_json','parser_version','created_at','updated_at','deleted_at'], json: { source_metadata_json: 'source_metadata', capture_override_json: 'capture_override', location_override_json: 'location_override' }, order: 'id' },
  trip_media: { path: 'data/trip-media.json', table: 'trip_media', columns: ['id','vault_id','trip_id','media_id','day_id','stop_id','position','caption','is_favourite','created_at','updated_at','deleted_at','deleted_by_trip'], booleans: ['is_favourite','deleted_by_trip'], order: 'trip_id,position,id' },
  companions: { path: 'data/companions.json', table: 'companions', columns: ['id','vault_id','label','note','created_at','updated_at','deleted_at'], order: 'id' },
  trip_companions: { path: 'data/trip-companions.json', table: 'trip_companions', columns: ['id','vault_id','trip_id','companion_id','created_at','updated_at','deleted_at','deleted_by_trip','deleted_by_companion'], booleans: ['deleted_by_trip','deleted_by_companion'], order: 'trip_id,companion_id,id' },
  chapters: { path: 'data/chapters.json', table: 'chapters', columns: ['id','vault_id','name','normalized_name','description','position','created_at','updated_at','deleted_at'], order: 'position,id' },
  trip_chapters: { path: 'data/trip-chapters.json', table: 'trip_chapters', columns: ['id','vault_id','trip_id','chapter_id','position','created_at','updated_at','deleted_at','deleted_by_trip','deleted_by_chapter'], booleans: ['deleted_by_trip','deleted_by_chapter'], order: 'trip_id,position,id' },
  dream_destinations: { path: 'data/dreams.json', table: 'dream_destinations', columns: ['id','vault_id','place_id','added_dates_json','note','location_text','is_archived','created_at','updated_at','deleted_at'], json: { added_dates_json: 'added_dates' }, booleans: ['is_archived'], order: 'id' },
  dream_visits: { path: 'data/dream-visits.json', table: 'dream_visits', columns: ['id','vault_id','dream_id','stop_id','linked_at','created_at','updated_at','deleted_at','deleted_by_dream','deleted_by_stop'], booleans: ['deleted_by_dream','deleted_by_stop'], order: 'dream_id,linked_at,id' },
  reconstruction_history: { path: 'data/reconstruction-history.json', table: 'draft_suggestions', columns: ['id','vault_id','trip_id','run_id','kind','payload_json','evidence_json','algorithm_version','state','resolution_json','created_at','updated_at'], json: { payload_json: 'payload', evidence_json: 'evidence', resolution_json: 'resolution' }, order: "CASE WHEN kind='run' THEN 0 ELSE 1 END,created_at,id", where: "AND (state!='pending' OR (kind='run' AND EXISTS(SELECT 1 FROM draft_suggestions child WHERE child.run_id=draft_suggestions.id AND child.state!='pending')))" },
} as const satisfies Record<string, EntitySpec>;

const names = Object.keys(entitySpecs) as EntityName[];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

export class ArchiveValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ArchiveValidationError'; }
}

function fail(message: string): never { throw new ArchiveValidationError(message); }
function object(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Row;
}
function safePath(path: unknown): string {
  if (typeof path !== 'string' || !path.length || path.length > 240 || path.startsWith('/') || path.startsWith('\\')
    || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')
    || /^[a-zA-Z]:/.test(path)) fail('Archive contains an unsafe path');
  return path;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Row).sort().map(key => [key, stable((value as Row)[key])]));
  return value;
}
export function stableJson(value: unknown): string { return `${JSON.stringify(stable(value), null, 2)}\n`; }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function sqlValue(row: Row, key: string): SqlValue {
  const value=row[key];
  if(value===null||typeof value==='string'||typeof value==='number'||value instanceof Uint8Array)return value;
  return fail(`Invalid SQL value for ${key}`);
}
function exportKey(spec: EntitySpec, column: string): string { return spec.json?.[column] ?? column; }

function encodeRow(spec: EntitySpec, row: Row): Row {
  const result: Row = {};
  for (const column of spec.columns) {
    const key = exportKey(spec, column); const value = row[column];
    if (spec.json?.[column]) result[key] = value === null ? null : JSON.parse(String(value));
    else if (spec.booleans?.includes(column)) result[key] = value === 1;
    else result[key] = value;
  }
  return result;
}

function decodeRow(spec: EntitySpec, record: Row): SqlValue[] {
  const expected = spec.columns.map(column => exportKey(spec, column)).sort();
  const actual = Object.keys(record).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) fail(`Unexpected fields in ${spec.path}`);
  return spec.columns.map(column => {
    const value = record[exportKey(spec, column)];
    if (spec.json?.[column]) return value === null ? null : JSON.stringify(value);
    if (spec.booleans?.includes(column)) {
      if (typeof value !== 'boolean') fail(`${spec.path}.${column} must be boolean`);
      return Number(value);
    }
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') fail(`${spec.path}.${column} has an invalid value`);
    return value;
  });
}

type OriginalRow = { id: string; sha256: string; byte_size: number; extension: string; relative_path: string | null; state: string | null };
async function snapshot(database: LocalDatabase, vaultId: string): Promise<{data: Record<EntityName, Row[]>; originals: OriginalRow[]}> {
  return database.run(async connection => {
    await connection.execAsync('BEGIN');
    try {
      const result = {} as Record<EntityName, Row[]>;
      for (const name of names) {
        const spec: EntitySpec = entitySpecs[name];
        const rows = await connection.getAllAsync<Row>(`SELECT ${spec.columns.join(',')} FROM ${spec.table} WHERE ${name === 'vaults' ? 'id' : 'vault_id'}=? ${spec.where ?? ''} ORDER BY ${spec.order ?? 'id'}`, vaultId);
        result[name] = rows.map(row => encodeRow(spec, row));
      }
      const originals=await connection.getAllAsync<OriginalRow>(`SELECT m.id,m.sha256,m.byte_size,m.extension,f.relative_path,f.state FROM media m
        LEFT JOIN local_media_files f ON f.media_id=m.id AND f.vault_id=m.vault_id AND f.variant='original'
        WHERE m.vault_id=? ORDER BY m.id`,vaultId);
      await connection.execAsync('COMMIT');
      return {data:result,originals};
    } catch (error) { await connection.execAsync('ROLLBACK'); throw error; }
  });
}

async function addText(io: ArchiveIO, root: string, files: ArchiveFileEntry[], path: string, value: string, kind: FileKind): Promise<void> {
  safePath(path); const bytes = byteLength(value);
  await io.writeText(root, path, value);
  files.push({ path, sha256: await io.sha256Text(value), bytes, kind });
}

function humanDate(value: unknown): string {
  try {
    const date = parseDateSpec(value); const start = date.start;
    if (start.precision === 'unknown') return 'Date unknown';
    return `${date.certainty === 'approximate' ? '~' : ''}${start.value}`;
  } catch { return 'Date unknown'; }
}
function escapeHtml(value: unknown): string { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!)); }

function journal(data: Record<EntityName, Row[]>): string {
  const places = new Map(data.places.map(row => [row.id, row]));
  const stops = new Map<string, Row[]>();
  for (const stop of data.stops) stops.set(String(stop.trip_id), [...(stops.get(String(stop.trip_id)) ?? []), stop]);
  const sections = data.trips.map(trip => `<section><h2>${escapeHtml(trip.title)}</h2><p>${escapeHtml(humanDate(trip.dates))}${trip.deleted_at ? ' · In trash' : ''} · ${escapeHtml(trip.status)}</p><ol>${(stops.get(String(trip.id)) ?? []).map(stop => `<li>${escapeHtml(places.get(stop.place_id)?.name ?? 'Unknown place')} · ${escapeHtml(stop.kind)} · ${escapeHtml(stop.dates ? humanDate(stop.dates) : 'Date inherited from trip')}${stop.deleted_at ? ' · Removed' : ''}</li>`).join('')}</ol></section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Trip Memory Vault</title><style>body{font:16px system-ui;line-height:1.5;max-width:900px;margin:auto;padding:2rem;color:#17283b}section{border-top:1px solid #ccd5df;padding:1rem 0}small{color:#556}</style><h1>${escapeHtml(data.vaults[0]?.name ?? 'Trip Memory Vault')}</h1><p>This journal is a readable view. The versioned JSON files are authoritative for restore.</p>${sections}</html>`;
}

function routes(data: Record<EntityName, Row[]>): Row {
  const places = new Map(data.places.map(row => [row.id, row]));
  const features: Row[] = [];
  for (const trip of data.trips) {
    let segment: number[][] = [];
    const flush = () => { if (segment.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: segment }, properties: { trip_id: trip.id, trip_title: trip.title, meaning: 'confirmed stop sequence; not travelled roads' } }); segment = []; };
    for (const stop of data.stops.filter(row => row.trip_id === trip.id && row.deleted_at === null && row.visit_confirmed === true)) {
      const place = places.get(stop.place_id);
      if (!place || place.deleted_at !== null || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') { flush(); continue; }
      const coordinate = [place.longitude, place.latitude] as number[];
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coordinate }, properties: { trip_id: trip.id, stop_id: stop.id, place_id: place.id, name: place.name, position: stop.position } });
      segment.push(coordinate);
    }
    flush();
  }
  return { type: 'FeatureCollection', features };
}

export type ExportResult = { packageName: string; manifest: PortableManifest; root: string };
export async function createPortableExport(input: { database: LocalDatabase; vaultId: string; io: ArchiveIO; mediaFiles: MediaFiles; stagingRoot: string; now?: () => string }): Promise<ExportResult> {
  const now = input.now?.() ?? new Date().toISOString();
  const {data,originals}=await snapshot(input.database,input.vaultId);
  if (data.vaults.length !== 1 || data.vaults[0].deleted_at !== null) fail('Export requires one active vault');
  if (originals.length !== data.media.length) fail('Every Media record must have one registered original');
  await input.io.createRoot(input.stagingRoot);
  const files: ArchiveFileEntry[] = [];
  try {
    for (const name of names) await addText(input.io, input.stagingRoot, files, entitySpecs[name].path,
      stableJson({ entity: name, format_version: PORTABLE_FORMAT_VERSION, records: data[name] }), 'data');
    await addText(input.io, input.stagingRoot, files, 'README.txt', 'Trip Memory Vault portable export\n\nOpen journal/index.html for a readable view. JSON under data/ is authoritative. Original media is byte-preserved under media/originals/. Do not edit files if you intend to restore this package.\n', 'documentation');
    await addText(input.io, input.stagingRoot, files, 'schemas/v1/README.txt', 'Format v1 uses UTF-8 JSON. IDs and null values are preserved. DateSpec values remain structured objects. Every file except manifest.json and COMPLETE.json is listed in manifest.files with its SHA-256 and byte length.\n', 'schema');
    await addText(input.io, input.stagingRoot, files, 'journal/index.html', journal(data), 'journal');
    await addText(input.io, input.stagingRoot, files, 'routes/routes.geojson', stableJson(routes(data)), 'route');
    for (const asset of originals) {
      if (!asset.relative_path || asset.state !== 'available' || !await input.mediaFiles.verify(asset.relative_path, asset.sha256, asset.byte_size)) fail(`Original media ${asset.id} is missing or does not match its stored SHA-256`);
      const path = portableMediaPath(asset.sha256);
      await input.io.copyFromUri(input.mediaFiles.uri(asset.relative_path), input.stagingRoot, path);
      if (!await input.io.verifyFile(input.stagingRoot, path, asset.sha256, asset.byte_size)) fail(`Copied original media ${asset.id} failed verification`);
      files.push({ path, sha256: asset.sha256, bytes: asset.byte_size, kind: 'media-original' });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const counts = Object.fromEntries(names.map(name => [name, data[name].length])) as ArchiveCounts;
    const manifest: PortableManifest = {
      export_format: PORTABLE_FORMAT, format_version: PORTABLE_FORMAT_VERSION, created_at: now,
      app_version: APP_VERSION, schema_version: migrations.length,
      vault: { id: String(data.vaults[0].id), name: String(data.vaults[0].name), format_version: Number(data.vaults[0].format_version) },
      counts, media_count: data.media.length, total_media_bytes: originals.reduce((sum, media) => sum + media.byte_size, 0),
      checksum_algorithm: 'SHA-256',
      capabilities: { original_media: true, tombstones: true, resolved_reconstruction_history: true, regenerable_derivatives_omitted: true }, files,
    };
    const manifestText = stableJson(manifest);
    await input.io.writeText(input.stagingRoot, 'manifest.json', manifestText);
    await input.io.writeText(input.stagingRoot, 'COMPLETE.json', stableJson({ manifest_sha256: await input.io.sha256Text(manifestText) }));
    const day = now.slice(0, 10); const packageName = `Trip-Memory-Vault-${day}-${manifest.vault.id.slice(0, 8)}`;
    return { packageName, manifest, root: input.stagingRoot };
  } catch (error) { try { await input.io.removeRoot(input.stagingRoot); } catch { /* original export failure wins */ } throw error; }
}

export async function publishPortableExport(io: ArchiveIO, stagingRoot: string, destinationRoot: string): Promise<void> {
  await io.copyTree(stagingRoot, destinationRoot);
  const inspected = await readAndVerify(io, destinationRoot);
  if (!inspected.manifest.files.every(file => file.kind !== 'media-original' || hashPattern.test(file.sha256))) fail('Published archive verification failed');
}

type VerifiedArchive = { manifest: PortableManifest; data: Record<EntityName, Row[]> };
function parseJson(text: string, label: string): unknown { try { return JSON.parse(text); } catch { fail(`${label} contains malformed JSON`); } }

async function readAndVerify(io: ArchiveIO, root: string): Promise<VerifiedArchive> {
  if (!await io.exists(root, 'manifest.json') || !await io.exists(root, 'COMPLETE.json')) fail('Archive is incomplete: manifest.json or COMPLETE.json is missing');
  const manifestBytes=await io.size(root,'manifest.json'); const completionBytes=await io.size(root,'COMPLETE.json');
  if(manifestBytes<1||manifestBytes>MAX_JSON_BYTES||completionBytes<1||completionBytes>1024*1024)fail('Archive manifest or completion marker has an invalid size');
  const manifestText = await io.readText(root, 'manifest.json');
  if (byteLength(manifestText) > MAX_JSON_BYTES) fail('Manifest is too large');
  const raw = object(parseJson(manifestText, 'manifest.json'), 'manifest.json');
  if (raw.export_format !== PORTABLE_FORMAT) fail('This is not a Trip Memory Vault export');
  if (raw.format_version !== PORTABLE_FORMAT_VERSION) fail(`Unsupported export format version: ${String(raw.format_version)}`);
  if(!Number.isSafeInteger(raw.schema_version)||Number(raw.schema_version)<1||Number(raw.schema_version)>migrations.length)fail(`Unsupported archive schema version: ${String(raw.schema_version)}`);
  if (!uuidPattern.test(String(object(raw.vault, 'manifest.vault').id))) fail('Manifest vault ID is invalid');
  if (!Array.isArray(raw.files)) fail('Manifest files list is missing');
  const completion = object(parseJson(await io.readText(root, 'COMPLETE.json'), 'COMPLETE.json'), 'COMPLETE.json');
  if (completion.manifest_sha256 !== await io.sha256Text(manifestText)) fail('Manifest checksum mismatch');
  const seen = new Set<string>(); let total = 0;
  const files: ArchiveFileEntry[] = raw.files.map((item, index) => {
    const row = object(item, `manifest.files[${index}]`); const path = safePath(row.path);
    if (seen.has(path)) fail(`Duplicate archive path: ${path}`); seen.add(path);
    if (!hashPattern.test(String(row.sha256))) fail(`Invalid checksum for ${path}`);
    if (!Number.isSafeInteger(row.bytes) || Number(row.bytes) < 0 || Number(row.bytes) > MAX_ARCHIVE_BYTES) fail(`Invalid byte size for ${path}`);
    if (!['data','media-original','documentation','schema','journal','route'].includes(String(row.kind))) fail(`Invalid file kind for ${path}`);
    total += Number(row.bytes); if (total > MAX_ARCHIVE_BYTES) fail('Archive declared size is too large');
    return { path, sha256: String(row.sha256), bytes: Number(row.bytes), kind: row.kind as FileKind };
  });
  for (const name of names) if (!seen.has(entitySpecs[name].path)) fail(`Required file is missing: ${entitySpecs[name].path}`);
  for (const file of files) {
    if (!await io.exists(root, file.path)) fail(`Archive file is missing: ${file.path}`);
    if (!await io.verifyFile(root, file.path, file.sha256, file.bytes)) fail(`Checksum mismatch: ${file.path}`);
  }
  const data = {} as Record<EntityName, Row[]>;
  for (const name of names) {
    const spec = entitySpecs[name]; const entry = files.find(file => file.path === spec.path)!;
    if (entry.bytes > MAX_JSON_BYTES) fail(`${spec.path} is too large`);
    const envelope = object(parseJson(await io.readText(root, spec.path), spec.path), spec.path);
    if (envelope.entity !== name || envelope.format_version !== PORTABLE_FORMAT_VERSION || !Array.isArray(envelope.records)) fail(`${spec.path} has an invalid envelope`);
    if (envelope.records.length > MAX_RECORDS) fail(`${spec.path} contains too many records`);
    data[name] = envelope.records.map((record, index) => object(record, `${spec.path}.records[${index}]`));
  }
  const manifest = raw as unknown as PortableManifest; manifest.files = files;
  validateData(manifest, data);
  return { manifest, data };
}

function ids(rows: Row[], label: string): Set<string> {
  const result = new Set<string>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== 'string' || !uuidPattern.test(id)) fail(`${label} contains an invalid ID`);
    if (result.has(id)) fail(`${label} contains duplicate ID ${id}`);
    result.add(id);
  }
  return result;
}
function reference(rows: Row[], field: string, parent: Set<string>, label: string, optional = false): void {
  for (const row of rows) {
    const value = row[field]; if (optional && value === null) continue;
    if (typeof value !== 'string' || !parent.has(value)) fail(`Broken reference ${label}.${field}`);
  }
}
function uniqueActive(rows: Row[], fields: string[], label: string): void {
  const seen=new Set<string>();
  for(const row of rows){if(row.deleted_at!==null)continue;const key=fields.map(field=>String(row[field])).join('\u0000');if(seen.has(key))fail(`Duplicate active ${label}`);seen.add(key);}
}
function validateData(manifest: PortableManifest, data: Record<EntityName, Row[]>): void {
  if (data.vaults.length !== 1 || data.vaults[0].id !== manifest.vault.id || data.vaults[0].deleted_at !== null) fail('Archive must contain exactly one active matching vault');
  const vaultId = manifest.vault.id;
  for (const name of names) {
    if (manifest.counts?.[name] !== data[name].length) fail(`Manifest count mismatch for ${name}`);
    const spec = entitySpecs[name];
    for (const row of data[name]) {
      decodeRow(spec, row);
      if (name !== 'vaults' && row.vault_id !== vaultId) fail(`${spec.path} crosses vault boundaries`);
    }
  }
  const tripIds=ids(data.trips,'trips'), placeIds=ids(data.places,'places'), dayIds=ids(data.trip_days,'trip_days'), stopIds=ids(data.stops,'stops');
  const mediaIds=ids(data.media,'media'), companionIds=ids(data.companions,'companions'), chapterIds=ids(data.chapters,'chapters');
  const dreamIds=ids(data.dream_destinations,'dream_destinations'), suggestionIds=ids(data.reconstruction_history,'reconstruction_history');
  ids(data.vaults,'vaults'); ids(data.trip_media,'trip_media'); ids(data.trip_companions,'trip_companions'); ids(data.trip_chapters,'trip_chapters'); ids(data.dream_visits,'dream_visits');
  reference(data.trip_days,'trip_id',tripIds,'trip_days');
  reference(data.stops,'trip_id',tripIds,'stops'); reference(data.stops,'place_id',placeIds,'stops'); reference(data.stops,'day_id',dayIds,'stops',true);
  reference(data.trip_media,'trip_id',tripIds,'trip_media'); reference(data.trip_media,'media_id',mediaIds,'trip_media'); reference(data.trip_media,'day_id',dayIds,'trip_media',true); reference(data.trip_media,'stop_id',stopIds,'trip_media',true);
  reference(data.trip_companions,'trip_id',tripIds,'trip_companions'); reference(data.trip_companions,'companion_id',companionIds,'trip_companions');
  reference(data.trip_chapters,'trip_id',tripIds,'trip_chapters'); reference(data.trip_chapters,'chapter_id',chapterIds,'trip_chapters');
  reference(data.dream_destinations,'place_id',placeIds,'dream_destinations');
  reference(data.dream_visits,'dream_id',dreamIds,'dream_visits'); reference(data.dream_visits,'stop_id',stopIds,'dream_visits');
  reference(data.reconstruction_history,'trip_id',tripIds,'reconstruction_history'); reference(data.reconstruction_history,'run_id',suggestionIds,'reconstruction_history',true);
  const days=new Map(data.trip_days.map(row=>[row.id,row])); const stops=new Map(data.stops.map(row=>[row.id,row])); const suggestions=new Map(data.reconstruction_history.map(row=>[row.id,row]));
  for(const stop of data.stops)if(stop.day_id!==null&&days.get(stop.day_id)?.trip_id!==stop.trip_id)fail('Stop section belongs to a different Trip');
  for(const placement of data.trip_media){
    if(placement.day_id!==null&&days.get(placement.day_id)?.trip_id!==placement.trip_id)fail('Photo section belongs to a different Trip');
    if(placement.stop_id!==null){const stop=stops.get(placement.stop_id);if(!stop||stop.trip_id!==placement.trip_id||!(stop.day_id===null||stop.day_id===placement.day_id))fail('Photo Stop context is inconsistent');}
  }
  for(const suggestion of data.reconstruction_history)if(suggestion.run_id!==null){const run=suggestions.get(suggestion.run_id);if(run?.kind!=='run'||run.trip_id!==suggestion.trip_id)fail('Reconstruction history has an invalid parent run');}
  uniqueActive(data.trip_days,['trip_id','position'],'Trip section position'); uniqueActive(data.stops,['trip_id','position'],'Stop position');
  uniqueActive(data.trip_media,['trip_id','media_id'],'Trip photo relationship'); uniqueActive(data.trip_companions,['trip_id','companion_id'],'Trip Companion relationship');
  uniqueActive(data.trip_chapters,['trip_id','chapter_id'],'Trip Chapter relationship'); uniqueActive(data.dream_destinations,['vault_id','place_id'],'Dream Place relationship');
  uniqueActive(data.dream_visits,['dream_id','stop_id'],'Dream visit relationship');
  for (const row of [...data.trips.map(r=>r.dates), ...data.trip_days.map(r=>r.dates).filter(Boolean), ...data.stops.flatMap(r=>[r.dates,r.checkout_dates]).filter(Boolean), ...data.dream_destinations.map(r=>r.added_dates)]) parseDateSpec(row);
  const mediaPaths = new Set<string>();
  for (const media of data.media) {
    if (!hashPattern.test(String(media.sha256)) || !Number.isSafeInteger(media.byte_size) || Number(media.byte_size) < 1 || Number(media.byte_size) > 104857600 || !['jpg','png'].includes(String(media.extension))) fail('Media metadata is invalid');
    const path=portableMediaPath(String(media.sha256)); if(mediaPaths.has(path)) fail('Media paths collide'); mediaPaths.add(path);
    const file=manifest.files.find(item=>item.path===path && item.kind==='media-original');
    if(!file || file.sha256!==media.sha256 || file.bytes!==media.byte_size) fail(`Original media entry is missing for ${String(media.id)}`);
  }
  for(const name of names)if(manifest.files.find(item=>item.path===entitySpecs[name].path)?.kind!=='data')fail(`Invalid file kind for ${entitySpecs[name].path}`);
  if(manifest.files.filter(item=>item.kind==='media-original').length!==data.media.length)fail('Archive contains unexpected original media entries');
  if (manifest.media_count !== data.media.length || manifest.total_media_bytes !== data.media.reduce((sum,row)=>sum+Number(row.byte_size),0)) fail('Manifest media summary mismatch');
}

export type RestoreInspection = { manifest: PortableManifest; summary: { trips: number; places: number; photos: number; totalMediaBytes: number }; token: string };
export async function inspectPortableRestore(io: ArchiveIO, root: string): Promise<RestoreInspection> {
  const verified = await readAndVerify(io, root);
  return { manifest: verified.manifest, summary: { trips: verified.data.trips.length, places: verified.data.places.length, photos: verified.data.media.length, totalMediaBytes: verified.manifest.total_media_bytes }, token: await io.sha256Text(stableJson(verified.manifest)) };
}

async function assertEmpty(connection: SqlConnection, currentVaultId: string): Promise<void> {
  const tables = names.filter(name => name !== 'vaults').map(name => entitySpecs[name].table).filter((value,index,array)=>array.indexOf(value)===index);
  for (const table of [...tables,'import_batches','import_items','local_media_files']) {
    const row=await connection.getFirstAsync<{count:number}>(`SELECT count(*) count FROM ${table} WHERE vault_id=?`,currentVaultId);
    if ((row?.count ?? 0) !== 0) fail('Restore requires a fresh, empty vault; existing archive data was not changed');
  }
}

async function insertRows(connection: SqlConnection, name: EntityName, rows: Row[], transform?: (row: Row) => Row): Promise<void> {
  const spec=entitySpecs[name]; const placeholders=spec.columns.map(()=>'?').join(',');
  for(const original of rows){const row=transform?.(original)??original;await connection.runAsync(`INSERT INTO ${spec.table}(${spec.columns.join(',')}) VALUES(${placeholders})`,...decodeRow(spec,row));}
}
function patched(row: Row, changes: Row): Row { return {...row,...changes}; }

export async function restorePortableArchive(input: { database: LocalDatabase; currentVaultId: string; io: ArchiveIO; archiveRoot: string; destinationMedia: MediaFiles; newStagingId: () => string }): Promise<{ vaultId: string }> {
  const verified=await readAndVerify(input.io,input.archiveRoot); const archiveId=verified.manifest.vault.id;
  await input.database.run(connection=>assertEmpty(connection,input.currentVaultId));
  const created: string[]=[]; const staging: string[]=[];
  try {
    for(const media of verified.data.media){
      const final=mediaPath(String(media.sha256),String(media.extension)); const portable=portableMediaPath(String(media.sha256));
      if(await input.destinationMedia.exists(final)){
        if(!await input.destinationMedia.verify(final,String(media.sha256),Number(media.byte_size))) fail(`Existing original conflicts with ${String(media.id)}`);
        continue;
      }
      const temporary=`staging/${input.newStagingId()}.part`; staging.push(temporary);
      await input.destinationMedia.copy(input.io.fileUri(input.archiveRoot,portable),temporary);
      if(!await input.destinationMedia.verify(temporary,String(media.sha256),Number(media.byte_size))) fail(`Staged original failed verification: ${String(media.id)}`);
      await input.destinationMedia.publish(temporary,final,String(media.sha256),Number(media.byte_size)); created.push(final);
    }
    await input.database.transaction(async connection=>{
      await assertEmpty(connection,input.currentVaultId);
      const vault=verified.data.vaults[0];
      if(archiveId===input.currentVaultId) await connection.runAsync('UPDATE vaults SET name=?,format_version=?,created_at=?,updated_at=?,deleted_at=NULL WHERE id=?',String(vault.name),Number(vault.format_version),String(vault.created_at),String(vault.updated_at),archiveId);
      else { await connection.runAsync('DELETE FROM vaults WHERE id=?',input.currentVaultId); await insertRows(connection,'vaults',[vault]); }
      await insertRows(connection,'trips',verified.data.trips,row=>patched(row,{deleted_at:null}));
      await insertRows(connection,'places',verified.data.places,row=>patched(row,{deleted_at:null}));
      await insertRows(connection,'trip_days',verified.data.trip_days);
      await insertRows(connection,'stops',verified.data.stops);
      await insertRows(connection,'media',verified.data.media,row=>patched(row,{deleted_at:null}));
      for(const media of verified.data.media) await connection.runAsync(`INSERT INTO local_media_files(media_id,vault_id,variant,relative_path,state,bytes,pinned,last_access_at,checksum,recipe_version,width,height) VALUES(?,?,'original',?,'available',?,1,?,?,NULL,?,?)`,sqlValue(media,'id'),archiveId,mediaPath(String(media.sha256),String(media.extension)),sqlValue(media,'byte_size'),sqlValue(media,'updated_at'),sqlValue(media,'sha256'),sqlValue(media,'width'),sqlValue(media,'height'));
      await insertRows(connection,'trip_media',verified.data.trip_media);
      await insertRows(connection,'companions',verified.data.companions,row=>patched(row,{deleted_at:null}));
      await insertRows(connection,'trip_companions',verified.data.trip_companions);
      await insertRows(connection,'chapters',verified.data.chapters,row=>patched(row,{deleted_at:null}));
      await insertRows(connection,'trip_chapters',verified.data.trip_chapters);
      await insertRows(connection,'dream_destinations',verified.data.dream_destinations,row=>patched(row,{deleted_at:null,is_archived:false}));
      await insertRows(connection,'dream_visits',verified.data.dream_visits);
      await insertRows(connection,'reconstruction_history',verified.data.reconstruction_history);
      for(const row of verified.data.dream_destinations) await connection.runAsync('UPDATE dream_destinations SET is_archived=?,deleted_at=? WHERE id=? AND vault_id=?',Number(row.is_archived),sqlValue(row,'deleted_at'),sqlValue(row,'id'),archiveId);
      for(const row of verified.data.media) if(row.deleted_at!==null) await connection.runAsync('UPDATE media SET deleted_at=? WHERE id=? AND vault_id=?',sqlValue(row,'deleted_at'),sqlValue(row,'id'),archiveId);
      for(const row of verified.data.companions) if(row.deleted_at!==null) await connection.runAsync('UPDATE companions SET deleted_at=? WHERE id=? AND vault_id=?',sqlValue(row,'deleted_at'),sqlValue(row,'id'),archiveId);
      for(const row of verified.data.chapters) if(row.deleted_at!==null) await connection.runAsync('UPDATE chapters SET deleted_at=? WHERE id=? AND vault_id=?',sqlValue(row,'deleted_at'),sqlValue(row,'id'),archiveId);
      for(const row of verified.data.places) if(row.deleted_at!==null) await connection.runAsync('UPDATE places SET deleted_at=? WHERE id=? AND vault_id=?',sqlValue(row,'deleted_at'),sqlValue(row,'id'),archiveId);
      for(const row of verified.data.trips) if(row.deleted_at!==null) await connection.runAsync('UPDATE trips SET deleted_at=? WHERE id=? AND vault_id=?',sqlValue(row,'deleted_at'),sqlValue(row,'id'),archiveId);
      const foreign=await connection.getAllAsync('PRAGMA foreign_key_check'); if(foreign.length) fail('Restored archive failed foreign-key verification');
    });
    for(const path of staging) try{await input.destinationMedia.removeStaging(path);}catch{/* completed originals remain authoritative */}
    return {vaultId:archiveId};
  } catch(error) {
    for(const path of staging) try{await input.destinationMedia.removeStaging(path);}catch{/* best effort */}
    // Created originals are content-addressed, unreferenced, and safe if a process dies here.
    // They are reused only after a future restore verifies their full SHA-256 and byte count.
    void created;
    throw error;
  }
}

export async function archiveOverview(database: LocalDatabase, vaultId: string): Promise<{trips:number;places:number;photos:number;bytes:number}> {
  return database.run(async connection=>{
    const row=await connection.getFirstAsync<{trips:number;places:number;photos:number;bytes:number}>(`SELECT
      (SELECT count(*) FROM trips WHERE vault_id=?) trips,
      (SELECT count(*) FROM places WHERE vault_id=?) places,
      (SELECT count(*) FROM media WHERE vault_id=?) photos,
      (SELECT coalesce(sum(byte_size),0) FROM media WHERE vault_id=?) bytes`,vaultId,vaultId,vaultId,vaultId);
    return row!;
  });
}
