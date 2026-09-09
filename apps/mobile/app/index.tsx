import { Redirect } from "expo-router";
import { ActivityIndicator, Image, View } from "react-native";
import { ROLE_LABEL, api } from "@wyre/api";
import { FIELD_ROLES, useApp } from "@/store";
import { Badge, Card, H1, P, Row, Screen } from "@/ui";
import { T } from "@/theme";
export default function SignIn() {
  const { ready, user, signIn } = useApp();
  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.color.nav }}><ActivityIndicator color="#fff" /></View>;
  if (user) return <Redirect href="/(tabs)" />;
  const users = api.getUsers().filter((u) => u.roles.some((r) => (FIELD_ROLES as readonly string[]).includes(r)));
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
        <Image source={require("../assets/icon.png")} style={{ width: 64, height: 64, borderRadius: 16 }} />
        <H1>Wyre Field</H1><P tone="muted">Visits · issues · evidence. In-house only.</P>
      </View>
      <P small tone="faint" style={{ textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "700" }}>Sign in as (demo)</P>
      {users.map((u) => <Card key={u.id} onPress={() => signIn(u.id)}><Row style={{ justifyContent: "space-between" }}><P bold>{u.name}</P><Row>{u.roles.map((r) => <Badge key={r} tone="primary">{ROLE_LABEL[r]}</Badge>)}</Row></Row><P small tone="muted">{api.listProjects(u.id).length} projects</P></Card>)}
    </Screen>
  );
}
