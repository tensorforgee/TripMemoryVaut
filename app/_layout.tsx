import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../src/core/database/open';
import { MigrationError } from '../src/core/database/migrate';
import { mediaService } from '../src/features/media/service';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    // The shared connection lives for the app process. Screens open only after
    // migrations and vault initialization succeed; failure never resets data.
    openVaultDatabase().then(
      () => { if (active) setReady(true); void mediaService().then(s=>s.run()).catch(()=>{ /* persisted jobs expose recoverable failures in Photos */ }); },
      (failure: unknown) => { if (active) setError(failure instanceof Error ? failure : new Error(String(failure))); },
    );
    return () => { active = false; };
  }, []);
  if (!ready) {
    return <View style={{ padding: 32 }}><Text accessibilityLiveRegion="polite">
      {error ? `Database initialization failed.\n${error.message}${error instanceof MigrationError && error.backupPath ? `\nRecovery snapshot: ${error.backupPath}` : ''}` : 'Opening local vault…'}
    </Text></View>;
  }
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Trips', header: tripHeader }} />
      <Stack.Screen name="trips/new" options={{ title: 'Create trip', header: tripHeader }} />
      <Stack.Screen name="trips/trash" options={{ title: 'Trash', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/index" options={{ title: 'Trip', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/edit" options={{ title: 'Edit trip', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/route" options={{ title: 'Route / Stops', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/map" options={{ title: 'Trip Map', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/timeline" options={{ title: 'Timeline', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/photos" options={{ title: 'Photos', header: tripHeader }} />
      <Stack.Screen name="trips/[tripId]/reconstruct" options={{ title: 'Reconstruction', header: tripHeader }} />
      <Stack.Screen name="reconstruction-test" options={{ title: 'Reconstruction verification', header: tripHeader }} />
      <Stack.Screen name="media-test" options={{ title: 'Media verification', header: tripHeader }} />
      <Stack.Screen name="map-test" options={{ title: 'MapLibre compatibility' }} />
      <Stack.Screen name="trip-map-test" options={{ title: 'Trip Map verification', header: tripHeader }} />
    </Stack>
  );
}

// React-rendered header avoids Screens 4.26.2's Android/Fabric native-header
// update crash when an editor with removal protection leaves the stack.
function tripHeader({ options, back, navigation }: {
  options: { title?: string }; back?: unknown; navigation: { goBack(): void };
}) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: '#fff' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, gap: 16 }}>
      {back ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}
        style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ fontSize: 18, color: '#183e63' }}>‹ Back</Text></Pressable> : null}
      <Text style={{ fontSize: 20, fontWeight: '600', color: '#17283b' }}>{options.title}</Text>
    </View>
  </SafeAreaView>;
}
