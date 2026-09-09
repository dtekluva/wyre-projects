import { useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ISSUE_STATUS_LABEL, fmtDate, naira, relative } from "@wyre/api";
import { useApi, useUser } from "@/store";
import { PhotoStrip } from "@/photos";
import { Badge, Button, Card, Divider, Empty, Field, H2, Input, KV, P, Row, Screen } from "@/ui";
import { SEV } from "@/rows";
export default function IssueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(); const api = useApi(); const user = useUser(); const router = useRouter();
  const i = api.issues.find((x) => x.id === id);
  const [resolving, setResolving] = useState(false); const [root, setRoot] = useState(""); const [res, setRes] = useState(""); const [cost, setCost] = useState(""); const [after, setAfter] = useState<string[]>([]);
  if (!i) return <Screen><Empty title="Issue not found" /></Screen>;
  const sla = api.issueSla(i); const canUpdate = api.can(user.id, "issue.update", i.projectId) && !["closed", "wont_fix", "resolved"].includes(i.status);
  const asset = i.assetId ? api.assets.find((a) => a.id === i.assetId) : undefined;
  const act = (fn: () => void, ok?: string) => { try { fn(); if (ok) Alert.alert(ok); } catch (e) { Alert.alert("Not allowed", (e as Error).message); } };
  return <Screen>
    <Stack.Screen options={{ title: api.projectCode(i.projectId) }} />
    <Row wrap><Badge tone={SEV[i.severity]}>{i.severity}</Badge><Badge tone={i.status === "closed" ? "success" : i.status === "resolved" ? "warning" : "neutral"}>{ISSUE_STATUS_LABEL[i.status]}</Badge>
      <Badge tone={i.reviewStatus === "checked" ? "success" : i.reviewStatus === "rejected" ? "danger" : "warning"}>{i.reviewStatus} v{i.reviewVersion}</Badge>{i.isSnag && <Badge tone="info">snag</Badge>}</Row>
    <H2>{i.title}</H2>
    <P>{i.description}</P>
    <Card>
      <KV k="Raised" v={`${api.userName(i.raisedBy)} · ${relative(i.raisedAt)}`} />
      <KV k="SLA" v={sla.open ? (sla.breached ? `BREACHED by ${Math.abs(sla.hoursLeft)} h` : `${sla.hoursLeft} h left`) : "closed"} />
      {i.assigneeId && <KV k="Assigned" v={api.userName(i.assigneeId)} />}
      {asset && <KV k="Asset" v={`${asset.make} ${asset.model} · ${asset.serial}`} />}
      {i.checkComment && <KV k="Checker" v={`${api.userName(i.checkedBy)}: “${i.checkComment}”`} />}
    </Card>
    <Field label="Before"><PhotoStrip projectId={i.projectId} ids={i.beforeAttachmentIds} caption="" readOnly /></Field>
    {i.afterAttachmentIds.length > 0 && <Field label="After"><PhotoStrip projectId={i.projectId} ids={i.afterAttachmentIds} caption="" readOnly /></Field>}
    {i.resolution && <Card><P small tone="muted">Root cause</P><P>{i.rootCause}</P><Divider /><P small tone="muted">Resolution</P><P>{i.resolution}</P>{i.costToResolve > 0 && <P small tone="muted">Cost {naira(i.costToResolve)}</P>}<P small tone="faint">{api.userName(i.resolvedBy)} · {fmtDate(i.resolvedAt)}</P></Card>}
    {canUpdate && !resolving && <Row wrap>
      {i.status === "open" && <Button label="Start work" onPress={() => act(() => api.setIssueStatus(user.id, i.id, "in_progress", user.id))} />}
      {i.status !== "awaiting_parts" && i.status !== "open" && <Button label="Awaiting parts" kind="secondary" onPress={() => act(() => api.setIssueStatus(user.id, i.id, "awaiting_parts"))} />}
      {i.status === "awaiting_parts" && <Button label="Back in progress" kind="secondary" onPress={() => act(() => api.setIssueStatus(user.id, i.id, "in_progress"))} />}
      <Button label="Resolve…" kind={i.status === "open" ? "secondary" : "primary"} onPress={() => setResolving(true)} />
    </Row>}
    {resolving && <Card>
      <H2>Resolve</H2>
      <Field label="Root cause"><Input value={root} onChangeText={setRoot} placeholder="Why it happened" /></Field>
      <Field label="Resolution"><Input value={res} onChangeText={setRes} multiline placeholder="What you did" /></Field>
      <Field label="Extra cost (₦, optional)" hint="Parts and labour from a visit are costed there — only add what is not on a visit"><Input value={cost} onChangeText={setCost} keyboardType="numeric" placeholder="0" /></Field>
      <Field label="After photo (required)"><PhotoStrip projectId={i.projectId} ids={after} onChange={setAfter} caption={`After — ${i.title}`} /></Field>
      <Row><Button label="Submit resolution" onPress={() => act(() => { api.resolveIssue(user.id, i.id, { rootCause: root, resolution: res, afterAttachmentIds: after, costToResolve: Number(cost) || 0 }); setResolving(false); router.back(); }, "Resolution submitted — pending check")} /><Button label="Cancel" kind="ghost" onPress={() => setResolving(false)} /></Row>
    </Card>}
  </Screen>;
}
