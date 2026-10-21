import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';
import { configureConnection, LocalDatabase } from '../../src/core/database/database';
import { migrateDatabase, migrations } from '../../src/core/database/migrate';
import { openVaultDatabase, sqliteMigrationServices, vaultSQLiteOptions } from '../../src/core/database/open';
import { getOrCreateVault } from '../../src/core/database/vault';
import { nativeMediaFiles } from '../../src/core/media/native-adapter';
import { TripRepository } from '../../src/features/trips/repository';
import { MediaRepository } from '../../src/features/media/repository';
import { ImportPipeline } from '../../src/services/import/pipeline';
import { createPortableExport, inspectPortableRestore, publishPortableExport, restorePortableArchive } from '../../src/services/archive/portable';
import { nativeArchiveIO } from '../../src/services/archive/native';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const checkpoint = () => new File(Paths.document, 'final-qa-checkpoint.json');
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));

export async function runFinalNativeAudit() {
  // No production filename, external vault or reset operation is accepted.
  const id = randomUUID(), sourceName = `final-qa-source-${id}.sqlite`;
  const connection = await openDatabaseAsync(sourceName, vaultSQLiteOptions);
  await configureConnection(connection);
  const database = new LocalDatabase(connection);
  const services = sqliteMigrationServices(connection, sourceName);
  await migrateDatabase(database, services, migrations.slice(0, 11));
  const vault = await getOrCreateVault(database, randomUUID);
  const trips = new TripRepository(database, vault.id, randomUUID);
  const trip = await trips.createTripDraft({ title: 'FINAL-QA synthetic trip' });
  let rolledBack = false;
  try {
    await migrateDatabase(database, services, [...migrations.slice(0, 11), {
      version: 12, sql: "UPDATE trips SET title='must roll back'; INSERT INTO missing_table VALUES(1);",
    }]);
  } catch { rolledBack = true; }
  check(rolledBack && (await trips.getTripById(trip.id))?.title === trip.title, 'Native migration rollback lost data');
  await migrateDatabase(database, services);
  await database.close();
  const source = await openVaultDatabase(sourceName);
  check((await source.trips.getTripById(trip.id))?.dates.certainty === 'unknown', 'Migration changed unknown history');
  await source.trips.updateBasicTripFields(trip.id, { title: 'FINAL-QA edited synthetic trip', status: 'saved' });
  const day = await source.timeline.createTripDay(trip.id, { label: 'Undated section' });
  const place = await source.routes.createPlace({ name: 'Synthetic stay', latitude: 31, longitude: 77, coordinatePrecision: 'point' });
  const stop = await source.routes.addStop(trip.id, { placeId: place.id, kind: 'stay', lodgingLabel: 'Synthetic lodging' });
  await source.timeline.assignStop(trip.id, stop.id, day.id);
  const second = await source.routes.createPlace({ name: 'Synthetic second stop', latitude: 32, longitude: 78, coordinatePrecision: 'point' });
  await source.routes.addStop(trip.id, { placeId: second.id });
  const photo = new File(Paths.cache, `final-qa-${id}.png`); photo.write(png);
  const media = new MediaRepository(source.database, source.vault.id, randomUUID);
  const files = nativeMediaFiles(source.vault.id), pipeline = new ImportPipeline(media, files);
  await media.select(trip.id, [{ uri: photo.uri, filename: 'synthetic.png' }]);
  await pipeline.run();
  const asset = (await media.assets())[0]; check(asset, 'Native photo import failed');
  const evidence = await source.database.run(c => c.getFirstAsync('SELECT source_metadata_json FROM media WHERE id=?', asset.id));
  const pin = await source.photoMemories.save(trip.id, { mediaId: asset.id, coordinate: [0, 0], note: 'Synthetic note' });
  await source.photoMemories.save(trip.id, { mediaId: asset.id, coordinate: [77.5, 31.5], note: 'Edited synthetic note' }, pin);
  const removed = await source.photoMemories.save(trip.id, { mediaId: asset.id, coordinate: [180, 90], note: null });
  await source.photoMemories.remove(trip.id, removed);
  check((await source.photoMemories.list(trip.id)).length === 1, 'Pin removal failed');
  check(JSON.stringify(evidence) === JSON.stringify(await source.database.run(c => c.getFirstAsync('SELECT source_metadata_json FROM media WHERE id=?', asset.id))), 'Pin changed source evidence');
  await source.trips.trashTrip(trip.id);
  check((await source.photoMemories.list(trip.id)).length === 0, 'Trash leaked pins');
  await source.trips.restoreTrip(trip.id);
  check((await source.photoMemories.list(trip.id)).length === 1, 'Trip restore lost pins');
  const io = nativeArchiveIO(), base = new Directory(Paths.document, `final-qa-${id}`);
  base.create();
  const stage = new Directory(base, 'stage').uri, archive = new Directory(base, 'archive').uri;
  const exported = await createPortableExport({ database: source.database, vaultId: vault.id, io, mediaFiles: files, stagingRoot: stage });
  check(exported.manifest.format_version === 3 && exported.manifest.counts.photo_memory_pins === 2, 'Incorrect v3 manifest');
  await io.createRoot(archive); await publishPortableExport(io, stage, archive);
  const original = exported.manifest.files.find(f => f.kind === 'media-original'); check(original, 'Original missing');
  // Delete only this run's synthetic media after closing its isolated database.
  await source.close();
  new Directory(Paths.document, 'vaults', vault.id).delete();
  const destinationName = `final-qa-restored-${id}.sqlite`, destination = await openVaultDatabase(destinationName);
  await restorePortableArchive({ database: destination.database, currentVaultId: destination.vault.id, io, archiveRoot: archive, destinationMedia: files, newStagingId: randomUUID });
  await destination.close();
  checkpoint().write(JSON.stringify({ destinationName, vaultId: vault.id, tripId: trip.id, pin, asset, archive }));
  await reopenFinalNativeAudit();
  const restored = await openVaultDatabase(destinationName);
  let refused = false;
  try { await restorePortableArchive({ database: restored.database, currentVaultId: vault.id, io, archiveRoot: archive, destinationMedia: files, newStagingId: randomUUID }); } catch { refused = true; }
  check(refused, 'Nonempty destination accepted');
  await restored.close();
  const corrupt = new Directory(base, 'corrupt').uri;
  await io.createRoot(corrupt); await io.copyTree(archive, corrupt);
  new File(io.fileUri(corrupt, original.path)).write('corrupted');
  refused = false; try { await inspectPortableRestore(io, corrupt); } catch { refused = true; }
  check(refused, 'Corrupted original accepted');
  for (const version of [1, 2]) {
    const legacy = new Directory(base, `legacy-${version}`).uri;
    await io.createRoot(legacy); await io.copyTree(archive, legacy);
    const manifest = JSON.parse(await io.readText(legacy, 'manifest.json'));
    manifest.format_version = version; manifest.schema_version = version === 1 ? 10 : 11;
    delete manifest.counts.photo_memory_pins;
    if (version === 1) delete manifest.counts.road_route_segments;
    manifest.files = manifest.files.filter((f: { path: string }) =>
      f.path !== 'data/photo-memory-pins.json' && (version !== 1 || f.path !== 'data/road-route-segments.json'));
    for (const entry of manifest.files) {
      if (entry.kind !== 'data') continue;
      const data = JSON.parse(await io.readText(legacy, entry.path)); data.format_version = version;
      const text = JSON.stringify(data) + '\n';
      await io.writeText(legacy, entry.path, text);
      entry.bytes = await io.size(legacy, entry.path); entry.sha256 = await io.sha256Text(text);
    }
    const text = JSON.stringify(manifest) + '\n';
    await io.writeText(legacy, 'manifest.json', text);
    await io.writeText(legacy, 'COMPLETE.json', JSON.stringify({ manifest_sha256: await io.sha256Text(text) }));
    const name = `final-qa-v${version}-${id}.sqlite`, target = await openVaultDatabase(name);
    await restorePortableArchive({ database: target.database, currentVaultId: target.vault.id, io, archiveRoot: legacy, destinationMedia: files, newStagingId: randomUUID });
    await target.close();
    const reopened = await openVaultDatabase(name);
    check((await reopened.photoMemories.list(trip.id)).length === 0, 'Legacy restore invented pins');
    check((await reopened.trips.getTripById(trip.id))?.dates.certainty === 'unknown', 'Legacy restore changed history');
    await reopened.close();
  }
  photo.delete();
  console.log('FINAL_QA native schema11-to12 and rollback; trip CRUD; stay; import; pin CRUD; v1/v2/v3 restore; corruption/nonempty rejection passed');
}

