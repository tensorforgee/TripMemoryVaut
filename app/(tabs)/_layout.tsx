import { Tabs, router } from 'expo-router';
import { Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationHeader } from '../../src/shared/ui/NavigationHeader';
import { theme } from '../../src/shared/ui/theme';

export const unstable_settings = { initialRouteName: 'index' };

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return <Tabs initialRouteName="index" backBehavior="history" screenOptions={{
    header: props => <NavigationHeader {...props} />,
    tabBarActiveTintColor: theme.colors.primary,
    tabBarInactiveTintColor: theme.colors.muted,
    tabBarActiveBackgroundColor: theme.colors.selected,
    tabBarLabelPosition: 'below-icon',
    tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
    tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border,
      height: Math.max(64, 32 + 22 * fontScale) + insets.bottom },
    tabBarItemStyle: { paddingVertical: 6 },
    tabBarHideOnKeyboard: true,
    animation: 'none',
  }}>
    <Tabs.Screen name="index" options={{ title: 'Trips', tabBarAccessibilityLabel: 'Trips tab',
      tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 24 }}>▤</Text>,
      header: props => <NavigationHeader {...props} action={{ label: 'Search', onPress: () => router.push('/search') }} />,
    }} />
    <Tabs.Screen name="map" options={{ title: 'Map', tabBarAccessibilityLabel: 'Map tab',
      tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 24 }}>◎</Text>,
    }} />
    <Tabs.Screen name="dreams" options={{ title: 'Dreams', tabBarAccessibilityLabel: 'Dreams tab',
      tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 24 }}>☆</Text>,
    }} />
    <Tabs.Screen name="life" options={{ title: 'My Life', tabBarAccessibilityLabel: 'My Life tab',
      tabBarIcon: ({ color }) => <Text accessible={false} style={{ color, fontSize: 24 }}>◷</Text>,
      header: props => <NavigationHeader {...props} action={{ label: 'Settings', onPress: () => router.push('/settings') }} />,
    }} />
  </Tabs>;
}
