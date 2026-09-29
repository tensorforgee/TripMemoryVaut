import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, NodeConnection } from '../step1/sqlite-harness.mjs';
import { TimelineRepository } from '../../.expo/step1-tests/features/timeline/repository.js';
import { RouteRepository } from '../../.expo/step1-tests/features/route/repository.js';
import { TripRepository } from '../../.expo/step1-tests/features/trips/repository.js';
import { LocalDatabase, configureConnection } from '../../.expo/step1-tests/core/database/database.js';
import { migrateDatabase, migrations } from '../../.expo/step1-tests/core/database/migrate.js';
import { getOrCreateVault } from '../../.expo/step1-tests/core/database/vault.js';
import { parseTripDayFields } from '../../.expo/step1-tests/domain/trip-day.js';
import { sectionTitle } from '../../.expo/step1-tests/features/timeline/presentation.js';
import { dateForm, formDate } from '../../.expo/step1-tests/features/route/forms.js';

const dates = (start, end = start, certainty = 'exact', precision = 'day') => ({ start: { precision, value: start },
  end: end === null ? null : { precision, value: end }, certainty, source: 'import' });
async function setup(t) {
  const f = await fixture(t);
  return { ...f, timeline: new TimelineRepository(f.database,f.vault.id,randomUUID), routes: new RouteRepository(f.database,f.vault.id,randomUUID),
    trip: await f.trips.createTripDraft({ title: 'Synthetic timeline' }) };
}

test('v2 migration preserves existing Stop bytes, tombstones, Places and trips; rerun is idempotent', async t => {
  const f = await fixture(t, false);
  await migrateDatabase(f.database,f.services,migrations.slice(0,2));
  const vault = await getOrCreateVault(f.database,randomUUID);
  const trips = new TripRepository(f.database,vault.id,randomUUID);
  const trip = await trips.createTripDraft({ title: 'Before TripDay' });
  const stamp = new Date().toISOString(); const place = randomUUID();
  await f.connection.runAsync('INSERT INTO places(id,vault_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',place,vault.id,'Repeated Place',stamp,stamp);
  for (let i=0;i<2;i++) await f.connection.runAsync('INSERT INTO stops(id,vault_id,trip_id,place_id,position,dates_json,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),vault.id,trip.id,place,i,JSON.stringify(dates('2001-02-03',null,'approximate')),stamp,stamp,i ? stamp : null);
  const before = await f.connection.getAllAsync('SELECT * FROM stops ORDER BY id');
  const places = await f.connection.getAllAsync('SELECT * FROM places');
  const ledger = await f.connection.getAllAsync('SELECT * FROM schema_migrations ORDER BY version');
  await migrateDatabase(f.database,f.services);
  const after = await f.connection.getAllAsync('SELECT * FROM stops ORDER BY id');
  assert.deepEqual(after.map(({day_id,...rest}) => { assert.equal(day_id,null); return rest; }),before.map(row=>({...row})));
  assert.deepEqual(await f.connection.getAllAsync('SELECT * FROM places'),places);
  assert.deepEqual(await trips.getTripById(trip.id),trip);
  assert.deepEqual((await f.connection.getAllAsync('SELECT * FROM schema_migrations ORDER BY version')).slice(0,2),ledger);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version,migrations.length);
  await migrateDatabase(f.database,f.services); assert.equal(f.backups.length,2);
  assert.deepEqual(await f.connection.getAllAsync('PRAGMA foreign_key_check'),[]);
  assert.ok((await f.connection.getAllAsync('PRAGMA foreign_key_list(stops)')).some(row => row.table === 'trip_days' && row.from === 'day_id'));
});

test('failed TripDay migration restores v2 data and can retry', async t => {
  const f = await fixture(t,false);
  await migrateDatabase(f.database,f.services,migrations.slice(0,2));
  const vault = await getOrCreateVault(f.database,randomUUID);
  const trips = new TripRepository(f.database,vault.id,randomUUID);
  const trip = await trips.createTripDraft({ title: 'Keep me' });
  await assert.rejects(migrateDatabase(f.database,f.services,[...migrations.slice(0,2),{version:3,sql:migrations[2].sql+'\nINVALID SQL;'}]),/snapshot was restored/);
  assert.deepEqual(await trips.getTripById(trip.id),trip);
  assert.equal((await f.connection.getFirstAsync('PRAGMA user_version')).user_version,2);
  assert.equal(await f.connection.getFirstAsync("SELECT name FROM sqlite_schema WHERE name='trip_days'"),null);
  await migrateDatabase(f.database,f.services);
});

