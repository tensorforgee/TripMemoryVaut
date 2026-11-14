import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationHeader } from '../src/shared/ui/NavigationHeader';
import { LoadingState, styles } from '../src/features/trips/ui';
import { theme } from '../src/shared/ui/theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openVaultDatabase } from '../src/core/database/open';
import { MigrationError } from '../src/core/database/migrate';
import { mediaService } from '../src/features/media/service';
import { completePendingVaultReset, recoverPendingVaultReset } from '../src/features/settings/native-reset';

// Seed a home destination behind cold deep links so Android Back stays in the vault.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    // The shared connection lives for the app process. Screens open only after
    // migrations and vault initialization succeed; failure never resets data.
    recoverPendingVaultReset().then(() => openVaultDatabase()).then(
      () => { completePendingVaultReset(); if (active) setReady(true); void mediaService().then(s=>s.run()).catch(()=>{ /* persisted jobs expose recoverable failures in Photos */ }); },
      (failure: unknown) => { if (active) setError(failure instanceof Error ? failure : new Error(String(failure))); },
    );
    return () => { active = false; };
  }, []);
  if (!ready) {
    return <SafeAreaView style={styles.page}><View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>Trip Memory Vault</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>
        {`Database initialization failed.\n${error.message}${error instanceof MigrationError && error.backupPath ? `\nRecovery snapshot: ${error.backupPath}` : ''}`}
      </Text> : <LoadingState label="Opening local vault…" />}
    </View></SafeAreaView>;
  }
  return (
    <><StatusBar style="dark" /><Stack screenOptions={{ header: NavigationHeader, contentStyle: { backgroundColor: theme.colors.background } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="trips/new" options={{ title: 'Create trip' }} />
      <Stack.Screen name="trips/trash" options={{ title: 'Trash' }} />
      <Stack.Screen name="trips/[tripId]/index" options={{ title: 'Trip' }} />
      <Stack.Screen name="trips/[tripId]/edit" options={{ title: 'Edit trip' }} />
      <Stack.Screen name="trips/[tripId]/route" options={{ title: 'Route / Stops' }} />
      <Stack.Screen name="trips/[tripId]/map" options={{ title: 'Trip Map', headerShown: false }} />
      <Stack.Screen name="trips/[tripId]/memories" options={{ title: 'Memories' }} />
      <Stack.Screen name="trips/[tripId]/timeline" options={{ title: 'Timeline' }} />
      <Stack.Screen name="trips/[tripId]/photos" options={{ title: 'Photos' }} />
      <Stack.Screen name="trips/[tripId]/reconstruct" options={{ title: 'Reconstruction' }} />
      <Stack.Screen name="companions/index" options={{ title: 'Companions' }} />
      <Stack.Screen name="companions/[companionId]" options={{ title: 'Companion' }} />
      <Stack.Screen name="chapters/index" options={{ title: 'Life Chapters' }} />
      <Stack.Screen name="chapters/[chapterId]" options={{ title: 'Life Chapter' }} />
      <Stack.Screen name="life/places" options={{ title: 'Places visited' }} />
      <Stack.Screen name="dreams/[dreamId]" options={{ title: 'Dream' }} />
      <Stack.Screen name="archive" options={{ title: 'Archive & restore' }} />
      <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
      <Stack.Screen name="settings/routing" options={{ title: 'Routing' }} />
      <Stack.Screen name="search" options={{ title: 'Search' }} />
      <Stack.Protected guard={__DEV__}>
      <Stack.Screen name="database-test" options={{ title: 'Database verification' }} />
      <Stack.Screen name="reconstruction-test" options={{ title: 'Reconstruction verification' }} />
      <Stack.Screen name="media-test" options={{ title: 'Media verification' }} />
      <Stack.Screen name="map-test" options={{ title: 'MapLibre compatibility' }} />
      <Stack.Screen name="trip-map-test" options={{ title: 'Trip Map verification' }} />
      <Stack.Screen name="my-map-test" options={{ title: 'My Map verification' }} />
      <Stack.Screen name="archive-test" options={{ title: 'Archive verification' }} />
      <Stack.Screen name="search-test" options={{ title: 'Search verification' }} />
      </Stack.Protected>
    </Stack></>
  );
}
