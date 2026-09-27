import { useState } from 'react';
import { Button, ScrollView, Text } from 'react-native';
import { verifyNativeFoundation } from '../tests/step1/native-verification';

export default function DatabaseVerificationScreen() {
  const [status, setStatus] = useState('Development-only database verification. Uses a separate synthetic fixture database.');
  const [running, setRunning] = useState(false);
  if (!__DEV__) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
      <Button title="Verify Step 1 database" disabled={running} onPress={async () => {
        setRunning(true);
        setStatus('Running native SQLite verification…');
        try {
          const results = await verifyNativeFoundation();
          setStatus(`PASS: ${results.length} native checks\n${results.join('\n')}`);
        } catch (error) {
          setStatus(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
        } finally { setRunning(false); }
      }} />
      <Text accessibilityLiveRegion="polite" selectable>{status}</Text>
    </ScrollView>
  );
}
