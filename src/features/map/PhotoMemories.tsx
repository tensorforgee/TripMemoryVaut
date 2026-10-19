import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Marker } from '@maplibre/maplibre-react-native';
import { openVaultDatabase } from '../../core/database/open';
import type { ImportPipeline } from '../../services/import/pipeline';
import { mediaService } from '../media/service';
import { Action, message, Problem, styles } from '../trips/ui';
import { coordinateLabel, type PinDraft } from './photo-memory-model';
import type { PhotoMemoryPin, VaultPhoto } from './photo-memory-repository';

function useMedia() {
  const [service, setService] = useState<ImportPipeline>();
  useEffect(() => { let active = true; void mediaService().then(s => { if (active) setService(s); }).catch(() => { /* Editor save exposes unavailable storage; markers retain placeholders. */ }); return () => { active = false; }; }, []);
  return service;
}

function Preview({ photo, large = false, service }: { photo: VaultPhoto; large?: boolean; service?: ImportPipeline }) {
  const path = large ? photo.display : photo.thumbnail;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  return path && service && !failed && photo.original_state === 'available'
    ? <Image source={{ uri: service.files.uri(path) }} style={{ width: '100%', height: '100%' }} contentFit={large ? 'contain' : 'cover'} onError={() => setFailed(true)} />
    : <View style={{ flex: 1, backgroundColor: '#dbe2e9', alignItems: 'center', justifyContent: 'center' }}><Text>{large ? 'Preview unavailable. Retry previews to rebuild it.' : '▧'}</Text></View>;
}

