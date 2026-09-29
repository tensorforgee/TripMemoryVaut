import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Action, Problem, message, styles } from '../trips/ui';
import { reconstructionService } from './service';
import type { Suggestion, Acceptance } from './repository';
import type { PhotoEvidence, Proposal } from '../../services/reconstruction/rules';
import { nativeMediaFiles } from '../../core/media/native-adapter';
export default function ReconstructionScreen(){
 const {tripId}=useLocalSearchParams<{tripId:string}>();const [rows,setRows]=useState<Suggestion[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [context,setContext]=useState<Awaited<ReturnType<typeof reconstructionService>>>();
 const [days,setDays]=useState<{id:string;label:string|null}[]>([]);const [places,setPlaces]=useState<{id:string;name:string}[]>([]);const [stops,setStops]=useState<{id:string;place:{name:string}}[]>([]);const [query,setQuery]=useState('');
 const refresh=useCallback(async()=>{const c=await reconstructionService();setContext(c);setRows(await c.repository.list(tripId));setDays(await c.vault.timeline.listTripDays(tripId));setStops((await c.vault.routes.getRoute(tripId)).stops);setPlaces(await c.vault.routes.listPlaces(query));},[tripId,query]);
 useFocusEffect(useCallback(()=>{void refresh().catch(e=>setError(message(e)));},[refresh]));
 async function work(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(message(e));}finally{setBusy(false);}}
 return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
  <Text style={styles.heading}>Reconstruct from photos</Text>
  <Text style={styles.text}>Suggestions do not change your trip until accepted. Dates describe photo evidence, not departure or return. Existing structure and source metadata are preserved.</Text>
  <Action title="Run reconstruction" disabled={busy} onPress={()=>void work(async()=>{await (await reconstructionService()).repository.run(tripId);})}/>
  {error?<Problem error={error}/>:null}
  <Text style={styles.section}>Existing structure</Text><Text>{days.length} sections · {stops.length} Stops. New sections and Stops append in the order you accept them; no route order is inferred.</Text>
  <TextInput accessibilityLabel="Find existing Place" placeholder="Find existing Place to reuse" style={styles.input} value={query} onChangeText={setQuery}/>
  {rows.filter(s=>s.kind==='run').reverse().map((run,index)=>{const summary=JSON.parse(run.payload_json);const evidence=JSON.parse(run.evidence_json) as {photos:PhotoEvidence[]};return <View key={run.id}>
   <Text style={styles.section}>Run {rows.filter(s=>s.kind==='run').length-index} · {summary.count} photos</Text>
   <Text>{summary.unknown.length} date unknown · {summary.missingGps.length} without GPS. Unknown dates remain ungrouped.</Text>
   {summary.unknown.map((id:string)=>{const p=evidence.photos.find(x=>x.id===id);return <Text key={id}>Date unknown: {p?.filename??id}</Text>;})}
   {rows.filter(s=>s.run_id===run.id).map(s=><Review key={s.id} suggestion={s} busy={busy} days={days} places={places} stops={stops} uri={path=>context?nativeMediaFiles(context.vault.vault.id).uri(path):''}
    save={(label,members)=>work(()=>context!.repository.edit(tripId,s.id,label,members))} reject={()=>work(()=>context!.repository.reject(tripId,s.id))}
    accept={choice=>work(()=>context!.repository.accept(tripId,s.id,choice))}/>)}
  </View>;})}
 </ScrollView>;
}
function Review({suggestion:s,busy,days,places,stops,uri,save,reject,accept}:{suggestion:Suggestion;busy:boolean;days:{id:string;label:string|null}[];places:{id:string;name:string}[];stops:{id:string;place:{name:string}}[];uri:(p:string)=>string;save:(label:string,members:string[])=>Promise<void>;reject:()=>Promise<void>;accept:(c:Acceptance)=>Promise<void>}){
 const p=JSON.parse(s.payload_json) as Proposal;const photos=(JSON.parse(s.evidence_json) as {photos:PhotoEvidence[]}).photos;
 const [label,setLabel]=useState(p.label);const [members,setMembers]=useState(p.members);const [mapping,setMapping]=useState<Acceptance>({});const [expanded,setExpanded]=useState(false);
 const dirty=label!==p.label||JSON.stringify(members)!==JSON.stringify(p.members);
 return <View style={styles.card}><Text style={styles.section}>{p.kind==='section'?'Suggested section':'Candidate location / Stop'} · {s.state}</Text>
 <Text>{p.confidence==='supported'?'From photo timestamp/GPS':'Suggested — check this'} · {p.members.length} photos</Text>
 <Text>{p.start??'Time unknown'}{p.end?' – '+p.end:''}</Text><Text>{p.reasons.join('\n')}</Text>
 {p.point?<Text>Coordinates: {p.point.latitude.toFixed(5)}, {p.point.longitude.toFixed(5)} · inferred area</Text>:null}
 {s.state==='pending'?<TextInput accessibilityLabel={p.kind==='section'?'Section name':'Location name'} style={styles.input} value={label} onChangeText={setLabel}/>:<Text>{p.label}</Text>}
 <Action title={expanded?'Hide included photos':'Review included photos'} onPress={()=>setExpanded(!expanded)}/>
 {expanded&&photos.map(photo=><View key={photo.id}>{photo.thumbnail?<Image source={{uri:uri(photo.thumbnail)}} style={{height:100,width:100}} contentFit="contain"/>:null}<Text>{photo.filename??'Imported photo'} · {photo.metadata.capture?.local??'Date unknown'} · {photo.metadata.gps?'GPS present':'No GPS'}</Text>{s.state==='pending'?<Action title={`${members.includes(photo.id)?'Exclude':'Include'} ${photo.filename??'photo'}`} onPress={()=>setMembers(old=>old.includes(photo.id)?old.filter(id=>id!==photo.id):[...old,photo.id])}/>:null}</View>)}
 {s.state==='pending'?<>
 <Action title="Save suggestion edits" disabled={busy||!members.length} onPress={()=>void save(label,members)}/>
 <Text>Reuse selection: {mapping.dayId?days.find(d=>d.id===mapping.dayId)?.label:mapping.stopId?stops.find(x=>x.id===mapping.stopId)?.place.name:mapping.placeId?places.find(x=>x.id===mapping.placeId)?.name:'Create new'}</Text>
 <Action title="Create new" onPress={()=>setMapping({})}/>
 {p.kind==='section'?days.map(d=><Action key={d.id} title={`Use section: ${d.label??'Unnamed section'}`} onPress={()=>setMapping({dayId:d.id})}/>):<>
 {stops.map(stop=><Action key={stop.id} title={`Use existing Stop: ${stop.place.name}`} onPress={()=>setMapping({stopId:stop.id})}/>)}
 {places.map(place=><Action key={place.id} title={`Use Place / append Stop: ${place.name}`} onPress={()=>setMapping({placeId:place.id})}/>)}</>}
 <Action title={p.kind==='section'?'Accept section':'Accept Place / Stop'} disabled={busy||dirty} onPress={()=>Alert.alert('Confirm reconstruction',p.kind==='section'?'Create or reuse this section and associate the included photos?':mapping.stopId?'Associate these photos with the selected existing Stop?':'Confirm this Place and append a new Stop at the end of the route? This does not infer chronological route order.',[{text:'Cancel',style:'cancel'},{text:'Accept',onPress:()=>void accept({...mapping,confirmPlace:true,confirmAppend:true})}])}/>
 {dirty?<Text>Save edits before accepting.</Text>:null}<Action title="Reject suggestion" disabled={busy} onPress={()=>void reject()}/>
 </>:<Text>{s.resolution_json?'Accepted. Edit canonical structure in Timeline or Route / Stops.':'Rejected; canonical trip unchanged.'}</Text>}
 </View>;
}
