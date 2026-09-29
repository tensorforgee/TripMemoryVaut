import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Action, Problem, message, styles } from '../trips/ui';
import { mediaService } from './service';
import type { Photo } from './repository';
import type { ImportPipeline } from '../../services/import/pipeline';

export default function GalleryScreen() {
  const {tripId}=useLocalSearchParams<{tripId:string}>();
  const [photos,setPhotos]=useState<Photo[]>([]); const [service,setService]=useState<ImportPipeline>();
  const [viewer,setViewer]=useState<Photo|null>(null); const [error,setError]=useState('');
  const [more,setMore]=useState(true); const [loading,setLoading]=useState(false);
  useFocusEffect(useCallback(()=>{
    let active=true;let unsub:(()=>void)|undefined;
    mediaService().then(s=>{
      const read=async()=>{try{const p=await s.gallery(tripId);if(active){setPhotos(p);setMore(p.length===60);setViewer(v=>v?p.find(x=>x.id===v.id)??v:null);}}catch(e){if(active)setError(message(e));}};
      if(active){setService(s);unsub=s.repository.subscribe(()=>{void read();});void read();}
    }).catch(e=>{if(active)setError(message(e));});
    return()=>{active=false;unsub?.();};
  },[tripId]));
  async function next(){if(!service||loading||!more||!photos.length)return;setLoading(true);try{const last=photos[photos.length-1];const p=await service.gallery(tripId,{position:last.position,id:last.id});setPhotos(old=>[...old,...p.filter(x=>!old.some(y=>y.id===x.id))]);setMore(p.length===60);}catch(e){setError(message(e));}finally{setLoading(false);}}
  async function retry(){try{await service?.run(true);}catch(e){setError(message(e));}}
  const uri=(path:string|null)=>path&&service?service.files.uri(path):undefined;
  return <View style={styles.page}>
    {error?<Problem error={error}/>:null}
    <FlatList data={photos} numColumns={3} keyExtractor={p=>p.id} contentContainerStyle={{padding:8}}
      onEndReached={()=>{void next();}} ListEmptyComponent={<Text style={styles.text}>No photos added yet</Text>}
      renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`Open photo ${item.position+1}${item.is_favourite?' favourite':''}`} onPress={()=>setViewer(item)} style={{width:'33.33%',padding:4}}>
        {item.thumbnail&&item.original_state==='available'?<Image source={{uri:uri(item.thumbnail)}} recyclingKey={item.id} style={{aspectRatio:1,width:'100%'}} contentFit="cover" onError={()=>setError('Preview unavailable. Retry previews to rebuild it.')} />:<View style={{aspectRatio:1,backgroundColor:'#dbe2e9',justifyContent:'center'}}><Text>{item.original_state==='available'?'Preview pending':'Original unavailable'}</Text></View>}
        {item.is_favourite===1&&<Text>★</Text>}
      </Pressable>}/>
    <Action title="Retry previews" onPress={()=>{void retry();}}/>
    <Modal visible={!!viewer} onRequestClose={()=>setViewer(null)} animationType="fade">
      <View style={[styles.page,{padding:20,paddingTop:48}]}>
        <Action title="Close photo" onPress={()=>setViewer(null)}/>
        {viewer?.display&&viewer.original_state==='available'?<Image source={{uri:uri(viewer.display)}} style={{flex:1}} contentFit="contain" onError={()=>setError('Preview unavailable. Retry previews.')} />:<Text style={styles.text}>Preview unavailable. The original is {viewer?.original_state==='available'?'archived':'unavailable'}.</Text>}
        <Text style={styles.text}>{viewer?.caption||viewer?.original_filename||'Imported photo'}</Text>
        <Action title="Retry preview" onPress={()=>{void retry();}}/>
        <Action title="Remove from trip" onPress={()=>{if(viewer)Alert.alert('Remove photo from this trip?','The archived original is retained.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{void service?.repository.remove(tripId,viewer.id).then(()=>setViewer(null)).catch(e=>setError(message(e)));}}]);}}/>
      </View>
    </Modal>
  </View>;
}
