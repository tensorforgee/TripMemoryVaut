import TagSection from '../tags/TagSection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, FlatList, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { openVaultDatabase } from '../../core/database/open';
import type { Memory } from '../../domain/memory';
import type { TripDay } from '../../domain/trip-day';
import type { RouteStop } from '../route/repository';
import type { VaultPhoto } from '../map/photo-memory-repository';
import { dateForm, formDate, type DateForm } from '../route/forms';
import { sectionTitle } from '../timeline/presentation';
import { dateLabel } from '../trips/presentation';
import { Action, Problem, message, styles } from '../trips/ui';
import { mediaService } from '../media/service';

type Draft = { id?: string; title: string; body: string; dates: DateForm; dayId: string | null; stopId: string | null; mediaIds: string[] };
const fromMemory = (n?: Memory): Draft => ({ id:n?.id,title:n?.title ?? '',body:n?.body ?? '',dates:dateForm(n?.dates ?? null),dayId:n?.dayId ?? null,stopId:n?.stopId ?? null,mediaIds:n?.mediaIds ?? [] });

function Photo({ id, large = false }: { id: string; large?: boolean }) {
  const [uri,setUri] = useState<string>(), [original,setOriginal] = useState<string>(), [failed,setFailed] = useState(false);
  useEffect(() => {
    let active=true;
    void Promise.all([openVaultDatabase(),mediaService()]).then(async ([v,s]) => {
      const photo=await v.photoMemories.photo(id);
      const assets=await s.repository.assets(false,[id]);
      const source=assets[0]?.relative_path;
      const fallback=source && await s.files.exists(source) ? s.files.uri(source) : undefined;
      const path=large ? photo?.display : photo?.thumbnail;
      const preferred=path && await s.files.exists(path) ? s.files.uri(path) : fallback;
      if (active) { setOriginal(fallback);setUri(preferred); }
    }).catch(()=>{if(active)setFailed(true);});
    return()=>{active=false;};
  },[id,large]);
  return uri && !failed ? <Image accessibilityLabel="Attached vault photo" source={{uri}} style={{width:'100%',height:large ? 420 : 100}} contentFit="contain" onError={()=>original && uri!==original ? setUri(original) : setFailed(true)} />
    : <Text style={styles.text}>Photo preview unavailable</Text>;
}

function PhotoPicker({ selected, change, close }: { selected:string[]; change:(ids:string[])=>void; close:()=>void }) {
  const [photos,setPhotos]=useState<VaultPhoto[]>([]),[more,setMore]=useState(true),[error,setError]=useState('');
  const lock=useRef(false);
  async function load(after?:string) {
    if(lock.current)return;lock.current=true;
    try { const page=await (await openVaultDatabase()).photoMemories.photos(after);setPhotos(p=>after?[...p,...page]:page);setMore(page.length===60);setError(''); }
    catch(e){setError(message(e));}finally{lock.current=false;}
  }
  useEffect(()=>{void load();},[]);
  return <Modal onRequestClose={close} animationType="slide"><SafeAreaView style={[styles.page,{padding:20}]}>
    <Text style={styles.heading}>Attach vault photos</Text><Text style={styles.text}>Select existing imported photos. {selected.length} attached.</Text>
    <Action title="Done choosing photos" onPress={close}/>{error ? <Problem error={error} retry={()=>void load(photos.at(-1)?.media_id)}/> : null}
    <FlatList data={photos} keyExtractor={p=>p.media_id} numColumns={2} ListEmptyComponent={<Text>No imported photos. Import them from a trip’s Photos section first.</Text>}
      ListFooterComponent={more ? <Action title="More photos" onPress={()=>void load(photos.at(-1)?.media_id)}/> : null}
      renderItem={({item})=><Pressable accessibilityRole="checkbox" accessibilityState={{checked:selected.includes(item.media_id)}} accessibilityLabel={`Attach ${item.original_filename ?? 'photo'}`} onPress={()=>change(selected.includes(item.media_id)?selected.filter(id=>id!==item.media_id):[...selected,item.media_id])} style={[styles.card,{width:'48%',marginRight:'2%',borderWidth:2,borderColor:selected.includes(item.media_id)?'#146775':'transparent'}]}>
        <Photo id={item.media_id}/><Text>{selected.includes(item.media_id)?'✓ ':''}{item.original_filename ?? 'Imported photo'}</Text>
      </Pressable>}/>
  </SafeAreaView></Modal>;
}