export function PhotoMemoryMarkers({ pins, select }: { pins: PhotoMemoryPin[]; select: (pin: PhotoMemoryPin) => void }) {
  const service = useMedia();
  return <>{pins.map(pin => <Marker key={pin.id} id={`photo-${pin.id}`} lngLat={[pin.longitude,pin.latitude]} anchor="bottom"
    onPress={event => { event.stopPropagation(); select(pin); }} accessibilityRole="button" accessibilityLabel={`Photo memory: ${pin.note || pin.original_filename || 'Imported photo'}`}>
    <View pointerEvents="none" style={{ width: 48, height: 48, borderWidth: 3, borderColor: '#146775', borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' }}>
      <Preview photo={pin} service={service} />
    </View>
  </Marker>)}</>;
}

export function PhotoMemoryEditor({ tripId, draft, setDraft, selected, setSelected, pins }: {
  tripId: string; draft: PinDraft | null; setDraft: (value: PinDraft | null) => void;
  selected: PhotoMemoryPin | null; setSelected: (pin: PhotoMemoryPin | null) => void; pins: PhotoMemoryPin[];
}) {
  const service = useMedia();
  const [photos, setPhotos] = useState<VaultPhoto[]>([]);
  const [chosen, setChosen] = useState<VaultPhoto | null>(null);
  const [more, setMore] = useState(false), [error, setError] = useState('');
  const [viewer, setViewer] = useState(false), [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false), [showList, setShowList] = useState(false);
  const loading = useRef(false), saving = useRef(false);
  useEffect(() => {
    let active = true; setError(''); setViewer(false); setChosen(null); setPicking(!!draft && !draft.mediaId);
    if (draft?.mediaId) void openVaultDatabase().then(v => v.photoMemories.photo(draft.mediaId!)).then(p => { if (active) setChosen(p); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [draft?.id, draft?.mediaId, !!draft]);
  useEffect(() => {
    let active = true;
    if (picking) void openVaultDatabase().then(v => v.photoMemories.photos()).then(p => { if (active) { setPhotos(p); setMore(p.length === 60); } }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [picking]);
  const close = () => {
    if (saving.current) return;
    const discard = () => { setDraft(null); setSelected(null); setViewer(false); setPicking(false); setShowList(false); setError(''); };
    if (draft) Alert.alert('Discard unsaved photo memory?', 'Changes have not been saved.', [{text:'Keep editing',style:'cancel'}, {text:'Discard',style:'destructive',onPress:discard}]);
    else discard();
  };
  async function next() {
    if (!more || loading.current || !photos.length) return;
    loading.current = true;
    try { const v = await openVaultDatabase(); const page = await v.photoMemories.photos(photos[photos.length - 1].media_id); setPhotos(p => [...p,...page]); setMore(page.length === 60); }
    catch (e) { setError(message(e)); } finally { loading.current = false; }
  }
  async function save() {
    if (!draft?.mediaId || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      // Reconcile the selected asset using the same file boundary as the gallery.
      if (!service) throw new Error('Photo storage is opening. Try again.');
      const assets = await service.repository.assets(false,[draft.mediaId]);
      if (!assets.length || !await service.files.exists(assets[0].relative_path)) throw new Error('Original unavailable. Repair this photo before attaching it.');
      const v = await openVaultDatabase();
      await v.photoMemories.save(tripId,{ mediaId:draft.mediaId, coordinate:draft.coordinate, note:draft.note },draft.id);
      setDraft(null); setSelected(null); setPicking(false);
    } catch (e) { setError(message(e)); } finally { saving.current = false; setBusy(false); }
  }
  const edit = () => { if (selected) { setDraft({id:selected.id,coordinate:[selected.longitude,selected.latitude],mediaId:selected.media_id,note:selected.note ?? '',moving:false}); setSelected(null); } };
  const remove = () => {
    if (!selected || saving.current) return;
    Alert.alert('Remove photo memory?', 'The imported photo and its other uses will be retained.', [{text:'Cancel',style:'cancel'}, {text:'Remove pin',style:'destructive',onPress:() => {
      saving.current = true; setBusy(true);
      void openVaultDatabase().then(v => v.photoMemories.remove(tripId,selected.id)).then(() => setSelected(null)).catch(e => setError(message(e))).finally(() => {saving.current=false;setBusy(false);});
    }}]);
  };
  const current = selected ?? chosen;
  return <>
    <View style={{flexDirection:'row',paddingHorizontal:16,gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <Text style={{color:'#465f5c',fontSize:12,flex:1}}>{draft?.moving ? 'Long-press the new location, then save.' : 'Long-press the map to add a photo memory.'}</Text>
      {draft?.moving ? <Action title="Cancel move" onPress={() => setDraft({...draft,moving:false})} />
        : <Action title={`Photo memories (${pins.length})`} onPress={() => {setShowList(true);setError('');}} />}
    </View>
    <Modal visible={!!selected || (!!draft && !draft.moving) || showList} onRequestClose={close} animationType="slide">
      {(selected || draft || showList) && <SafeAreaView style={[styles.page,{padding:16}]}>
        <Action title={draft ? 'Cancel' : viewer ? 'Close photo' : 'Close photo memories'} onPress={() => viewer ? setViewer(false) : close()} />
        {error ? <Problem error={error} /> : null}
        {showList && !selected && !draft ? <FlatList data={pins} keyExtractor={p=>p.id} ListEmptyComponent={<Text style={styles.text}>Long-press any map location to attach an imported photo.</Text>}
          renderItem={({item}) => <Pressable accessibilityRole="button" onPress={() => {setSelected(item);setShowList(false);}} style={{padding:12,flexDirection:'row',gap:12}}>
            <View style={{width:56,height:56}}><Preview photo={item} service={service} /></View><View style={{flex:1}}><Text style={styles.text}>{item.note || item.original_filename || 'Photo memory'}</Text><Text>{coordinateLabel([item.longitude,item.latitude])}</Text></View>
          </Pressable>} /> : viewer && current ? <View style={{flex:1}}><Preview photo={current} service={service} large /></View> : <>
          <Text style={styles.heading}>{draft ? draft.id ? 'Edit photo memory' : 'Add photo memory here' : 'Photo memory'}</Text>
          <Text style={styles.text}>{coordinateLabel(draft?.coordinate ?? [selected!.longitude,selected!.latitude])}</Text>
          <Text style={styles.text}>Manually placed memory · does not confirm a visit or change the photo’s location metadata.</Text>
          {picking && draft ? <>
            <Text style={styles.text}>Choose an existing imported photo from your vault</Text>
            <FlatList data={photos} numColumns={3} keyExtractor={p=>p.media_id} onEndReached={() => {void next();}} ListEmptyComponent={<Text style={styles.text}>No imported photos. Import photos from a trip’s Photos section first.</Text>}
              renderItem={({item}) => <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${item.original_filename || 'imported photo'}`} onPress={() => {setDraft({...draft,mediaId:item.media_id});setChosen(item);setPicking(false);}}
                style={{width:'33.33%',padding:4}}><View style={{aspectRatio:1}}><Preview photo={item} service={service} /></View><Text numberOfLines={1}>{item.original_filename || 'Imported photo'}</Text></Pressable>} />
          </> : <ScrollView keyboardShouldPersistTaps="handled">
            {current && <Pressable accessibilityRole="button" accessibilityLabel="Open photo viewer" onPress={() => setViewer(true)} style={{height:190,marginVertical:12}}><Preview photo={current} service={service} /></Pressable>}
            {draft ? <>
              <Action title="Choose another photo" disabled={busy} onPress={() => setPicking(true)} />
              <TextInput accessibilityLabel="Photo memory note" placeholder="Optional note" value={draft.note} onChangeText={note => setDraft({...draft,note})} multiline maxLength={10000} style={[styles.input,{minHeight:90}]} editable={!busy} />
              <Action title="Reposition on map" disabled={busy} onPress={() => setDraft({...draft,moving:true})} />
              <Action title={busy ? 'Saving…' : 'Save photo memory'} disabled={busy || !draft.mediaId} onPress={() => {void save();}} />
            </> : <>
              <Text style={styles.text}>{selected?.note || 'No note'}</Text>
              <Action title="Open photo" onPress={() => setViewer(true)} />
              <Action title="Edit / reposition" disabled={busy} onPress={edit} />
              <Action title="Remove pin" disabled={busy} onPress={remove} />
            </>}
            <Action title="Retry previews" onPress={() => {void service?.run(true).then(async () => {
              const v = await openVaultDatabase(); const photo = current && await v.photoMemories.photo(current.media_id);
              if (photo) { setChosen(photo); if (selected) setSelected({...selected,...photo}); }
            }).catch(e => setError(message(e)));}} />
          </ScrollView>}
        </>}
      </SafeAreaView>}
    </Modal>
  </>;
}
