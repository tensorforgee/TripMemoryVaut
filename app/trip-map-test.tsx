import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { prepareMapFixtures, auditMapFixtures } from '../tests/step7/native-verification';
import { Action, styles } from '../src/features/trips/ui';

export default function TripMapTest() {
  const [ids, setIds] = useState<Awaited<ReturnType<typeof prepareMapFixtures>>>();
  const [status, setStatus] = useState('Synthetic Step 7 fixtures only. No real travel history.');
  const [busy, setBusy] = useState(false);
  if (!__DEV__) return null;
  return <ScrollView contentContainerStyle={styles.content}>
    <Text>{status}</Text>
    <Action title="Prepare / load Step 7 fixtures" disabled={busy} onPress={async () => {
      setBusy(true); try { setIds(await prepareMapFixtures()); setStatus('Fixtures ready'); } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
    }} />
    {ids && Object.entries(ids).map(([name, id]) => <Action key={id} title={`Open ${name} trip`} onPress={() => router.push(`/trips/${id}`)} />)}
    <Action title="Audit persisted map data" disabled={busy} onPress={async () => {
      setBusy(true); try { setStatus(await auditMapFixtures()); } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
    }} />
  </ScrollView>;
}