function Editor({ tripId, initial, original, days, stops, close }: { tripId:string; initial:Draft; original?:Memory; days:TripDay[]; stops:RouteStop[]; close:()=>void }) {
  const [draft,setDraft]=useState(initial),[busy,setBusy]=useState(false),[picking,setPicking]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const latest=useRef(initial), queue=useRef<Promise<void>>(Promise.resolve()),generation=useRef(0),lock=useRef(false);
  const navigation=useNavigation();
  function change(patch:Partial<Draft>) {
    const next={...latest.current,...patch}; latest.current=next;setDraft(next);setStatus('Saving draft…');const current=++generation.current;
    queue.current=queue.current.catch(()=>{}).then(async()=>{await (await openVaultDatabase()).memories.saveDraft(tripId,JSON.stringify(next));});
    void queue.current.then(()=>{if(current===generation.current){setStatus('Draft saved on device');setError('');}}).catch(e=>{if(current===generation.current){setStatus('Draft not saved');setError(message(e));}});
  }
  usePreventRemove(true,({data})=>{
    if(lock.current)return;
    void queue.current.then(()=>navigation.dispatch(data.action)).catch(e=>setError(message(e)));
  });
  async function save() {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      await queue.current;
      await (await openVaultDatabase()).memories.save(tripId,{...draft,dates:formDate(draft.dates,original?.dates)},draft.id);
      close();
    }catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}
  }
  async function leave(discard:boolean) {
    if(lock.current)return;lock.current=true;setBusy(true);
    try { await queue.current; if(discard)await (await openVaultDatabase()).memories.discardDraft(tripId);close(); }
    catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}
  }
  return <ScrollView keyboardShouldPersistTaps="handled" style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.heading}>{draft.id?'Edit memory':'Create memory'}</Text>
    <TextInput accessibilityLabel="Memory title" placeholder="Title" style={styles.input} value={draft.title} maxLength={200} editable={!busy} onChangeText={title=>change({title})}/>
    <TextInput accessibilityLabel="Memory description" placeholder="What do you remember?" style={[styles.input,{minHeight:150,textAlignVertical:'top'}]} multiline value={draft.body} maxLength={1000000} editable={!busy} onChangeText={body=>change({body})}/>
    <Text style={styles.text}>{status}</Text>
    <Text style={styles.section}>Optional date</Text><Text style={styles.text}>Leave blank for unknown. Enter YYYY, YYYY-MM or YYYY-MM-DD.</Text>
    <TextInput accessibilityLabel="Memory date" placeholder="Date (optional)" style={styles.input} value={draft.dates.start} editable={!busy} onChangeText={start=>change({dates:{...draft.dates,start}})}/>
    <TextInput accessibilityLabel="Memory end date" placeholder="End date (optional)" style={styles.input} value={draft.dates.end} editable={!busy} onChangeText={end=>change({dates:{...draft.dates,end}})}/>
    <View style={styles.row}><Text>Approximate date</Text><Switch accessibilityLabel="Approximate memory date" disabled={busy} value={draft.dates.approximate} onValueChange={approximate=>change({dates:{...draft.dates,approximate}})}/></View>
    <TextInput accessibilityLabel="Memory date label" placeholder="Date label (optional)" style={styles.input} value={draft.dates.label} editable={!busy} onChangeText={label=>change({dates:{...draft.dates,label}})}/>
    <Text style={styles.section}>Context</Text><Text style={styles.text}>Choose one existing timeline section or Stop. A Stop supplies its Place context.</Text>
    <Action title={`${!draft.dayId&&!draft.stopId?'✓ ':''}Trip only`} disabled={busy} onPress={()=>change({dayId:null,stopId:null})}/>
    {days.map(d=><Action key={d.id} title={`${draft.dayId===d.id?'✓ ':''}Section: ${sectionTitle(d)}`} disabled={busy} onPress={()=>change({dayId:d.id,stopId:null})}/>)}
    {stops.map(s=><Action key={s.id} title={`${draft.stopId===s.id?'✓ ':''}Stop ${s.position+1}: ${s.place.name}`} disabled={busy} onPress={()=>change({dayId:null,stopId:s.id})}/>)}
    <Text style={styles.section}>Photos ({draft.mediaIds.length})</Text>
    {draft.mediaIds.map((id,i)=><View key={id}><Photo id={id}/><Action title={`Detach photo ${i+1}`} disabled={busy} onPress={()=>change({mediaIds:draft.mediaIds.filter(m=>m!==id)})}/></View>)}
    <Action title="Attach existing photos" disabled={busy} onPress={()=>setPicking(true)}/>
    {picking && <PhotoPicker selected={draft.mediaIds} change={mediaIds=>change({mediaIds})} close={()=>setPicking(false)}/>}
    {error ? <Problem error={error}/> : null}
    <Action title={busy?'Saving…':'Save memory'} disabled={busy} onPress={()=>void save()}/>
    <Action title="Close and keep draft" disabled={busy} onPress={()=>void leave(false)}/>
    <Action title="Discard draft" disabled={busy} onPress={()=>Alert.alert('Discard unsaved memory changes?','The saved memory and source photos will be kept.',[{text:'Keep editing',style:'cancel'},{text:'Discard',style:'destructive',onPress:()=>void leave(true)}])}/>
  </ScrollView>;
}

