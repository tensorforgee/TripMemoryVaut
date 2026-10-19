import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrateDatabase, migrations } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { RoadRouteRepository, roadRouteIntegrity } from '../../.expo/step1-tests/features/road-route/repository.js';
import { parseGeometry, parseProposal, roadSegments, currentRoadRoutes, splitAtDateline, roadFeatures, STOPS_ONLY_LABEL } from '../../.expo/step1-tests/features/road-route/model.js';
import { decodeOrsPolyline, liveOrsProvider, orsRequest, orsAdapter, parseOrsResponse, configuredRoutingProvider, ORS_ATTRIBUTION, ORS_ENDPOINT, ORS_LICENSE } from '../../.expo/step1-tests/features/road-route/provider.js';
import { RouteProposalSession } from '../../.expo/step1-tests/features/road-route/proposals.js';
import { fitTripCamera } from '../../.expo/step1-tests/features/map/model.js';
import { createPortableExport, inspectPortableRestore, restorePortableArchive } from '../../.expo/step1-tests/services/archive/portable.js';
import { resetVaultContents } from '../../.expo/step1-tests/features/settings/reset-database.js';

const stamp = '2026-10-09T06:00:00.000Z';
const input = () => ({ fromStopId:randomUUID(),toStopId:randomUUID(),from:[77,31],to:[77.02,31.02] });
const response = (i, coords=[i.from,[77.003,31.008],[77.013,31.013],i.to]) => ({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{summary:{distance:4100}}}],metadata:{engine:{version:'test-fixture',graph_date:'unknown-test-data'}}});
const encode = coordinates => {
  let latitude=0,longitude=0,result='';
  const append = delta => { let value=delta<0?~(delta<<1):delta<<1; while(value>=0x20){result+=String.fromCharCode((0x20|(value&0x1f))+63);value>>=5;} result+=String.fromCharCode(value+63); };
  for(const [lon,lat] of coordinates){const nextLat=Math.round(lat*1e5),nextLon=Math.round(lon*1e5);append(nextLat-latitude);append(nextLon-longitude);latitude=nextLat;longitude=nextLon;}
  return result;
};
const proposal = i => parseOrsResponse(response(i),i,[],stamp);
async function seed(t) {
  const f=await fixture(t), routes=new RouteRepository(f.database,f.vault.id,randomUUID), roads=new RoadRouteRepository(f.database,f.vault.id,randomUUID);
  const trip=await f.trips.createTripDraft({title:'Disposable routing fixture — synthetic geometry'});
  const a=await routes.createPlaceAndAddStop(trip.id,{name:'A',longitude:77,latitude:31});
  const b=await routes.createPlaceAndAddStop(trip.id,{name:'B',longitude:77.02,latitude:31.02});
  const i=roadSegments(trip.id,await routes.listStops(trip.id))[0];
  return {...f,routes,roads,trip,a,b,i};
}

test('road parser retains longitude/latitude and every supplied curve vertex with provider provenance',()=>{
  const i=input(), p=proposal(i);
  assert.deepEqual(p.geometry.coordinates,response(i).features[0].geometry.coordinates);
  assert.equal(p.provenance.source,'generated');assert.equal(p.provenance.attribution,ORS_ATTRIBUTION);
  assert.equal(p.provenance.license,ORS_LICENSE);assert.equal(p.provenance.engineVersion,'test-fixture');assert.equal(p.distanceMeters,4100);
  const r=response(i);delete r.features[0].properties.summary.distance;
  assert.equal(parseOrsResponse(r,i,[],stamp).distanceMeters,null);
});

test('standard ORS JSON decodes encoded latitude/longitude polyline into GeoJSON longitude/latitude',()=>{
  const i=input(),coordinates=response(i).features[0].geometry.coordinates;
  const encoded=encode(coordinates),decoded=decodeOrsPolyline(encoded);
  assert.deepEqual(decoded,{type:'LineString',coordinates});
  const standard={routes:[{summary:{distance:4100},geometry:encoded}],metadata:{engine:{version:'standard-fixture',graph_date:'fixture'}}};
  const parsed=parseOrsResponse(standard,i,[],stamp);
  assert.deepEqual(parsed.geometry.coordinates,coordinates);assert.equal(parsed.distanceMeters,4100);
  for(const malformed of ['',63,'?','~~~~~~']) assert.throws(()=>decodeOrsPolyline(malformed));
});