for (const [name,value] of [['exact day',dates('2022-06-12')],['approximate day',dates('2001-02-03','2001-02-03','approximate')],
  ['month',dates('2001-02',null,'approximate','month')],['year',dates('2001',null,'exact','year')],['range',dates('2022-06-12','2022-06-16')],['no date',null]]) {
  test(`create/read/update ${name} preserves identity and DateSpec`,async t => {
    const f=await setup(t);
    const day=await f.timeline.createTripDay(f.trip.id,{ dates:value });
    assert.equal(day.label,null); assert.deepEqual(day.dates,value);
    const updated=await f.timeline.updateTripDay(f.trip.id,day.id,{ label:' Early in the trip ' });
    assert.equal(updated.id,day.id); assert.equal(updated.createdAt,day.createdAt); assert.deepEqual(updated.dates,value);
    assert.equal(updated.label,'Early in the trip');
    assert.deepEqual(await f.timeline.listTripDays(f.trip.id),[updated]);
    assert.deepEqual(formDate(dateForm(value),value),value);
    const cleared=await f.timeline.updateTripDay(f.trip.id,day.id,{dates:null,label:null});
    assert.equal(cleared.dates,null); assert.equal(sectionTitle(cleared),'Untitled section');
  });
}

test('invalid dates, labels, unsupported fields and SQL positions are rejected',async t => {
  const f=await setup(t);
  for(const value of [dates('2022-02-29'),dates('2022-06-12','2022-06-11')]) assert.throws(()=>parseTripDayFields({label:null,dates:value}));
  assert.throws(()=>parseTripDayFields({label:' ',dates:null}));
  assert.throws(()=>parseTripDayFields({label:null,dates:null,position:3}));
  const day=await f.timeline.createTripDay(f.trip.id);
  await assert.rejects(f.timeline.updateTripDay(f.trip.id,day.id,{position:4}));
  for(const position of [-1,0.5]) await assert.rejects(f.connection.runAsync('UPDATE trip_days SET position=? WHERE id=?',position,day.id));
  await assert.rejects(f.connection.runAsync("UPDATE trip_days SET dates_json='[]' WHERE id=?",day.id));
  assert.equal(sectionTitle({label:'Part 2',dates:null}),'Part 2');
  assert.match(sectionTitle({label:null,dates:dates('2001',null,'approximate','year')}),/Approximate/);
  assert.doesNotMatch(sectionTitle({label:null,dates:null}),/Day \d/);
});

test('reorder uses stable identities, checks full membership/revision, and rolls back collisions/failure',async t => {
  const f=await setup(t);
  const a=await f.timeline.createTripDay(f.trip.id,{label:'Early'});
  const b=await f.timeline.createTripDay(f.trip.id,{label:'Later'});
  const c=await f.timeline.createTripDay(f.trip.id);
  const revision=(await f.timeline.getTimeline(f.trip.id)).revision;
  await f.timeline.reorderTripDays(f.trip.id,[c.id,a.id,b.id],revision);
  const before=await f.timeline.getTimeline(f.trip.id);
  assert.deepEqual(before.days.map(d=>[d.id,d.position]),[[c.id,0],[a.id,1],[b.id,2]]);
  await assert.rejects(f.timeline.reorderTripDays(f.trip.id,[a.id,b.id,c.id],revision),/changed/);
  await assert.rejects(f.timeline.reorderTripDays(f.trip.id,[a.id,a.id,c.id],before.revision),/exactly once/);
  await assert.rejects(f.connection.runAsync('UPDATE trip_days SET position=0 WHERE id=?',a.id),/UNIQUE/);
  await f.connection.execAsync(`CREATE TRIGGER fail_day_order BEFORE UPDATE OF position ON trip_days WHEN NEW.id='${b.id}' BEGIN SELECT RAISE(ABORT,'forced'); END;`);
  await assert.rejects(f.timeline.reorderTripDays(f.trip.id,[b.id,a.id,c.id],before.revision),/forced/);
  assert.deepEqual(await f.timeline.getTimeline(f.trip.id),before);
});