export default function MemoriesScreen() {
  const {tripId,memoryId}=useLocalSearchParams<{tripId:string;memoryId?:string}>();
  const [memories,setMemories]=useState<Memory[]>([]),[days,setDays]=useState<TripDay[]>([]),[stops,setStops]=useState<RouteStop[]>([]);
  const [selected,setSelected]=useState<string|undefined>(memoryId),[editing,setEditing]=useState<Draft>(),[draft,setDraft]=useState<Draft>();
  const [error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[viewer,setViewer]=useState<string>();
  const load=useCallback(async()=>{
    try { const v=await openVaultDatabase();const [n,d,r,saved]=await Promise.all([v.memories.list(tripId),v.timeline.listTripDays(tripId),v.routes.getRoute(tripId),v.memories.draft(tripId)]);
      setMemories(n);setDays(d);setStops(r.stops);setDraft(saved?JSON.parse(saved):undefined);setReady(true);setError('');
    }catch(e){setError(message(e));}
  },[tripId]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  const current=memories.find(n=>n.id===selected);
  if(editing)return <Editor tripId={tripId} initial={editing} original={memories.find(n=>n.id===editing.id)} days={days} stops={stops} close={()=>{setEditing(undefined);void load();}}/>;
  return <ScrollView keyboardShouldPersistTaps="handled" style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Memories</Text>{error?<Problem error={error} retry={()=>void load()}/>:null}
    {!ready ? <Text>Opening memories…</Text> : <>
      {draft ? <><Text style={styles.text}>An unfinished memory draft is saved on this device.</Text><Action title="Resume memory draft" onPress={()=>setEditing(draft)}/></> : <Action title="Create memory" onPress={()=>setEditing(fromMemory())}/>}
      {current ? <View style={styles.card}>
        <Action title="All memories" onPress={()=>setSelected(undefined)}/><Text style={styles.section}>{current.title}</Text><Text style={styles.text}>{current.dates?dateLabel(current.dates):'Date unknown'}</Text>
        <Text style={styles.text}>{current.dayId?`Section: ${days.find(d=>d.id===current.dayId)?sectionTitle(days.find(d=>d.id===current.dayId)!):'Unavailable section'}`:current.stopId?`Stop: ${stops.find(s=>s.id===current.stopId)?.place.name ?? 'Unavailable Stop'}`:'Trip memory'}</Text>
        <Text selectable style={styles.text}>{current.body}</Text>
        <TagSection key={current.id} target={{kind:'memory',id:current.id}} />
        {current.mediaIds.map((id,i)=><Pressable key={id} accessibilityRole="button" accessibilityLabel={`Open attached photo ${i+1}`} onPress={()=>setViewer(id)}><Photo id={id}/></Pressable>)}
        <Action title="Edit memory" disabled={!!draft||busy} onPress={()=>setEditing(fromMemory(current))}/>
        <Action title="Remove memory" disabled={busy} onPress={()=>Alert.alert(`Remove “${current.title}”?`,'The written memory will be removed. Its source photos and other uses will be kept.',[{text:'Cancel',style:'cancel'},{text:'Remove memory',style:'destructive',onPress:()=>{setBusy(true);void openVaultDatabase().then(v=>v.memories.remove(tripId,current.id)).then(()=>{setSelected(undefined);return load();}).catch(e=>setError(message(e))).finally(()=>setBusy(false));}}])}/>
      </View> : <>{!memories.length?<Text style={styles.text}>No written memories yet. Add a recollection with as much or as little date information as you know.</Text>:null}
        {memories.map(n=><Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`Memory: ${n.title}`} style={styles.card} onPress={()=>setSelected(n.id)}><Text style={styles.section}>{n.title}</Text><Text style={styles.text}>{n.dates?dateLabel(n.dates):'Date unknown'}</Text><Text numberOfLines={3} style={styles.text}>{n.body}</Text><Text>{n.mediaIds.length} photos</Text></Pressable>)}
      </>}
    </>}
    <Modal visible={!!viewer} onRequestClose={()=>setViewer(undefined)}><SafeAreaView style={[styles.page,{padding:20}]}><Action title="Close photo" onPress={()=>setViewer(undefined)}/>{viewer?<Photo id={viewer} large/>:null}</SafeAreaView></Modal>
  </ScrollView>;
}
