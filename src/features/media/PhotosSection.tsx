import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { Action, Problem, message, styles } from '../trips/ui';
import { mediaService, selectPhotos } from './service';
import type { ImportItem } from './repository';

export default function PhotosSection({tripId}: {tripId:string}) {
  const [count,setCount]=useState(0); const [items,setItems]=useState<ImportItem[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useFocusEffect(useCallback(()=>{
    let active=true; let unsubscribe:(()=>void)|undefined;
    mediaService().then(service=>{
      const read=async()=>{ try {
        const photos=await service.gallery(tripId); const jobs=await service.repository.items(tripId);
        if(active){setCount(photos.length);setItems(jobs);}
      } catch(e){if(active)setError(message(e));} };
      if(active){unsubscribe=service.repository.subscribe(()=>{void read();});void read();}
    }).catch(e=>{if(active)setError(message(e));});
    return()=>{active=false;unsubscribe?.();};
  },[tripId]));
  async function act(retry=false) {
    setBusy(true);setError('');
    try { if(retry) await (await mediaService()).run(true); else await selectPhotos(tripId); }
    catch(e){setError(message(e));} finally{setBusy(false);}
  }
  const n=(state:string)=>items.filter(i=>i.state===state).length;
  const failures=items.filter(i=>['failed','unsupported','retry_required'].includes(i.state));
  return <View>
    <Text style={styles.section}>Photos</Text>
    <Text style={styles.text}>{count?`${count===60?'60+':count} ${count===1?'photo':'photos'}`:'No photos added yet'}</Text>
    <Text style={styles.text}>JPEG and PNG still photos. Imported files preserve the received bytes. Motion is not archived.</Text>
    <Action title={busy?'Importing…':'Add photos'} disabled={busy} onPress={()=>{void act();}} />
    {count>0&&<Action title="View photos" onPress={()=>router.push(`/trips/${tripId}/photos`)} />}
    {items.length>0&&<Text accessibilityLiveRegion="polite" style={styles.text}>{items.length} selected · {n('archived')} archived · {n('unsupported')} unsupported · {n('failed')} failed · {n('retry_required')} retry required · {items.filter(i=>['copying','staged','verified','selected'].includes(i.state)).length} importing</Text>}
    {items.some(i=>i.result==='already_added')&&<Text>Already added: exact duplicates reused.</Text>}
    {failures.slice(-10).map(i=><Text key={i.id} style={styles.error}>{i.original_filename||`Photo ${i.ordinal+1}`}: {i.state.replace('_',' ')} — {i.error_code==='SOURCE_UNAVAILABLE'?'Select this photo again using Add photos':i.error_code==='ORIGINAL_MISSING'?'Original unavailable; select this photo again':i.error_code?.startsWith('UNSUPPORTED')?'Convert to a still JPEG or PNG and retry':i.error_code==='STORAGE_FULL'?'Storage full; free space outside the vault and retry':i.error_code}</Text>)}
    {items.length>0&&<Action title="Retry imports / previews" disabled={busy} onPress={()=>{void act(true);}} />}
    {error?<Problem error={error}/>:null}
  </View>;
}