test('assign, move and unassign preserve all Stop evidence; repeated Places remain separate visits',async t => {
  const f=await setup(t);
  const a=await f.timeline.createTripDay(f.trip.id); const b=await f.timeline.createTripDay(f.trip.id);
  const first=await f.routes.createPlaceAndAddStop(f.trip.id,{name:'Manali'},{dates:dates('2001',null,'approximate','year'),source:'import',kind:'stay',lodgingLabel:'Remembered lodge'});
  const repeat=await f.routes.addStop(f.trip.id,{placeId:first.placeId});
  const before=await f.connection.getFirstAsync('SELECT * FROM stops WHERE id=?',first.id);
  await f.timeline.assignStop(f.trip.id,first.id,a.id); await f.timeline.assignStop(f.trip.id,repeat.id,b.id);
  assert.deepEqual((await f.routes.listStops(f.trip.id)).map(s=>s.dayId),[a.id,b.id]);
  await f.routes.editStop(f.trip.id,first.id,{note:'Edited after assignment'});
  assert.equal((await f.routes.getStop(f.trip.id,first.id)).dayId,a.id);
  await f.timeline.moveStop(f.trip.id,first.id,b.id);
  assert.equal((await f.routes.getStop(f.trip.id,first.id)).dayId,b.id);
  await f.timeline.unassignStop(f.trip.id,first.id);
  const after=await f.connection.getFirstAsync('SELECT * FROM stops WHERE id=?',first.id);
  for(const field of ['dates_json','source','checkout_dates_json','place_id','position','kind','lodging_label','created_at']) assert.equal(after[field],before[field]);
  assert.equal(after.day_id,null);
});

test('remove detaches active and removed Stops, preserves Places, restores empty section without collisions',async t => {
  const f=await setup(t);
  const a=await f.timeline.createTripDay(f.trip.id,{label:'Early'}); const b=await f.timeline.createTripDay(f.trip.id);
  const stop=await f.routes.createPlaceAndAddStop(f.trip.id,{name:'A'},{dates:dates('2022-06-12')});
  const removed=await f.routes.addStop(f.trip.id,{placeId:stop.placeId});
  await f.timeline.assignStop(f.trip.id,stop.id,a.id); await f.timeline.assignStop(f.trip.id,removed.id,a.id);
  await f.routes.removeStop(f.trip.id,removed.id);
  await assert.rejects(f.connection.runAsync('UPDATE trip_days SET deleted_at=? WHERE id=?',new Date().toISOString(),a.id),/Detach/);
  await f.timeline.removeTripDay(f.trip.id,a.id);
  assert.equal((await f.routes.getStop(f.trip.id,stop.id)).dayId,null);
  assert.deepEqual((await f.routes.getStop(f.trip.id,stop.id)).dates,stop.dates);
  assert.ok(await f.routes.getPlace(stop.placeId));
  await f.routes.restoreStop(f.trip.id,removed.id);
  assert.equal((await f.routes.getStop(f.trip.id,removed.id)).dayId,null);
  await f.timeline.restoreTripDay(f.trip.id,a.id);
  assert.deepEqual((await f.timeline.listTripDays(f.trip.id)).map(d=>[d.id,d.position]),[[b.id,0],[a.id,1]]);
  assert.ok((await f.routes.listStops(f.trip.id)).every(s=>s.dayId===null));
});

test('delete failure rolls back detachment and revision; notifications only follow commit',async t => {
  const f=await setup(t);
  const a=await f.timeline.createTripDay(f.trip.id);
  const stop=await f.routes.createPlaceAndAddStop(f.trip.id,{name:'A'});
  await f.timeline.assignStop(f.trip.id,stop.id,a.id);
  const before=await f.timeline.getTimeline(f.trip.id);
  let events=0; const unsubscribe=f.timeline.subscribe(()=>events++);
  await f.connection.execAsync("CREATE TRIGGER fail_day_delete BEFORE UPDATE OF deleted_at ON trip_days BEGIN SELECT RAISE(ABORT,'forced'); END;");
  await assert.rejects(f.timeline.removeTripDay(f.trip.id,a.id),/forced/);
  assert.deepEqual(await f.timeline.getTimeline(f.trip.id),before);
  assert.equal((await f.routes.getStop(f.trip.id,stop.id)).dayId,a.id); assert.equal(events,0);
  await f.connection.execAsync('DROP TRIGGER fail_day_delete');
  await f.timeline.removeTripDay(f.trip.id,a.id); assert.equal(events,1); unsubscribe();
});

