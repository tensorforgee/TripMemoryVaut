import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../../core/database/open';
import { nativeMediaFiles } from '../../core/media/native-adapter';
import { Action, Problem, message, styles } from '../trips/ui';
import { resetMediaService } from '../media/service';
import { archiveOverview, createPortableExport, inspectPortableRestore, publishPortableExport, restorePortableArchive, type RestoreInspection } from '../../services/archive/portable';
import { nativeArchiveIO, newExportStagingRoot, pickExportDestination, pickRestorePackage } from '../../services/archive/native';

type Overview = Awaited<ReturnType<typeof archiveOverview>>;
function sizeLabel(bytes: number): string {
  if(bytes<1024)return `${bytes} B`; if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

export default function ArchiveScreen() {
  const [overview,setOverview]=useState<Overview>(); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false); const [selection,setSelection]=useState<{root:string;inspection:RestoreInspection}>();
  const load=useCallback(()=>{let active=true;openVaultDatabase().then(v=>archiveOverview(v.database,v.vault.id)).then(value=>{if(active)setOverview(value);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
  useFocusEffect(load);
  const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await task();}catch(e){setError(message(e));}finally{setBusy(false);}};
  const exportVault=()=>run(async()=>{
    const vault=await openVaultDatabase(); const io=nativeArchiveIO(); const stagingRoot=newExportStagingRoot();
    const result=await createPortableExport({database:vault.database,vaultId:vault.vault.id,io,mediaFiles:nativeMediaFiles(vault.vault.id),stagingRoot});
    let destination: string|undefined;
    try { destination=await pickExportDestination(result.packageName); await publishPortableExport(io,stagingRoot,destination); setNotice(`Export verified and saved as ${result.packageName}.`); }
    catch(e){if(destination)try{await io.removeRoot(destination);}catch{/* keep original failure */}throw e;}
    finally{try{await io.removeRoot(stagingRoot);}catch{/* cache cleanup is best effort */}}
  });
  const chooseRestore=()=>run(async()=>{const root=await pickRestorePackage();const inspection=await inspectPortableRestore(nativeArchiveIO(),root);setSelection({root,inspection});setNotice('Archive verified. Review the summary before restoring.');});
  const confirmRestore=()=>{
    if(!selection)return;
    Alert.alert('Restore into this fresh vault?', 'Restore preserves the backup IDs and replaces only an empty vault. Existing archive data is never merged or overwritten.',[
      {text:'Cancel',style:'cancel'},
      {text:'Restore',style:'destructive',onPress:()=>{void run(async()=>{
        const current=await openVaultDatabase();
        await restorePortableArchive({database:current.database,currentVaultId:current.vault.id,io:nativeArchiveIO(),archiveRoot:selection.root,destinationMedia:nativeMediaFiles(selection.inspection.manifest.vault.id),newStagingId:randomUUID});
        resetMediaService(); await current.close(); await openVaultDatabase(); setSelection(undefined); router.replace('/');
      });}},
    ]);
  };
  return <SafeAreaView style={styles.page} edges={['bottom','left','right']}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Archive & restore</Text>
    <Text style={styles.text}>Create a portable, human-inspectable copy of the vault, including byte-identical original photos. No cloud account is used.</Text>
    <View style={styles.card}><Text style={styles.section}>This vault</Text>
      {overview?<><Text style={styles.text}>{overview.trips} Trips</Text><Text style={styles.text}>{overview.places} Places</Text><Text style={styles.text}>{overview.photos} Photos</Text><Text style={styles.text}>Original media: {sizeLabel(overview.bytes)}</Text></>:<Text>Reading archive…</Text>}
      <Action title={busy?'Working…':'Export vault'} disabled={busy||!overview} onPress={exportVault}/>
    </View>
    <View style={styles.card}><Text style={styles.section}>Restore a vault</Text>
      <Text style={styles.text}>Choose a Trip Memory Vault export folder. It is fully checked before the local vault changes. Restore is available only when this installation has no archive data.</Text>
      <Action title={busy?'Working…':'Restore vault'} disabled={busy} onPress={chooseRestore}/>
      {selection?<View style={{gap:6}}><Text style={styles.section}>{selection.inspection.manifest.vault.name}</Text>
        <Text style={styles.text}>{selection.inspection.summary.trips} Trips</Text><Text style={styles.text}>{selection.inspection.summary.places} Places</Text>
        <Text style={styles.text}>{selection.inspection.summary.photos} Photos · {sizeLabel(selection.inspection.summary.totalMediaBytes)}</Text>
        <Text style={styles.text}>Created {selection.inspection.manifest.created_at}</Text>
        <Action title="Confirm restore" disabled={busy} onPress={confirmRestore}/></View>:null}
    </View>
    {notice?<Text accessibilityLiveRegion="polite" style={styles.text}>{notice}</Text>:null}
    {error?<Problem error={error}/>:null}
  </ScrollView></SafeAreaView>;
}
