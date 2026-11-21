import { useState } from 'react';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { nativeMediaFiles } from '../../core/media/native-adapter';
import { theme } from '../../shared/ui/theme';
import { styles } from './ui';

// A presentation preview, never a new persisted cover or a copy of the original.
export default function TripCover({ vaultId, path, photos, compact = false }: {
  vaultId: string; path: string | null; photos: number; compact?: boolean;
}) {
  const [failed, setFailed] = useState<string>();
  const uri = path ? nativeMediaFiles(vaultId).uri(path) : undefined;
  return uri && failed !== uri
    ? <Image source={{ uri }} recyclingKey={uri} accessibilityLabel="Trip photo preview" accessible
      contentFit="cover" style={{ width: '100%', height: compact ? 144 : 208, borderRadius: theme.radius.card }} onError={() => setFailed(uri)} />
    : <View style={{ padding: theme.space.medium, borderRadius: theme.radius.control, backgroundColor: theme.colors.selected }}>
      <Text style={styles.text}>{photos ? 'Photo preview unavailable' : 'No photos added yet'}</Text>
    </View>;
}
