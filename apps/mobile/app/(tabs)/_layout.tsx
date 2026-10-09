import { Tabs } from 'expo-router';
import { colors } from '../../src/ui/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 15, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarButtonTestID: 'tab-plan' }} />
      <Tabs.Screen
        name="progress"
        options={{ title: 'Progress', tabBarButtonTestID: 'tab-progress' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarButtonTestID: 'tab-settings' }}
      />
    </Tabs>
  );
}
