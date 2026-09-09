import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProvider } from "@/store";
import { T } from "@/theme";
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: T.color.nav }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "700" }, contentStyle: { backgroundColor: T.color.canvas } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="issue/new" options={{ title: "New issue", presentation: "modal" }} />
          <Stack.Screen name="issue/[id]" options={{ title: "Issue" }} />
          <Stack.Screen name="visit/new" options={{ title: "Log a visit", presentation: "modal" }} />
          <Stack.Screen name="visit/[id]" options={{ title: "Visit" }} />
        </Stack>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
