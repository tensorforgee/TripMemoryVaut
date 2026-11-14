import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from './theme';

// Keep the React-rendered header: Screens 4.26.2's Android/Fabric native
// header can crash when leaving an editor with removal protection.
export function NavigationHeader({ options, back, navigation, action }: {
  options: { title?: string }; back?: unknown; navigation: { goBack(): void };
  action?: { label: string; onPress(): void };
}) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={s.safe}>
    <View style={s.row}>
      {back ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}
        style={({ pressed }) => [s.control, pressed && s.pressed]}><Text style={s.link}>‹ Back</Text></Pressable> : null}
      <Text accessibilityRole="header" style={s.title}>{options.title}</Text>
      {action ? <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress}
        style={({ pressed }) => [s.control, pressed && s.pressed]}><Text style={s.link}>{action.label}</Text></Pressable> : null}
    </View>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { backgroundColor: theme.colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.large, minHeight: 56, gap: theme.space.medium },
  control: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 4 },
  link: { fontSize: 16, fontWeight: '600', color: theme.colors.primary },
  title: { flex: 1, fontSize: 20, fontWeight: '600', color: theme.colors.ink, paddingVertical: 12 },
  pressed: { opacity: 0.65 },
});
