import { useState } from 'react';
import { Button, ScrollView, Text } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { verifyNativeMedia, prepareNativeCrashCheckpoint } from '../tests/step5/native-verification';
export default function MediaTest() {
  const [status,setStatus]=useState('Development-only synthetic media verification.');
  const [busy,setBusy]=useState(false);
  if(!__DEV__)return null;
  return <ScrollView contentContainerStyle={{padding:24,gap:20}}><Button title="Verify Step 5 media" disabled={busy} onPress={async()=>{
    setBusy(true);setStatus('Running…');let report:string;
    try{const checks=await verifyNativeMedia();report=`PASS: ${checks.length} checks\n${checks.join('\n')}`;}catch(e){report=`FAIL: ${String(e)}`;}
    setStatus(report);new File(Paths.document,'step5-verification.txt').write(report);setBusy(false);
  }}/><Button title="Prepare crash checkpoint" disabled={busy} onPress={async()=>{setBusy(true);try{setStatus(await prepareNativeCrashCheckpoint());}catch(e){setStatus(String(e));}finally{setBusy(false);}}}/><Text selectable>{status}</Text></ScrollView>;
}
