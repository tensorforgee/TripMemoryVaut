import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Action, styles } from '../src/features/trips/ui';
import { auditNativeArchiveAfterRelaunch, runNativeArchiveRoundTrip } from '../tests/step12/native-verification';

export default function ArchiveTest(){
  const[status,setStatus]=useState('Development-only Step 12 archive verification.');const[busy,setBusy]=useState(false);
  if(!__DEV__)return null;const run=async(task:()=>Promise<string>)=>{setBusy(true);try{setStatus(await task());}catch(error){setStatus(`FAIL: ${String(error)}`);}finally{setBusy(false);}};
  return <ScrollView contentContainerStyle={styles.content}><Text selectable>{status}</Text><Action title="Run native export + restore" disabled={busy} onPress={()=>void run(runNativeArchiveRoundTrip)}/><Action title="Audit after relaunch" disabled={busy} onPress={()=>void run(auditNativeArchiveAfterRelaunch)}/></ScrollView>;
}