test('same-trip/vault FKs and active-parent guards reject invalid assignments and reads',async t => {
  const f=await setup(t); const other=await f.trips.createTripDraft({title:'Other'});
  const a=await f.timeline.createTripDay(f.trip.id); const b=await f.timeline.createTripDay(other.id);
  const stop=await f.routes.createPlaceAndAddStop(f.trip.id,{name:'A'});
  await assert.rejects(f.timeline.assignStop(f.trip.id,stop.id,b.id),/unavailable/);
  await assert.rejects(f.timeline.assignStop(other.id,stop.id,b.id),/unavailable/);
  await assert.rejects(f.connection.runAsync('UPDATE stops SET day_id=? WHERE id=?',b.id,stop.id),/same trip/);
  await f.timeline.removeTripDay(f.trip.id,a.id);
  await assert.rejects(f.timeline.assignStop(f.trip.id,stop.id,a.id),/unavailable/);
  await assert.rejects(f.connection.runAsync('UPDATE stops SET day_id=? WHERE id=?',a.id,stop.id),/active/);
  const foreign=new TimelineRepository(f.database,randomUUID(),randomUUID);
  await assert.rejects(foreign.listTripDays(f.trip.id),/unavailable/);
  await assert.rejects(foreign.restoreTripDay(f.trip.id,a.id),/unavailable/);
  await assert.rejects(f.connection.runAsync('UPDATE trip_days SET vault_id=? WHERE id=?',randomUUID(),b.id));
  await f.trips.trashTrip(other.id);
  await assert.rejects(f.timeline.createTripDay(other.id),/unavailable/);
  await assert.rejects(f.timeline.listTripDays(other.id),/unavailable/);
  await assert.rejects(f.connection.runAsync('UPDATE trip_days SET label=? WHERE id=?','Forbidden',b.id),/active trip/);
});

test('trip trash/restore retains assignments and does not resurrect individually removed sections',async t => {
  const f=await setup(t); const a=await f.timeline.createTripDay(f.trip.id); const b=await f.timeline.createTripDay(f.trip.id);
  const stop=await f.routes.createPlaceAndAddStop(f.trip.id,{name:'A'}); await f.timeline.assignStop(f.trip.id,stop.id,a.id);
  await f.timeline.removeTripDay(f.trip.id,b.id);
  for(let i=0;i<2;i++) {
    await f.trips.trashTrip(f.trip.id); await assert.rejects(f.timeline.listTripDays(f.trip.id),/unavailable/);
    await f.trips.restoreTrip(f.trip.id);
    assert.deepEqual((await f.timeline.listTripDays(f.trip.id)).map(d=>d.id),[a.id]);
    assert.equal((await f.routes.getStop(f.trip.id,stop.id)).dayId,a.id);
  }
});

test('timeline order, assignments, dates and tombstones persist across database restart',async t => {
  const f=await setup(t); const a=await f.timeline.createTripDay(f.trip.id,{label:'Early',dates:dates('2001',null,'approximate','year')});
  const b=await f.timeline.createTripDay(f.trip.id,{label:'Later'}); const c=await f.timeline.createTripDay(f.trip.id,{label:'Part 2'});
  const stop=await f.routes.createPlaceAndAddStop(f.trip.id,{name:'Manali'}); await f.timeline.assignStop(f.trip.id,stop.id,b.id);
  await f.timeline.reorderTripDays(f.trip.id,[b.id,a.id,c.id],(await f.timeline.getTimeline(f.trip.id)).revision);
  await f.timeline.removeTripDay(f.trip.id,c.id);
  const before=await f.timeline.getTimeline(f.trip.id); const route=await f.routes.listStops(f.trip.id);
  await f.database.close();
  const connection=new NodeConnection(f.path);
  try {
    await configureConnection(connection);
    const database=new LocalDatabase(connection); const timeline=new TimelineRepository(database,f.vault.id,randomUUID);
    assert.deepEqual(await timeline.getTimeline(f.trip.id),before);
    assert.deepEqual(await new RouteRepository(database,f.vault.id,randomUUID).listStops(f.trip.id),route);
    await timeline.restoreTripDay(f.trip.id,c.id);
    assert.equal((await timeline.listTripDays(f.trip.id)).length,3);
    assert.deepEqual(await connection.getAllAsync('PRAGMA foreign_key_check'),[]);
  } finally { await connection.closeAsync(); }
});
