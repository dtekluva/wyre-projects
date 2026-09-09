import { View } from "react-native";
import { useRouter } from "expo-router";
import { STAGES, naira, relative } from "@wyre/api";
import { useApi, useApp, useUser } from "@/store";
import { Badge, Button, Card, Divider, H2, P, Row, Screen } from "@/ui";
import { IssueRow } from "@/rows";
export default function Home() {
  const api = useApi(); const user = useUser(); const { signOut, syncedAt } = useApp(); const router = useRouter();
  const projects = api.listProjects(user.id).filter((p) => p.stage < 8);
  const mine = projects.map((p) => p.id);
  const issues = api.listIssues({ openOnly: true }).filter((i) => mine.includes(i.projectId)).sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt));
  const breached = issues.filter((i) => api.issueSla(i).breached).length;
  const awaiting = [...api.visits, ...api.issues, ...api.attachments].filter((x) => x.submittedBy === user.id && x.reviewStatus === "pending").length;
  const pendingParts = api.listMovements({ status: "pending" }).filter((m) => m.createdBy === user.id).length;
  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}><View><P tone="muted" small>Signed in as</P><H2>{user.name}</H2></View><Button label="Switch" kind="ghost" onPress={signOut} /></Row>
      <Row style={{ gap: 8 }}>
        <Card style={{ flex: 1 }}><P small tone="muted">Open issues</P><P bold style={{ fontSize: 24 }}>{issues.length}</P>{breached ? <Badge tone="danger">{breached} SLA breached</Badge> : <Badge tone="success">SLA ok</Badge>}</Card>
        <Card style={{ flex: 1 }}><P small tone="muted">Awaiting check</P><P bold style={{ fontSize: 24 }}>{awaiting + pendingParts}</P><P small tone="faint">{syncedAt ? `saved ${relative(syncedAt)}` : "saved locally"}</P></Card>
      </Row>
      <Row style={{ gap: 8 }}><Button label="＋ Log visit" onPress={() => router.push("/visit/new")} /><Button label="＋ Raise issue" kind="secondary" onPress={() => router.push("/issue/new")} /></Row>
      <H2>My projects</H2>
      {projects.map((p) => { const m = api.money(p.id); return <Card key={p.id}>
        <Row style={{ justifyContent: "space-between" }}><P bold style={{ flexShrink: 1 }}>{p.name}</P><Badge tone={p.rag === "green" ? "success" : p.rag === "amber" ? "warning" : "danger"}>{p.rag}</Badge></Row>
        <Row wrap><Badge tone="primary">{p.stage} · {STAGES[p.stage].short}</Badge><P small tone="muted">{p.clientName} · {p.location}</P></Row>
        <Divider /><Row style={{ justifyContent: "space-between" }}><P small tone="muted">{api.listIssues({ projectId: p.id, openOnly: true }).length} open issues</P><P small tone="muted">O&M actual {naira(m.byCategory.om.actual, true)}</P></Row>
      </Card>; })}
      <H2>Issues by SLA</H2>
      {issues.length ? issues.slice(0, 6).map((i) => <IssueRow key={i.id} issue={i} />) : <P tone="muted">No open issues on your projects.</P>}
    </Screen>
  );
}
