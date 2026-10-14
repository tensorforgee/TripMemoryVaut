import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, message, styles } from '../trips/ui';
import { orsCredentialStore } from './native-store';

const ACCOUNT_URL = 'https://account.heigit.org/';

export default function RoutingCredentialScreen() {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [configured, setConfigured] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    let active = true;
    orsCredentialStore.isConfigured().then(value => {
      if (active) { setConfigured(value); setError(''); }
    }).catch(failure => {
      if (active) { setConfigured(undefined); setError(message(failure)); }
    });
    return () => { active = false; };
  }, []);
  useFocusEffect(load);

  const save = async () => {
    setBusy(true); setNotice(''); setError('');
    try {
      await orsCredentialStore.save(key);
      setKey(''); setVisible(false); setConfigured(true);
      setNotice('OpenRouteService API key saved securely on this device.');
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => Alert.alert('Clear routing API key?',
    'The saved key will be removed from secure device storage. Existing saved road geometry is unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear key', style: 'destructive', onPress: () => { void (async () => {
        setBusy(true); setNotice(''); setError('');
        try {
          await orsCredentialStore.clear();
          setKey(''); setVisible(false); setConfigured(false);
          setNotice('OpenRouteService API key cleared.');
        } catch (failure) {
          setError(message(failure));
        } finally {
          setBusy(false);
        }
      })(); } },
    ]);

  return <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Routing</Text>
      <Text style={styles.text}>Trip Memory Vault does not include a shared routing credential. Obtain your own OpenRouteService API key from HeiGIT, then save it only on this device.</Text>

      <View style={styles.card}>
        <Text style={styles.section}>OpenRouteService</Text>
        <View style={local.statusRow}>
          <View style={[local.dot, configured === true ? local.connected : local.notConfigured]} />
          <Text accessibilityLiveRegion="polite" style={local.status}>{configured === undefined ? 'Checking secure storage…' : configured ? 'Connected' : 'Not configured'}</Text>
        </View>
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(ACCOUNT_URL); }} style={local.linkButton}>
          <Text style={local.link}>Get an API key at account.heigit.org</Text>
        </Pressable>

        <Text style={local.label}>API key</Text>
        <View style={local.inputRow}>
          <TextInput
            accessibilityLabel="OpenRouteService API key"
            autoCapitalize="none"
            autoCorrect={false}
            importantForAutofill="noExcludeDescendants"
            placeholder={configured ? 'Enter a replacement key' : 'Paste your API key'}
            secureTextEntry={!visible}
            textContentType="password"
            value={key}
            onChangeText={setKey}
            style={[styles.input, local.input]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide API key' : 'Show API key'} onPress={() => setVisible(value => !value)} style={local.showButton}>
            <Text style={local.showText}>{visible ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        <Text style={local.note}>The key is encrypted by Android Keystore-backed secure storage. It is not added to SQLite, archives, exports, logs, source code, or the APK.</Text>
        <Action title={busy ? 'Saving…' : 'Save key'} disabled={busy} onPress={() => { void save(); }} />
        <Action title={busy ? 'Working…' : 'Clear key'} disabled={busy || configured !== true} onPress={clear} />
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Privacy and current limitation</Text>
        <Text style={styles.text}>Saving a key does not send any trip data. A request happens only after you choose Generate Road Route and approve its coordinate-sharing disclosure.</Text>
        <Text style={styles.text}>Each approved request sends only the selected Stop and ordered via-point coordinates to OpenRouteService / HeiGIT. Photos, notes, trip titles, and other archive data stay local. New results are temporary previews and are not saved or exported in this milestone.</Text>
      </View>

      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.text}>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </ScrollView>
  </SafeAreaView>;
}

const local = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  dot: { width: 11, height: 11, borderRadius: 6 }, connected: { backgroundColor: '#23845b' }, notConfigured: { backgroundColor: '#7f8b96' },
  status: { fontSize: 16, fontWeight: '700', color: '#17283b' },
  label: { fontSize: 15, fontWeight: '600', color: '#26394d', marginTop: 6 }, note: { fontSize: 13, color: '#667789', lineHeight: 19 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1 },
  showButton: { minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#183e63', borderRadius: 8 },
  showText: { color: '#183e63', fontSize: 15, fontWeight: '700' },
  linkButton: { minHeight: 44, justifyContent: 'center' }, link: { color: '#195a8a', fontSize: 16, textDecorationLine: 'underline' },
});
