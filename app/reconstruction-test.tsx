import {useState} from 'react';
import {Button,ScrollView,Text} from 'react-native';
import {router} from 'expo-router';
import {seedReconstruction,auditReconstruction} from '../tests/step6/native-verification';
export default function ReconstructionTest(){const [status,setStatus]=useState('Synthetic Step 6 verification');const [busy,setBusy]=useState(false);if(!__DEV__)return null;return <ScrollView contentContainerStyle={{padding:24,gap:20}}><Button title="Prepare Step 6 photos" disabled={busy} onPress={async()=>{setBusy(true);try{const id=await seedReconstruction();setStatus(id);router.push(`/trips/${id}`);}catch(e){setStatus(String(e));}finally{setBusy(false);}}}/><Button title="Audit Step 6 after restart" disabled={busy} onPress={async()=>{setBusy(true);try{setStatus(await auditReconstruction());}catch(e){setStatus(String(e));}finally{setBusy(false);}}}/><Text selectable>{status}</Text></ScrollView>}
