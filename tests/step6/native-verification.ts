import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { openVaultDatabase } from '../../src/core/database/open';
import { mediaService } from '../../src/features/media/service';
import { ReconstructionRepository } from '../../src/features/reconstruction/repository';
import { RULES } from '../../src/services/reconstruction/rules';
export async function seedReconstruction(){
 const store=await openVaultDatabase();const media=await mediaService();const trip=await store.trips.createTripDraft({title:'Step 6 synthetic reconstruction'});
 const names=['morning-a.jpg','morning-b.jpg','timestamp-only.jpg','later.jpg','unknown.jpg'];
 await media.repository.select(trip.id,names.map(filename=>({filename,uri:new File(Paths.document,'step6-corpus',filename).uri})));await media.run();
 const items=await media.repository.items(trip.id);if(items.length!==5||items.some(i=>i.state!=='archived'))throw Error(JSON.stringify(items));
 const rows=await store.database.run(c=>c.getAllAsync(`SELECT m.id,m.source_metadata_json,m.sha256,m.capture_override_json,m.location_override_json FROM media m JOIN trip_media p ON p.media_id=m.id WHERE p.trip_id=? ORDER BY m.id`,trip.id));
 const state={tripId:trip.id,evidence:rows};new File(Paths.document,'step6-runtime.json').write(JSON.stringify(state));return trip.id;
}
export async function auditReconstruction(){
 const saved=JSON.parse(await new File(Paths.document,'step6-runtime.json').text());const store=await openVaultDatabase();
 const rows=await store.database.run(c=>c.getAllAsync(`SELECT m.id,m.source_metadata_json,m.sha256,m.capture_override_json,m.location_override_json FROM media m JOIN trip_media p ON p.media_id=m.id WHERE p.trip_id=? ORDER BY m.id`,saved.tripId));
 if(JSON.stringify(rows)!==JSON.stringify(saved.evidence))throw Error('Source evidence changed');
 const counts=()=>store.database.run(async c=>({days:await c.getAllAsync('SELECT * FROM trip_days WHERE trip_id=?',saved.tripId),stops:await c.getAllAsync('SELECT * FROM stops WHERE trip_id=?',saved.tripId),photos:await c.getAllAsync('SELECT id,day_id,stop_id FROM trip_media WHERE trip_id=? ORDER BY id',saved.tripId)}));
 const before=await counts();const repo=new ReconstructionRepository(store.database,store.vault.id,randomUUID);const decisions=await repo.list(saved.tripId);
 if(!decisions.some(s=>s.kind==='section'&&s.state==='accepted')||!decisions.some(s=>s.kind==='location'&&s.state==='accepted')||!decisions.some(s=>s.state==='rejected'))throw Error('Complete section/Stop acceptance and rejection first');
 await repo.run(saved.tripId);await repo.run(saved.tripId);if(JSON.stringify(await counts())!==JSON.stringify(before))throw Error('Rerun changed canonical data');
 const report=`PASS: algorithm ${RULES.version}; source evidence unchanged; accepted section/Stop and rejection persisted; repeated rerun preserved canonical rows. ${before.days.length} days, ${before.stops.length} stops.`;
 new File(Paths.document,'step6-verification.txt').write(report);return report;
}
