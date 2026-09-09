import { type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProvider, useApp } from "@/store";
import { T } from "@/theme";

/** Nothing renders until the local store is hydrated (cold-start / deep-link safe). */
function Hydrated({ children }: { children: ReactNode }) {
  const { ready } = useApp();
  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.color.nav }}><ActivityIndicator color="#fff" /></View>;
  return <>{children}</>;
}
/** Every route except sign-in is behind a user guard — the router itself refuses to mount them without one. */
function Routes() {
  const { user } = useApp();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: T.color.nav }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "700" }, contentStyle: { backgroundColor: T.color.canvas } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="issue/new" options={{ title: "New issue", presentation: "modal" }} />
        <Stack.Screen name="issue/[id]" options={{ title: "Issue" }} />
        <Stack.Screen name="visit/new" options={{ title: "Log a visit", presentation: "modal" }} />
        <Stack.Screen name="visit/[id]" options={{ title: "Visit" }} />
      </Stack.Protected>
    </Stack>
  );
}
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <StatusBar style="light" />
        <Hydrated><Routes /></Hydrated>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
