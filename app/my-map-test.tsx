import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { auditGlobalMapFixtures, prepareGlobalMapFixtures, restoreRuntimeArchive,
  stageOneMappedPlace, stageZeroMappedPlaces } from '../tests/step11/native-verification';
import { Action, styles } from '../src/features/trips/ui';

export default function MyMapTest() {
  const [status, setStatus] = useState('Synthetic Step 11 fixtures only. Restore staged archive state before finishing.');
  const [busy, setBusy] = useState(false);
  if (!__DEV__) return null;
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); try { setStatus(String(await task())); } catch (error) { setStatus(String(error)); } finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.content}>
    <Text>{status}</Text>
    <Action title="Prepare Step 11 fixtures" disabled={busy} onPress={() => void run(prepareGlobalMapFixtures)} />
    <Action title="Audit fixture aggregation" disabled={busy} onPress={() => void run(auditGlobalMapFixtures)} />
    <Action title="Open My Map" disabled={busy} onPress={() => router.push('/map')} />
    <Action title="Stage zero mapped Places" disabled={busy} onPress={() => void run(stageZeroMappedPlaces)} />
    <Action title="Stage one mapped Place" disabled={busy} onPress={() => void run(stageOneMappedPlace)} />
    <Action title="Restore staged archive" disabled={busy} onPress={() => void run(restoreRuntimeArchive)} />
  </ScrollView>;
}