test('live provider reads the credential per request and sends it only in the Authorization header',async()=>{
  const i=input(),keys=['first-private-key-value','second-private-key-value'],calls=[];
  const provider=liveOrsProvider(async()=>keys.shift()??null,async(url,init)=>{
    calls.push({url,init});return {status:200,json:async()=>response(i)};
  });
  await provider.propose(i,[],new AbortController().signal);
  await provider.propose(i,[],new AbortController().signal);
  assert.equal(calls.length,2);assert.equal(calls[0].url,ORS_ENDPOINT);assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.headers.Authorization,'first-private-key-value');assert.equal(calls[1].init.headers.Authorization,'second-private-key-value');
  assert.doesNotMatch(calls[0].url,/key|token|first-private/i);assert.deepEqual(JSON.parse(calls[0].init.body),orsRequest(i,[]));
  await assert.rejects(liveOrsProvider(async()=>null,async()=>{throw Error('must not fetch');}).propose(i,[],new AbortController().signal),/Settings → Routing/);
});

test('rejects malformed, degenerate, out-of-range, nonfinite and oversized geometry',()=>{
  for(const coordinates of [[],[[77,31]],[[77,31],[77,31]],[[181,31],[77,31]],[[77,91],[77,31]],[[NaN,31],[77,31]],[[77,31,8],[77,32]],Array(100001).fill([77,31])])
    assert.throws(()=>parseGeometry({type:'LineString',coordinates}));
  const i=input();
  for(const r of [{}, {error:{code:2009}}, {...response(i),features:[]}, {...response(i),metadata:null}]) assert.throws(()=>parseOrsResponse(r,i,[],stamp));
  const wrong=response(i,[[75,30],[75.1,30.1]]);assert.throws(()=>parseOrsResponse(wrong,i,[],stamp),/requested Stops/);
  const negative=response(i);negative.features[0].properties.summary.distance=-1;assert.throws(()=>parseOrsResponse(negative,i,[],stamp),/distance/);
});

test('requests include ordered via coordinates only, preserve loops and reject identical inputs',()=>{
  const i=input(),via=[{id:randomUUID(),coordinate:[77.005,31.01]},{id:randomUUID(),coordinate:[77.015,31.01]}];
  assert.deepEqual(orsRequest(i,via).coordinates,[i.from,...via.map(p=>p.coordinate),i.to]);
  assert.equal(orsRequest(i,via).geometry_simplify,false);assert.equal(orsRequest(i,via).instructions,false);
  const loop={...i,to:i.from};assert.throws(()=>orsRequest(loop,[]),/Identical/);
  assert.equal(orsRequest(loop,via).coordinates.length,4);
  assert.throws(()=>orsRequest(i,[via[0],via[0]]),/Duplicate/);
  assert.throws(()=>orsRequest(i,Array.from({length:21},()=>({id:randomUUID(),coordinate:[77,31]}))),/at most/);
});

test('provider handles HTTP errors, malformed bodies and sanitizes network diagnostics',async()=>{
  const i=input();
  for(const [status,pattern] of [[401,/credential/],[403,/credential/],[429,/quota/],[400,/routable/],[404,/routable/],[500,/unavailable/]])
    await assert.rejects(orsAdapter(async()=>({status,body:{secret:'do not expose'}})).propose(i,[],new AbortController().signal),pattern);
  await assert.rejects(orsAdapter(async()=>({status:200,body:{}})).propose(i,[],new AbortController().signal),/Malformed/);
  await assert.rejects(orsAdapter(async()=>{throw Error('secret-key https://example.test/?token=secret');}).propose(i,[],new AbortController().signal),e=>!e.message.includes('secret'));
  assert.deepEqual((await orsAdapter(async()=>({status:200,body:response(i)}),()=>stamp).propose(i,[],new AbortController().signal)).geometry,proposal(i).geometry);
});

test('timeouts and cancellation settle even if a transport ignores abort; no automatic retries',async()=>{
  let calls=0;const provider=orsAdapter(async()=>{calls++;return new Promise(()=>{});},()=>stamp,10);
  await assert.rejects(provider.propose(input(),[],new AbortController().signal),/timed out/);assert.equal(calls,1);
  const controller=new AbortController(),pending=orsAdapter(async()=>new Promise(()=>{})).propose(input(),[],controller.signal);
  controller.abort();await assert.rejects(pending,/cancelled/);
  let preAbortedCalls=0;await assert.rejects(orsAdapter(async()=>{preAbortedCalls++;}).propose(input(),[],controller.signal),/cancelled/);assert.equal(preAbortedCalls,0);
  await assert.rejects(configuredRoutingProvider.propose(input(),[],new AbortController().signal),/not configured/);
});

