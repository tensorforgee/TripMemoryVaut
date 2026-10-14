import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { coordinate, segmentKey, type RoadProposal, type SavedRoadRoute, type SegmentInput } from './model';
import { configuredLiveRoutingProvider } from './live-provider';
import { RouteProposalSession } from './proposals';

export function RoadRouteEditor({ tripId, segments, saved, labels, onPreview, onDirty }: {
  tripId: string; segments: SegmentInput[]; saved: SavedRoadRoute[]; labels: Record<string,string>;
  onPreview: (proposals: RoadProposal[]) => void; onDirty: (dirty: boolean) => void;
}) {
  const signature = JSON.stringify([tripId, segments]);
  const router = useRouter();
  const sessions = useMemo(() => segments.map(input => new RouteProposalSession(input,
    saved.find(r => segmentKey(r.input) === segmentKey(input))?.viaPoints)), [signature]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const [revision, render] = useReducer(v => v + 1, 0);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    onPreview(sessions.flatMap(session => session.proposal ? [session.proposal] : []));
    onDirty(sessions.some(session => session.proposal !== null || session.busy || JSON.stringify(session.viaPoints)
      !== JSON.stringify(saved.find(r => segmentKey(r.input) === segmentKey(session.input))?.viaPoints ?? [])));
  }, [sessions, revision, onPreview, onDirty]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; sessions.forEach(s => s.discard()); onPreview([]); onDirty(false); };
  }, [sessions, onPreview, onDirty]);

  const generate = (targets: RouteProposalSession[]) => {
    if (running) return;
    Alert.alert('Generate a road suggestion?',
        'This sends the selected Stop coordinates and ordered via-point coordinates to openrouteservice / HeiGIT. Photos, notes and trip titles stay on this device. Today’s road network may differ from your historical trip. The result is a temporary preview and is not saved or exported.',
      [{ text:'Cancel', style:'cancel' }, { text:'Generate', onPress:() => { void (async () => {
        const request = generation.current;
        setRunning(true); setNotice('');
        try { for (const session of targets) { if (!mounted.current || request !== generation.current) break; const pending = session.generate(configuredLiveRoutingProvider); render(); await pending; if (mounted.current) render(); } }
        finally { if (mounted.current) setRunning(false); }
      })(); } }]);
  };
  return <View style={styles.stack}>
    <Text style={styles.body}>Road previews follow the provider’s mapped roads. They are suggestions, not proof of the exact historical route, and are not saved or exported.</Text>
    <View style={styles.row}><Action title="Provider terms" onPress={() => { void Linking.openURL('https://account.heigit.org/info/tos'); }} />
      <Action title="Routing settings" onPress={() => router.push('/settings/routing')} />
      <Action title={running ? 'Generating…' : 'Generate all segments'} disabled={running || !sessions.length} onPress={() => generate(sessions)} /></View>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>}
    {!sessions.length && <Text style={styles.body}>Add two consecutive confirmed Stops with usable coordinates. Unknown Stops always remain gaps.</Text>}
    {sessions.map(session => {
      const prior = saved.find(r => segmentKey(r.input) === segmentKey(session.input));
      return <View key={segmentKey(session.input)} style={styles.segment}>
        <Text style={styles.title}>{labels[session.input.fromStopId]} → {labels[session.input.toStopId]}</Text>
        <Text style={styles.body}>{prior ? prior.stale ? 'Saved suggestion is stale — Stops changed. Preserved locally; hidden from the current road layer.'
          : 'Confirmed generated suggestion saved on device.' : 'No confirmed road geometry.'}</Text>
        <ViaEditor session={session} disabled={running} changed={() => { setNotice('Via points changed. Generate again to preview.'); render(); }} />
        {!!session.error && <Text style={styles.error} accessibilityLiveRegion="polite">{session.error}</Text>}
        {session.proposal && <Text style={styles.body}>PREVIEW — temporary · {session.proposal.geometry.coordinates.length} geometry points{session.proposal.distanceMeters === null ? '' : ` · provider distance ${(session.proposal.distanceMeters / 1000).toFixed(1)} km`}. Inspect the amber road line on the map.</Text>}
        <View style={styles.row}>
          <Action title={session.error ? 'Retry segment' : 'Generate segment'} disabled={running} onPress={() => generate([session])} />
          <Action title="Discard proposal / edits" disabled={running} onPress={() => { session.editVia(prior?.viaPoints ?? []); render(); }} />
        </View>
      </View>;
    })}
    {saved.filter(r => !segments.some(s => segmentKey(s) === segmentKey(r.input))).length > 0 && <Text style={styles.body}>Saved segments whose Stops are no longer adjacent are retained as stale archive data. They are not drawn as the current route.</Text>}
    <Text style={styles.body}>Via points only shape this suggestion. They do not add visited Places or Stops. ORS results and via edits are temporary previews; this milestone does not save or export new generated geometry.</Text>
  </View>;
}

