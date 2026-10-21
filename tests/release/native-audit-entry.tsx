import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text } from 'react-native';
import { runFinalNativeAudit, reopenFinalNativeAudit } from './native-audit';

function App() {
  const [status, setStatus] = useState('Disposable release QA running');
  useEffect(() => {
    void (async () => {
      const mode = (await Linking.getInitialURL())?.includes('mode=reopen') ? 'reopen' : 'suite';
      await (mode === 'reopen' ? reopenFinalNativeAudit() : runFinalNativeAudit());
      console.log(`FINAL_QA PASS ${mode}`);
      setStatus(`PASS ${mode}: migrations, trip/stay/photo/pin workflows, archive integrity and SQLite close.`);
    })().catch(error => {
      console.error(`FINAL_QA FAIL ${String(error)}`);
      setStatus(`FAIL ${String(error)}`);
    });
  }, []);
  return <ScrollView contentContainerStyle={{ padding: 36 }}><Text>{status}</Text></ScrollView>;
}
registerRootComponent(App);