test('provider response cannot substitute another segment or silently change via order',async()=>{
  const i=input(),session=new RouteProposalSession(i);
  await session.generate({name:'bad',propose:async()=>proposal({...i,toStopId:randomUUID()})});
  assert.equal(session.proposal,null);assert.match(session.error,/does not match/);
  assert.throws(()=>parseGeometry({type:'LineString',coordinates:[[77,31],[78,32]]}),/discontinuous/);
});

test('segment identity uses Stop occurrences, canonical order and never bridges unknown/unconfirmed Stops',async t=>{
  const x=await seed(t);const repeated=await x.routes.addStop(x.trip.id,{placeId:x.a.placeId});
  let segments=roadSegments(x.trip.id,await x.routes.listStops(x.trip.id));
  assert.deepEqual(segments.map(s=>[s.fromStopId,s.toStopId]),[[x.a.id,x.b.id],[x.b.id,repeated.id]]);
  await x.routes.editStop(x.trip.id,x.b.id,{visitConfirmed:false});assert.equal(roadSegments(x.trip.id,await x.routes.listStops(x.trip.id)).length,0);
  await x.routes.editStop(x.trip.id,x.b.id,{visitConfirmed:true});await x.routes.updatePlace(x.b.placeId,{latitude:null,longitude:null,coordinatePrecision:'unknown'});
  assert.equal(roadSegments(x.trip.id,await x.routes.listStops(x.trip.id)).length,0);
});

test('via edits, reordering, removal and discard clear previews; late results cannot resurrect them',async()=>{
  const i=input(),session=new RouteProposalSession(i);await session.generate({name:'fixture',propose:async()=>proposal(i)});
  assert.ok(session.proposal);const a={id:randomUUID(),coordinate:[77.005,31.01]},b={id:randomUUID(),coordinate:[77.01,31.012]};
  session.editVia([a,b]);assert.equal(session.proposal,null);session.editVia([b,a]);assert.deepEqual(session.viaPoints,[b,a]);
  session.editVia([a]);assert.equal(session.viaPoints.length,1);session.editVia([]);
  let resolve;const pending=session.generate({name:'late',propose:()=>new Promise(r=>{resolve=r;})});
  session.discard();resolve(proposal(i));await pending;assert.equal(session.proposal,null);assert.equal(session.busy,false);
  await assert.rejects(session.confirm(async()=>{}),/review/);
});

test('confirmation is transactional/idempotent and discard keeps the previous saved route',async t=>{
  const x=await seed(t),p=proposal(x.i);await x.roads.confirm(x.trip.id,p,null);
  const before=await x.roads.list(x.trip.id);await x.roads.confirm(x.trip.id,p,null);assert.deepEqual(await x.roads.list(x.trip.id),before);
  const session=new RouteProposalSession(x.i);await session.generate({name:'fixture',propose:async()=>({...p,distanceMeters:4200})});
  session.discard();assert.deepEqual(await x.roads.list(x.trip.id),before);
  await session.generate({name:'fixture',propose:async()=>({...p,distanceMeters:4200})});
  await session.confirm(next=>x.roads.confirm(x.trip.id,next,before[0].id,before[0].updatedAt));
  const after=await x.roads.list(x.trip.id);assert.equal(after.length,1);assert.equal(after[0].id,before[0].id);assert.equal(after[0].distanceMeters,4200);
  await assert.rejects(x.roads.confirm(x.trip.id,p,randomUUID()),/changed/);assert.deepEqual(await x.roads.list(x.trip.id),after);
});