export async function reopenFinalNativeAudit() {
  check(checkpoint().exists, 'Run disposable suite first');
  const saved = JSON.parse(await checkpoint().text());
  const restored = await openVaultDatabase(saved.destinationName);
  try {
    check(restored.vault.id === saved.vaultId, 'Vault identity changed');
    check((await restored.trips.getTripById(saved.tripId))?.dates.certainty === 'unknown', 'Trip history changed');
    const pins = await restored.photoMemories.list(saved.tripId);
    check(pins.length === 1 && pins[0].id === saved.pin && pins[0].longitude === 77.5 && pins[0].latitude === 31.5, 'Pin reference/coordinates changed');
    check(await nativeMediaFiles(saved.vaultId).verify(saved.asset.relative_path, saved.asset.sha256, saved.asset.byte_size), 'Original checksum mismatch');
    await restored.database.run(async c => {
      check((await c.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check'))?.integrity_check === 'ok', 'SQLite integrity failed');
      check((await c.getAllAsync('PRAGMA foreign_key_check')).length === 0, 'Foreign keys failed');
      await c.runAsync("INSERT INTO search_fts(search_fts,rank) VALUES('integrity-check',1)");
      check((await c.getFirstAsync<{ n: number }>('SELECT count(*) n FROM road_route_segments'))?.n === 0, 'Unexpected persistent geometry');
    });
    check((await restored.timeline.listTripDays(saved.tripId)).length === 1, 'Timeline missing');
    const media = new MediaRepository(restored.database, saved.vaultId, randomUUID);
    const pipeline = new ImportPipeline(media, nativeMediaFiles(saved.vaultId)); await pipeline.run(true);
    check((await pipeline.gallery(saved.tripId))[0]?.thumbnail, 'Restored photo derivative missing');
  } finally { await restored.close(); }
}
