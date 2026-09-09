import { useRouter } from "expo-router";
import { useApi, useUser } from "@/store";
import { Button, Empty, P, Row, Screen } from "@/ui";
import { VisitRow } from "@/rows";
export default function Visits() {
  const api = useApi(); const user = useUser(); const router = useRouter();
  const mine = api.listProjects(user.id).map((p) => p.id);
  const list = api.listVisits().filter((v) => mine.includes(v.projectId));
  return <Screen>
    <Row style={{ justifyContent: "space-between" }}><P tone="muted">{list.length} visits on your projects</P><Button label="＋ Log visit" onPress={() => router.push("/visit/new")} /></Row>
    {list.length ? list.map((v) => <VisitRow key={v.id} visit={v} />) : <Empty title="No visits yet" />}
  </Screen>;
}
