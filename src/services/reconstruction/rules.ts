import type { SourceMetadata } from '../../domain/media';
export const RULES = { version: 2, sectionGapHours: 6, locationGapHours: 2, radiusMetres: 250, minimumYear: 1800, maximumYear: 2100, spatialOffsetBoundary: 'split' } as const;
export type PhotoEvidence = { id: string; mediaId: string; position: number; metadata: SourceMetadata; parserVersion: number; dayId: string|null; stopId: string|null; filename: string|null; thumbnail: string|null };
export type Proposal = { kind: 'section'|'location'; label: string; members: string[]; confidence: 'supported'|'tentative'; reasons: string[]; start: string|null; end: string|null; zone: string; point: {latitude:number;longitude:number}|null };
function time(p: PhotoEvidence) {
  const c=p.metadata.capture;
  if(!c || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(c.local))return null;
  const ms=Date.parse(c.local+'Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,19)!==c.local||+c.local.slice(0,4)<RULES.minimumYear||+c.local.slice(0,4)>RULES.maximumYear)return null;
  if(c.offset_minutes!==null&&(!Number.isInteger(c.offset_minutes)||Math.abs(c.offset_minutes)>840))return null;
  if(c.utc!==null&&(c.offset_minutes===null||Date.parse(c.utc)!==ms-c.offset_minutes*60000))return null;
  return {ms:c.offset_minutes===null?ms:ms-c.offset_minutes*60000, zone:c.offset_minutes===null?'Floating timezone':`UTC offset ${c.offset_minutes} minutes`,local:c.local};
}
function gps(p:PhotoEvidence){const g=p.metadata.gps;return g&&Number.isFinite(g.latitude)&&Number.isFinite(g.longitude)&&Math.abs(g.latitude)<=90&&Math.abs(g.longitude)<=180?g:null;}
export function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){
  const rad=Math.PI/180;const s=Math.sin((a.latitude-b.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((a.longitude-b.longitude)*rad/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,s)));
}
function representative(group:PhotoEvidence[]){ // Coordinate-wise median, selecting an actual evidence point nearest it.
 const points=group.map(p=>gps(p)!);const lat=points.map(p=>p.latitude).sort((a,b)=>a-b);const lon=points.map(p=>p.longitude).sort((a,b)=>a-b);
 const mid={latitude:lat[Math.floor(lat.length/2)],longitude:lon[Math.floor(lon.length/2)]};
 return [...points].sort((a,b)=>distance(a,mid)-distance(b,mid)||a.latitude-b.latitude||a.longitude-b.longitude)[0];
}
export function reconstruct(input:PhotoEvidence[], excluded:{section:Set<string>;location:Set<string>}={section:new Set(),location:new Set()}){
 const photos=[...input].sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));
 const zones=new Map<string,PhotoEvidence[]>();const unknown:string[]=[];
 for(const p of photos){const t=time(p);if(!t){unknown.push(p.id);continue;}const group=zones.get(t.zone)??[];group.push(p);zones.set(t.zone,group);}
 const proposals:Proposal[]=[];
 const rapid=new Set<string>();
 const instants=photos.filter(p=>time(p)&&p.metadata.capture?.offset_minutes!==null&&gps(p)).sort((a,b)=>time(a)!.ms-time(b)!.ms||a.id.localeCompare(b.id));
 for(let i=1;i<instants.length;i++){const a=instants[i-1],b=instants[i];const km=distance(gps(a)!,gps(b)!)/1000;const hours=(time(b)!.ms-time(a)!.ms)/3600000;
  if(km>100&&(hours===0||km/hours>300)){rapid.add(a.id);rapid.add(b.id);}
 }
 const add=(kind:Proposal['kind'],g:PhotoEvidence[],zone:string)=>{
  if(!g.length)return;const times=g.map(time).filter(t=>t!==null);const start=times[0]?.local??null;const end=times.at(-1)?.local??null;
  const point=kind==='location'?representative(g):null;const tentative=zone==='Floating timezone'||!start||g.length===1||(point?.latitude===0&&point.longitude===0)||g.some(p=>rapid.has(p.id));
  proposals.push({kind,label:kind==='section'?`${start!.slice(0,10)}${end!.slice(0,10)!==start!.slice(0,10)?' – '+end!.slice(0,10):''}`:`Location ${proposals.filter(p=>p.kind==='location').length+1}`,members:g.map(p=>p.id),confidence:tentative?'tentative':'supported',reasons:[kind==='section'?'Timestamp continuity (up to 6 hours)':'GPS-supported (250 metres; up to 2 hours)',zone,...(g.length===1?['Single photo; duration is not established']:[]),...(zone==='Floating timezone'?['Wall-clock comparison only; clocks may disagree']:[]),...(!start?['No chronology; no route order inferred']:[]),...(point?.latitude===0&&point.longitude===0?['Zero-coordinate evidence requires review']:[])],start,end,zone,point});
 };
 for(const [zone,rows] of [...zones.entries()].sort(([a],[b])=>a.localeCompare(b))){
  rows.sort((a,b)=>time(a)!.ms-time(b)!.ms||a.id.localeCompare(b.id));
  let section:PhotoEvidence[]=[];let cluster:PhotoEvidence[]=[];
  for(const p of rows){
   if(excluded.section.has(p.id)){add('section',section,zone);section=[];}else{if(section.length&&time(p)!.ms-time(section.at(-1)!)!.ms>RULES.sectionGapHours*3600000){add('section',section,zone);section=[];}section.push(p);}
   if(!gps(p)||excluded.location.has(p.id)){add('location',cluster,zone);cluster=[];continue;}
   // Other known-offset captures are chronology evidence even if they have no GPS.
   // Never bridge an intervening timezone bucket and collapse A→B→A visits.
   const boundary=cluster.length&&zone!=='Floating timezone'&&photos.some(q=>{
    const t=time(q);return t&&q.metadata.capture?.offset_minutes!==null&&t.zone!==zone&&t.ms>=time(cluster.at(-1)!)!.ms&&t.ms<=time(p)!.ms;
   });
   if(cluster.length&&(boundary||time(p)!.ms-time(cluster.at(-1)!)!.ms>RULES.locationGapHours*3600000||cluster.some(q=>distance(gps(q)!,gps(p)!)>RULES.radiusMetres))){add('location',cluster,zone);cluster=[];}
   cluster.push(p);
  }
  add('section',section,zone);add('location',cluster,zone);
 }
 // Untimed points are independent candidates: selection order must not become route history.
 for(const p of photos)if(!time(p)&&gps(p)&&!excluded.location.has(p.id))add('location',[p],'Time unknown');
 for(const p of proposals){
  if(p.members.some(id=>rapid.has(id)))p.reasons.push('Rapid GPS jump (>100 km, >300 km/h); review clocks and coordinates');
  if(zones.size>1)p.reasons.push('Multiple timezone groups; no ordering between floating and offset clocks');
  const warnings=photos.filter(x=>p.members.includes(x.id)).flatMap(x=>[...x.metadata.warnings,...(x.metadata.capture?.warnings??[])]);
  if(warnings.length){p.confidence='tentative';p.reasons.push(...new Set(warnings));}
 }
 return {proposals,unknown,missingGps:photos.filter(p=>!gps(p)).map(p=>p.id),rules:RULES};
}
