import { useState } from "react";
import { useRouter } from "expo-router";
import { useApi, useUser } from "@/store";
import { Button, Chips, Empty, Row, Screen } from "@/ui";
import { IssueRow } from "@/rows";
export default function Issues() {
  const api = useApi(); const user = useUser(); const router = useRouter();
  const mine = api.listProjects(user.id).map((p) => p.id);
  const [filter, setFilter] = useState<"open" | "mine" | "closed">("open");
  const all = api.listIssues().filter((i) => mine.includes(i.projectId));
  const list = filter === "open" ? all.filter((i) => !["closed", "wont_fix"].includes(i.status)) : filter === "mine" ? all.filter((i) => i.assigneeId === user.id || i.raisedBy === user.id) : all.filter((i) => ["closed", "wont_fix"].includes(i.status));
  return <Screen>
    <Row style={{ justifyContent: "space-between" }}><Chips options={[{ value: "open", label: `Open (${all.filter((i) => !["closed", "wont_fix"].includes(i.status)).length})` }, { value: "mine", label: "Mine" }, { value: "closed", label: "Closed" }]} value={filter} onChange={setFilter} /><Button label="＋" onPress={() => router.push("/issue/new")} /></Row>
    {list.length ? list.map((i) => <IssueRow key={i.id} issue={i} />) : <Empty title="Nothing here" hint="Issues you raise appear immediately, flagged until a PM or lead engineer checks them." />}
  </Screen>;
}
