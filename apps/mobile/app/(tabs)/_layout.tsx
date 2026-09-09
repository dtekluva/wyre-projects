import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useApp } from "@/store";
import { T } from "@/theme";
export default function TabsLayout() {
  const { user, ready } = useApp();
  if (ready && !user) return <Redirect href="/" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color }: { color: ColorValue }) => <Ionicons name={name} size={22} color={color as string} />;
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: T.color.nav }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "700" }, tabBarActiveTintColor: T.color.primary, tabBarInactiveTintColor: T.color.text3, tabBarStyle: { backgroundColor: T.color.surface, borderTopColor: T.color.border, height: 64, paddingTop: 6 }, tabBarLabelStyle: { fontSize: 11, fontWeight: "600" } }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="issues" options={{ title: "Issues", tabBarIcon: icon("alert-circle-outline") }} />
      <Tabs.Screen name="visits" options={{ title: "Visits", tabBarIcon: icon("clipboard-outline") }} />
      <Tabs.Screen name="stock" options={{ title: "Van stock", tabBarIcon: icon("cube-outline") }} />
    </Tabs>
  );
}
