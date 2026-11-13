import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Button, ScrollView, Text } from 'react-native';
import { Image } from 'expo-image';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { File } from 'expo-file-system';
import { verifyHeic } from './native-verification';
function App() {
  const [status,setStatus]=useState('HEIC disposable audit');
  const [previews,setPreviews]=useState<string[]>([]);
  async function run(uri?:string) { try { const result=await verifyHeic(uri);setPreviews(result);setStatus('PASS: native HEIC import, integration, archive roundtrip'); } catch(e) {setStatus(String(e));console.error('HEIC_AUDIT FAIL',String(e));} }
  useEffect(()=>{void run();},[]);
  return <ScrollView><Text>{status}</Text><Button title="Test photo picker" onPress={()=>{void launchImageLibraryAsync({mediaTypes:['images'],quality:1,exif:false,base64:false}).then(r=>{if(!r.canceled)void run(r.assets[0].uri);});}}/><Button title="Test files picker" onPress={()=>{void File.pickFileAsync({mimeTypes:['image/*']}).then(r=>{if(!r.canceled)void run(r.result.uri);});}}/>{previews.map((uri,i)=><Image key={uri} source={{uri}} style={{width:320,height:240}} contentFit="contain" onLoad={()=>console.log('HEIC_AUDIT IMAGE_LOADED',i)} onError={e=>console.error('HEIC_AUDIT IMAGE_FAILED',e.error)}/>)}</ScrollView>;
}
registerRootComponent(App);
