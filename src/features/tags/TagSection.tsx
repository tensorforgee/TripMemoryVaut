import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../../core/database/open';
import type { Tag, TagTarget } from '../../domain/tag';
import { Action, Problem, message, styles } from '../trips/ui';

// Saved-item assignments commit immediately, independently of Trip/Memory editors.
// Without a target, this same selector supplies an all-selected-tags search filter.
export default function TagSection({ target, selected = [], onChange, onUpdated }: {
  target?: TagTarget; selected?: string[]; onChange?: (ids: string[]) => void; onUpdated?: () => void;
}) {
  const scroll=useRef<ScrollView>(null);
  const [tags,setTags]=useState<Tag[]>([]),[attached,setAttached]=useState<string[]>([]);
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[editing,setEditing]=useState<string>();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const ids=target?attached:selected;
  const load=useCallback(async()=>{
    const v=await openVaultDatabase(); const all=await v.tags.list();setTags(all);
    if(target)setAttached((await v.tags.forTarget(target)).map(g=>g.id));
  },[target?.kind,target?.id]);
  useFocusEffect(useCallback(()=>{void load().catch(e=>setError(message(e)));},[load]));
  async function run(action:()=>Promise<void>) {
    if(busy)return;setBusy(true);setError('');
    try{await action();await load();onUpdated?.();}catch(e){setError(message(e));}finally{setBusy(false);}
  }
  async function toggle(id:string) {
    if(target)await run(async()=>{await (await openVaultDatabase()).tags.setAttached(target,id,!ids.includes(id));});
    else onChange?.(ids.includes(id)?ids.filter(g=>g!==id):[...ids,id]);
  }
  const chosen=tags.filter(g=>ids.includes(g.id));
  return <View style={{gap:8}}>
    <Text style={styles.section}>{target?'Tags':'Filter by tags'}</Text>
    <Text style={styles.text}>{chosen.length?chosen.map(g=>g.name).join(' · '):target?'No tags yet.':'All tags'}{!target && chosen.length?' · Match all selected':''}</Text>
    <Action title={target?'Choose / manage tags':'Choose tags / manage tags'} onPress={()=>{setOpen(true);void load().catch(e=>setError(message(e)));}}/>
    {!target && ids.length>0?<Action title="Clear tag filters" onPress={()=>onChange?.([])}/>:null}
    {!open && error?<Problem error={error}/>:null}
    <Modal visible={open} animationType="slide" onRequestClose={()=>{if(!busy)setOpen(false);}}>
      <SafeAreaView style={styles.page}><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{target?'Organize with tags':'Filter by tags'}</Text>
        <Text style={styles.text}>{target?'Selections save immediately on this device.':'Trips and memories must have every selected tag. Tags are assigned separately to each item.'}</Text>
        <Action title="Done with tags" disabled={busy} onPress={()=>{setOpen(false);setEditing(undefined);setName('');}}/>
        <TextInput accessibilityLabel="Tag name" placeholder="New tag name" style={styles.input} maxLength={80} editable={!busy} value={name} onChangeText={setName}/>
        <Action title={editing?'Save tag name':'Create tag'} disabled={busy} onPress={()=>void run(async()=>{
          const v=await openVaultDatabase(); if(editing)await v.tags.rename(editing,name);else await v.tags.create(name);
          setName('');setEditing(undefined);
        })}/>
        {editing?<Action title="Cancel rename" disabled={busy} onPress={()=>{setEditing(undefined);setName('');}}/>:null}
        {error?<Problem error={error}/>:null}
        {!tags.length?<Text style={styles.text}>Create a reusable tag to get started.</Text>:null}
        {tags.map(tag=><View key={tag.id} style={styles.card}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`Tag: ${tag.name}`} accessibilityState={{checked:ids.includes(tag.id),disabled:busy}} disabled={busy} onPress={()=>void toggle(tag.id)} style={{paddingVertical:12}}>
            <Text style={styles.text}>{ids.includes(tag.id)?'✓ ':'○ '}{tag.name}</Text>
          </Pressable>
          <View style={{gap:8}}><Action title={`Rename ${tag.name}`} disabled={busy} onPress={()=>{setEditing(tag.id);setName(tag.name);scroll.current?.scrollTo({y:0,animated:true});}}/>
            <Action title={`Delete ${tag.name}`} disabled={busy} onPress={()=>Alert.alert(`Delete tag “${tag.name}”?`,'This removes the tag from every trip and memory. Trips, written memories and photos are kept.',[
              {text:'Cancel',style:'cancel'}, {text:'Delete tag',style:'destructive',onPress:()=>void run(async()=>{
                await (await openVaultDatabase()).tags.remove(tag.id);onChange?.(ids.filter(id=>id!==tag.id));
                if(editing===tag.id){setEditing(undefined);setName('');}
              })}
            ])}/></View>
        </View>)}
      </ScrollView></SafeAreaView>
    </Modal>
  </View>;
}
