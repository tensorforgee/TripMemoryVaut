import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../../core/database/open';
import { mediaService } from '../media/service';
import { Action, Problem, message, styles } from '../trips/ui';
import { privacyCapabilities, settingsVersions } from './capabilities';
import { VaultMaintenance, type IntegrityReport, type MaintenanceResult, type StorageSummary } from './maintenance';
import { nativeMaintenanceFiles } from './native-files';
import { resetLocalVault } from './native-reset';
import { canConfirmVaultReset, DELETE_CONFIRMATION_PHRASE } from './reset-coordinator';

function bytes(value:number):string{
  if(value<1024)return `${value} B`;if(value<1024**2)return `${(value/1024).toFixed(1)} KB`;
  if(value<1024**3)return `${(value/1024**2).toFixed(1)} MB`;return `${(value/1024**3).toFixed(2)} GB`;
}
async function maintenance():Promise<VaultMaintenance>{
  const vault=await openVaultDatabase();
  return new VaultMaintenance(vault.database,vault.vault.id,nativeMaintenanceFiles(vault.vault.id),
    value=>digestStringAsync(CryptoDigestAlgorithm.SHA256,value),async()=>mediaService().then(service=>service.regenerateDerivatives()));
}
function Row({label,value,note}:{label:string;value:string;note?:string}){
  return <View style={local.row}><View style={{flex:1}}><Text style={local.label}>{label}</Text>{note?<Text style={local.note}>{note}</Text>:null}</View><Text style={local.value}>{value}</Text></View>;
}
function Section({title,children,danger=false}:{title:string;children:React.ReactNode;danger?:boolean}){
  return <View style={[styles.card,danger&&local.danger]}><Text style={[styles.section,danger&&local.dangerTitle]}>{title}</Text>{children}</View>;
}

