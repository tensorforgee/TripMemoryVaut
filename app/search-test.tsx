import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Action, styles } from '../src/features/trips/ui';
import { auditNativeSearchAfterRelaunch, runNativeSearchVerification } from '../tests/step13/native-verification';

export default function SearchTest() {
  const [status, setStatus] = useState('Development-only Step 13 local search verification.');
  const [busy, setBusy] = useState(false);
  if (!__DEV__) return null;
  const run = async (task: () => Promise<string>) => { setBusy(true); try { setStatus(await task()); }
    catch (error) { setStatus(`FAIL: ${String(error)}`); } finally { setBusy(false); } };
  return <ScrollView contentContainerStyle={styles.content}><Text selectable>{status}</Text>
    <Action title="Run native search lifecycle" disabled={busy} onPress={() => void run(runNativeSearchVerification)} />
    <Action title="Audit after offline relaunch" disabled={busy} onPress={() => void run(auditNativeSearchAfterRelaunch)} />
  </ScrollView>;
}