test('saved geometry and ordered vias are identical after closing/reopening SQLite offline',async t=>{
  const x=await seed(t),via={id:randomUUID(),coordinate:[77.013,31.013]},p={...proposal(x.i),viaPoints:[via]};
  await x.roads.confirm(x.trip.id,p,null);const before=await x.roads.list(x.trip.id);await x.database.close();
  const connection=new NodeConnection(x.path);await configureConnection(connection);const db=new LocalDatabase(connection);
  try {
    const restored=new RoadRouteRepository(db,x.vault.id,randomUUID);
    assert.deepEqual(await restored.list(x.trip.id),before);assert.deepEqual(roadFeatures(await restored.list(x.trip.id)),roadFeatures(before));
  } finally { await db.close(); }
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
    import {NodeConnection} from './tests/step1/sqlite-harness.mjs';
    import {LocalDatabase,configureConnection} from './.expo/step1-tests/core/database/database.js';
    import {RoadRouteRepository} from './.expo/step1-tests/features/road-route/repository.js';
    globalThis.fetch=()=>{throw Error('Network forbidden during offline restart');};
    const c=new NodeConnection(process.argv[1]);await configureConnection(c);const db=new LocalDatabase(c);
    const roads=new RoadRouteRepository(db,process.argv[2],()=>{throw Error('Reopen must not create IDs');});
    process.stdout.write(JSON.stringify(await roads.list(process.argv[3])));await db.close();
  `,x.path,x.vault.id,x.trip.id],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),before);
});

test('Stop reorder invalidates permanently until explicit regeneration, including reorder back',async t=>{
  const x=await seed(t);await x.roads.confirm(x.trip.id,proposal(x.i),null);
  let route=await x.routes.getRoute(x.trip.id);await x.routes.reorderStops(x.trip.id,[x.b.id,x.a.id],route.revision);
  assert.equal((await x.roads.list(x.trip.id))[0].stale,true);
  route=await x.routes.getRoute(x.trip.id);await x.routes.reorderStops(x.trip.id,[x.a.id,x.b.id],route.revision);
  assert.equal(currentRoadRoutes(await x.roads.list(x.trip.id),roadSegments(x.trip.id,await x.routes.listStops(x.trip.id))).length,0);
});

test('coordinate changes and Stop deletion invalidate; names do not; stale proposals cannot save',async t=>{
  const x=await seed(t),p=proposal(x.i);await x.roads.confirm(x.trip.id,p,null);
  await x.routes.updatePlace(x.a.placeId,{name:'Renamed'});assert.equal((await x.roads.list(x.trip.id))[0].stale,false);
  await x.routes.updatePlace(x.a.placeId,{latitude:31.1});assert.equal((await x.roads.list(x.trip.id))[0].stale,true);
  const before=await x.roads.list(x.trip.id);await assert.rejects(x.roads.confirm(x.trip.id,p,before[0].id),/Stops changed/);
  await x.routes.removeStop(x.trip.id,x.b.id);assert.equal((await x.roads.list(x.trip.id)).length,1);
  assert.deepEqual(await x.roads.list(x.trip.id),before);
});

test('vault/trip isolation and malformed geometry are enforced before saving',async t=>{
  const x=await seed(t),p=proposal(x.i),other=await x.trips.createTripDraft({title:'Other'});
  await assert.rejects(x.roads.confirm(other.id,p,null),/Stops changed/);
  const foreign=new RoadRouteRepository(x.database,randomUUID(),randomUUID);assert.deepEqual(await foreign.list(x.trip.id),[]);
  await assert.rejects(foreign.confirm(x.trip.id,p,null),/Stops changed/);
  await assert.rejects(x.roads.confirm(x.trip.id,{...p,geometry:{type:'LineString',coordinates:[x.i.from]}},null));
  assert.deepEqual(await x.roads.list(x.trip.id),[]);
});

test('antimeridian splitting never draws across the world and geometry bounds include road detours',()=>{
  const coordinates=[[179,20],[-179,21],[-178,22]],parts=splitAtDateline(coordinates);
  assert.equal(parts.length,2);assert.deepEqual(coordinates,[[179,20],[-179,21],[-178,22]]);
  for(const part of parts)for(let i=1;i<part.length;i++)assert.ok(Math.abs(part[i][0]-part[i-1][0])<=180);
  const seam=splitAtDateline([[179.99,20],[180,20],[-180,20.01],[-179.99,20.01]]);
  for(const part of seam)for(let i=1;i<part.length;i++)assert.ok(Number.isFinite(part[i][1])&&Math.abs(part[i][0]-part[i-1][0])<=180);
  const fit=fitTripCamera([[77,31],[77.02,31.02],[79,34]],400,600);assert.ok(fit.center[0]>77.5);assert.ok(fit.zoom<8);
  assert.ok(Number.isFinite(fitTripCamera(Array.from({length:100000},(_,i)=>[77+i/100000,31]),400,600).zoom));
  assert.equal(STOPS_ONLY_LABEL,'Stops only — exact road unknown');
});

test('schema 10 upgrades through current schema without changing original Stops/Places or prior migration checksums',async t=>{
  const f=await fixture(t,false);await migrateDatabase(f.database,f.services,migrations.slice(0,10));
  const vault=await getOrCreateVault(f.database,randomUUID),trips=new TripRepository(f.database,vault.id,randomUUID),routes=new RouteRepository(f.database,vault.id,randomUUID);
  const trip=await trips.createTripDraft({title:'Existing'});await routes.createPlaceAndAddStop(trip.id,{name:'Unknown historical location'});
  const before=await routes.listStops(trip.id),history=await f.connection.getAllAsync('SELECT * FROM schema_migrations ORDER BY version');
  await migrateDatabase(f.database,f.services);assert.deepEqual(await routes.listStops(trip.id),before);
  assert.deepEqual((await f.connection.getAllAsync('SELECT * FROM schema_migrations ORDER BY version')).slice(0,10),history);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version,12);
  assert.equal((await f.connection.getFirstAsync('SELECT count(*) n FROM road_route_segments')).n,0);
  await migrateDatabase(f.database,f.services);assert.deepEqual(await routes.listStops(trip.id),before);
});

test('failed reordering rolls back stale flags with Stop order; direct cross-trip route FKs fail',async t=>{
  const x=await seed(t);await x.roads.confirm(x.trip.id,proposal(x.i),null);
  const before=await x.roads.list(x.trip.id),route=await x.routes.getRoute(x.trip.id);
  await x.connection.execAsync(`CREATE TRIGGER abort_reorder BEFORE UPDATE OF position ON stops WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'injected'); END;`);
  await assert.rejects(x.routes.reorderStops(x.trip.id,[x.b.id,x.a.id],route.revision),/injected/);
  assert.deepEqual(await x.roads.list(x.trip.id),before);assert.deepEqual(await x.routes.getRoute(x.trip.id),route);
  const other=await x.trips.createTripDraft({title:'Other'});
  await assert.rejects(x.connection.runAsync('UPDATE road_route_segments SET trip_id=?',other.id),/FOREIGN KEY/);
});

test('local reset deletes confirmed road children before Stops in a disposable host vault',async t=>{
  const x=await seed(t);await x.roads.confirm(x.trip.id,proposal(x.i),null);const freshId=randomUUID();
  await resetVaultContents(x.database,()=>freshId);
  assert.equal((await x.connection.getFirstAsync('SELECT count(*) n FROM road_route_segments')).n,0);
  assert.equal((await x.connection.getFirstAsync('SELECT id FROM vaults')).id,freshId);
  assert.deepEqual(await x.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
});

class MemoryIO {
  files=new Map();
  key(root,path){return `${root}/${path}`;}
  async createRoot(){} async removeRoot(){}
  async writeText(root,path,text){this.files.set(this.key(root,path),text);}
  async readText(root,path){return this.files.get(this.key(root,path));}
  async exists(root,path){return this.files.has(this.key(root,path));}
  async size(root,path){return Buffer.byteLength(await this.readText(root,path));}
  async sha256Text(text){return createHash('sha256').update(text).digest('hex');}
  async verifyFile(root,path,hash,bytes){const text=await this.readText(root,path);return typeof text==='string'&&Buffer.byteLength(text)===bytes&&await this.sha256Text(text)===hash;}
}
async function archive(x) {
  const io=new MemoryIO();await createPortableExport({database:x.database,vaultId:x.vault.id,io,mediaFiles:{},stagingRoot:'archive',now:()=>stamp});return io;
}
async function rewrite(io,path,mutate) {
  const value=JSON.parse(await io.readText('archive',path));mutate(value);const text=JSON.stringify(value);await io.writeText('archive',path,text);
  const manifest=JSON.parse(await io.readText('archive','manifest.json')),entry=manifest.files.find(f=>f.path===path);
  entry.sha256=await io.sha256Text(text);entry.bytes=Buffer.byteLength(text);await manifestWrite(io,manifest);
}
async function manifestWrite(io,manifest) {
  const text=JSON.stringify(manifest);await io.writeText('archive','manifest.json',text);
  await io.writeText('archive','COMPLETE.json',JSON.stringify({manifest_sha256:await io.sha256Text(text)}));
}

test('portable v3 preserves road geometry/vias/provenance and roundtrips into isolated host SQLite',async t=>{
  const x=await seed(t),p={...proposal(x.i),viaPoints:[{id:randomUUID(),coordinate:[77.013,31.013]}]};await x.roads.confirm(x.trip.id,p,null);
  const io=await archive(x),inspection=await inspectPortableRestore(io,'archive');assert.equal(inspection.manifest.format_version,3);
  assert.equal(inspection.manifest.counts.road_route_segments,1);
  const geo=JSON.parse(await io.readText('archive','routes/routes.geojson')).features.find(f=>f.properties.kind==='generated_road');
  assert.deepEqual(geo.geometry,p.geometry);assert.equal(geo.properties.provenance.license,ORS_LICENSE);
  assert.match(await io.readText('archive','journal/index.html'),/not a recorded historical track/);
  const dest=await fixture(t);await restorePortableArchive({database:dest.database,currentVaultId:dest.vault.id,io,archiveRoot:'archive',destinationMedia:{},newStagingId:randomUUID});
  const roads=new RoadRouteRepository(dest.database,x.vault.id,randomUUID);assert.deepEqual(await roads.list(x.trip.id),await x.roads.list(x.trip.id));
  assert.deepEqual(await dest.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
});

test('portable inspection refuses malformed geometry, license loss, stale unmarked inputs and cross-trip references',async t=>{
  const x=await seed(t);await x.roads.confirm(x.trip.id,proposal(x.i),null);const other=await x.trips.createTripDraft({title:'Other'});
  for(const mutate of [r=>{r.geometry.coordinates=[[77,31]];},r=>{r.provenance.license='unknown';},r=>{r.input.from=[77.001,31.001];},r=>{r.trip_id=other.id;},r=>{r.vault_id=randomUUID();},r=>{r.extra='future field';}]){
    const io=await archive(x);await rewrite(io,'data/road-route-segments.json',doc=>mutate(doc.records[0]));await assert.rejects(inspectPortableRestore(io,'archive'));
  }
  const io=await archive(x);await io.writeText('archive','data/road-route-segments.json','tampered');await assert.rejects(inspectPortableRestore(io,'archive'),/Checksum/);
});

test('portable v1 remains readable, but cannot smuggle road records into an old format',async t=>{
  const x=await seed(t),io=await archive(x),m=JSON.parse(await io.readText('archive','manifest.json'));
  m.format_version=1;m.schema_version=10;delete m.counts.road_route_segments;delete m.counts.photo_memory_pins;m.files=m.files.filter(f=>f.path!=='data/road-route-segments.json' && f.path!=='data/photo-memory-pins.json');
  for(const f of m.files.filter(f=>f.kind==='data')) {const d=JSON.parse(await io.readText('archive',f.path));d.format_version=1;const text=JSON.stringify(d);await io.writeText('archive',f.path,text);f.bytes=Buffer.byteLength(text);f.sha256=await io.sha256Text(text);}
  await manifestWrite(io,m);assert.equal((await inspectPortableRestore(io,'archive')).manifest.format_version,1);
  m.counts.road_route_segments=1;await manifestWrite(io,m);await assert.rejects(inspectPortableRestore(io,'archive'),/require portable/);
});

test('export sequence preserves unconfirmed gaps; integrity scanner catches corrupt road payloads',async t=>{
  const x=await seed(t);await x.routes.addStop(x.trip.id,{placeId:x.a.placeId});await x.routes.editStop(x.trip.id,x.b.id,{visitConfirmed:false});
  const io=await archive(x),geo=JSON.parse(await io.readText('archive','routes/routes.geojson'));
  assert.equal(geo.features.filter(f=>f.geometry.type==='LineString').length,0);
  await x.routes.editStop(x.trip.id,x.b.id,{visitConfirmed:true});await x.roads.confirm(x.trip.id,proposal(x.i),null);
  assert.equal(await roadRouteIntegrity(x.connection,x.vault.id),0);
  await x.connection.runAsync(`UPDATE road_route_segments SET geometry_json=?`,JSON.stringify({type:'LineString',coordinates:[[77,31]]}));
  assert.equal(await roadRouteIntegrity(x.connection,x.vault.id),1);await assert.rejects(archive(x));
});