function ViaEditor({ session, disabled, changed }: { session: RouteProposalSession; disabled: boolean; changed: () => void }) {
  const [latitude,setLatitude] = useState(''), [longitude,setLongitude] = useState(''), [error,setError] = useState('');
  const edit = (points: typeof session.viaPoints) => {
    try { session.editVia(points); setError(''); changed(); } catch(e) { setError(e instanceof Error ? e.message : 'Invalid via point.'); }
  };
  return <View style={styles.stack}>
    {session.viaPoints.map((point,index) => <View key={point.id} style={styles.stack}>
      <Text style={styles.body}>Via {index+1}: {point.coordinate[1]}, {point.coordinate[0]}</Text>
      <View style={styles.row}><Action title={`Move via ${index+1} up`} disabled={disabled || index===0} onPress={() => {
        const points=session.viaPoints.slice(); [points[index-1],points[index]]=[points[index],points[index-1]]; edit(points);
      }} /><Action title={`Move via ${index+1} down`} disabled={disabled || index===session.viaPoints.length-1} onPress={() => {
        const points=session.viaPoints.slice(); [points[index+1],points[index]]=[points[index],points[index+1]]; edit(points);
      }} /><Action title={`Remove via ${index+1}`} disabled={disabled} onPress={() => edit(session.viaPoints.filter(p => p.id!==point.id))} /></View>
    </View>)}
    <Text style={styles.body}>Optional via point · enter the road coordinates you remember</Text>
    <View style={styles.row}>
      <TextInput accessibilityLabel="Via latitude" placeholder="Latitude" value={latitude} onChangeText={setLatitude} editable={!disabled} keyboardType="numbers-and-punctuation" style={styles.input} />
      <TextInput accessibilityLabel="Via longitude" placeholder="Longitude" value={longitude} onChangeText={setLongitude} editable={!disabled} keyboardType="numbers-and-punctuation" style={styles.input} />
      <Action title="Add via point" disabled={disabled} onPress={() => {
        try {
          if (!latitude.trim() || !longitude.trim()) throw new Error('Enter both latitude and longitude.');
          const point = coordinate([Number(longitude),Number(latitude)]);
          session.editVia([...session.viaPoints,{id:randomUUID(),coordinate:point}]); setLatitude(''); setLongitude(''); setError(''); changed();
        } catch(e) { setError(e instanceof Error ? e.message : 'Invalid via coordinates.'); }
      }} />
    </View>
    {!!error && <Text style={styles.error}>{error}</Text>}
  </View>;
}

function Action({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && {opacity:0.45}]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
const styles = StyleSheet.create({
  stack:{gap:8}, row:{flexDirection:'row',flexWrap:'wrap',gap:6}, segment:{gap:10,borderTopWidth:1,borderColor:'#ccd8d4',paddingVertical:12},
  title:{fontWeight:'700',fontSize:15,color:'#213b3d'}, body:{fontSize:12,lineHeight:18,color:'#465f5c'}, error:{fontSize:12,color:'#913d29'},
  button:{minHeight:44,padding:10,borderRadius:8,backgroundColor:'#e8efeb',justifyContent:'center'},buttonText:{fontSize:12,fontWeight:'700',color:'#146775'},
  input:{minWidth:100,flexGrow:1,borderWidth:1,borderColor:'#9baea9',borderRadius:8,padding:8,minHeight:44,color:'#213b3d'},
});