export default function SettingsScreen(){
  const[summary,setSummary]=useState<StorageSummary>();const[report,setReport]=useState<IntegrityReport>();
  const[notice,setNotice]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState('');
  const[deleteMode,setDeleteMode]=useState(false);const[phrase,setPhrase]=useState('');
  const load=useCallback(()=>{let active=true;maintenance().then(value=>value.storageSummary()).then(value=>{if(active)setSummary(value);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
  useFocusEffect(load);
  const run=async(label:string,task:(service:VaultMaintenance)=>Promise<MaintenanceResult>)=>{
    setBusy(label);setError('');setNotice('');try{const result=await task(await maintenance());setNotice(result.detail);setSummary(await(await maintenance()).storageSummary());}
    catch(e){setError(message(e));}finally{setBusy('');}
  };
  const audit=async()=>{setBusy('integrity');setError('');setNotice('');try{const value=await(await maintenance()).checkIntegrity();setReport(value);setNotice(value.status==='healthy'?'Vault integrity check completed.':'Vault integrity check found issues.');}catch(e){setError(message(e));}finally{setBusy('');}};
  const confirmReset=()=>Alert.alert('Delete all local vault data?',
    'Trips, photos, memories, Dreams, previews, imports, and local search data will be removed from this device. Exports saved elsewhere are not removed.',[
      {text:'Cancel',style:'cancel'},{text:'Delete permanently',style:'destructive',onPress:()=>{void(async()=>{setBusy('reset');setError('');try{const vault=await openVaultDatabase();await resetLocalVault(vault);setDeleteMode(false);setPhrase('');setReport(undefined);setNotice('Local vault data deleted. A clean empty vault is ready.');router.replace('/');}catch(e){setError(`Reset did not complete. It will resume before the vault opens again. ${message(e)}`);}finally{setBusy('');}})();}},
    ]);
  const appVersion=Constants.expoConfig?.version??settingsVersions.appVersion;
  const build=Constants.nativeBuildVersion??Constants.expoConfig?.android?.versionCode?.toString();
  return <SafeAreaView style={styles.page} edges={['bottom','left','right']}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Settings</Text><Text style={styles.text}>Understand and safely maintain this local Trip Memory Vault.</Text>

    <Section title="Archive">
      <Text style={styles.text}>Export creates a portable backup with canonical data and app-owned original photos.</Text>
      <Action title="Export vault" disabled={!!busy} onPress={()=>router.push('/archive')}/>
      <Text style={styles.text}>Restore requires a compatible Trip Memory Vault archive and an empty local vault.</Text>
      <Action title="Restore vault" disabled={!!busy} onPress={()=>router.push('/archive')}/>
    </Section>

    <Section title="Storage">
      {summary?<><Row label="Trips" value={String(summary.trips)} note="Includes drafts and items in Trash"/><Row label="Unique archived Photos" value={String(summary.photos)}/>
        <Row label="App-owned originals" value={bytes(summary.originalBytes)}/><Row label="Previews / derivatives" value={bytes(summary.derivativeBytes)}/>
        <Row label="Database" value={`~${bytes(summary.databaseBytes)}`} note="Logical SQLite size estimate; temporary WAL space can vary"/>
        <Row label="Staging / import temporary" value={bytes(summary.stagingBytes)}/>
        <Text style={local.note}>Only app-owned vault storage is counted. Files still in the external photo library are excluded.</Text></>:<Text style={styles.text}>Measuring app-owned storage…</Text>}
    </Section>

    <Section title="Maintenance">
      <Text style={styles.text}>Originals are authoritative and preserved. Preview files are regenerable; staging files are temporary.</Text>
      <Action title={busy==='derivatives'?'Regenerating…':'Regenerate missing previews'} disabled={!!busy} onPress={()=>void run('derivatives',service=>service.regenerateDerivatives())}/>
      <Action title={busy==='orphans'?'Cleaning…':'Remove orphaned previews'} disabled={!!busy} onPress={()=>void run('orphans',service=>service.removeOrphanedDerivatives())}/>
      <Action title={busy==='staging'?'Cleaning…':'Clean stale staging files'} disabled={!!busy} onPress={()=>void run('staging',service=>service.cleanStaleStaging())}/>
      <Action title={busy==='availability'?'Reconciling…':'Reconcile local media availability'} disabled={!!busy} onPress={()=>void run('availability',service=>service.reconcileMediaAvailability())}/>
      <Action title={busy==='search'?'Rebuilding…':'Rebuild search index'} disabled={!!busy} onPress={()=>void run('search',service=>service.rebuildSearch())}/>
    </Section>

    <Section title="Vault integrity">
      <Text style={styles.text}>Runs a non-destructive audit of the database, originals, search, and interrupted imports.</Text>
      <Action title={busy==='integrity'?'Checking…':'Check vault integrity'} disabled={!!busy} onPress={()=>void audit()}/>
      {report?<View accessibilityLiveRegion="polite" style={{gap:8}}><Text style={local.resultTitle}>{report.status==='healthy'?'Vault integrity looks healthy':'Vault integrity needs attention'}</Text>
        {report.lines.map(line=><View key={line.key}><Text style={[local.label,line.status==='issue'&&local.issue]}>{line.status==='pass'?'✓':'!'} {line.label}</Text><Text style={local.note}>{line.detail}</Text></View>)}</View>:null}
    </Section>

    <Section title="Privacy">
      {Object.values(privacyCapabilities).map(value=><Text key={value} style={styles.text}>• {value}</Text>)}
      <Text style={local.label}>Permission status</Text><Text style={local.note}>Photo picker: selected items only · Background location: not requested · Contacts: not requested</Text>
    </Section>

    <Section title="About">
      <Row label="App" value={settingsVersions.appName}/><Row label="Version" value={appVersion}/><Row label="Build" value={build??'Unavailable'}/>
      <Row label="Database schema" value={String(settingsVersions.schemaVersion)}/><Row label="Portable export format" value={String(settingsVersions.exportFormatVersion)}/>
    </Section>

    <Section title="Danger zone" danger>
      <Text style={styles.text}>Delete all local vault data removes Trips, app-owned photos, memories, Dreams, previews, staging, and derived indexes from this device. Export first if you need a backup.</Text>
      {!deleteMode?<Action title="Delete all local vault data" disabled={!!busy} onPress={()=>setDeleteMode(true)}/>:<View style={{gap:10}}>
        <Text style={local.label}>Type {DELETE_CONFIRMATION_PHRASE} to continue.</Text><TextInput accessibilityLabel="Type DELETE to confirm vault deletion" value={phrase} onChangeText={setPhrase} autoCapitalize="characters" autoCorrect={false} style={styles.input}/>
        <Pressable accessibilityRole="button" accessibilityState={{disabled:!canConfirmVaultReset(phrase)||!!busy}} disabled={!canConfirmVaultReset(phrase)||!!busy} onPress={confirmReset}
          style={[styles.button,local.deleteButton,(!canConfirmVaultReset(phrase)||!!busy)&&{opacity:.45}]}><Text style={styles.buttonText}>Delete permanently</Text></Pressable>
        <Action title="Cancel" disabled={!!busy} onPress={()=>{setDeleteMode(false);setPhrase('');}}/>
      </View>}
    </Section>
    {notice?<Text accessibilityLiveRegion="polite" style={styles.text}>{notice}</Text>:null}{error?<Problem error={error}/>:null}
  </ScrollView></SafeAreaView>;
}

const local=StyleSheet.create({
  row:{flexDirection:'row',gap:16,justifyContent:'space-between',alignItems:'flex-start',paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#d7dee6'},
  label:{fontSize:15,fontWeight:'600',color:'#26394d',lineHeight:21},value:{fontSize:15,color:'#17283b',textAlign:'right',maxWidth:'52%'},
  note:{fontSize:13,color:'#667789',lineHeight:19},resultTitle:{fontSize:17,fontWeight:'700',color:'#17283b',paddingTop:8},issue:{color:'#9d2828'},
  danger:{borderWidth:1,borderColor:'#d9a6a6'},dangerTitle:{color:'#9d2828'},deleteButton:{backgroundColor:'#9d2828'},
});
