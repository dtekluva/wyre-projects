import { Stack, useLocalSearchParams } from "expo-router";
import { VISIT_TYPE_LABEL, naira, relative } from "@wyre/api";
import { useApi } from "@/store";
import { PhotoStrip } from "@/photos";
import { Badge, Card, Divider, Empty, Field, H2, KV, P, Row, Screen } from "@/ui";
export default function VisitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(); const api = useApi();
  const v = api.visits.find((x) => x.id === id);
  if (!v) return <Screen><Empty title="Visit not found" /></Screen>;
  return <Screen>
    <Stack.Screen options={{ title: api.projectCode(v.projectId) }} />
    <Row wrap><Badge tone="primary">{VISIT_TYPE_LABEL[v.visitType]}</Badge><Badge tone={v.reviewStatus === "checked" ? "success" : v.reviewStatus === "rejected" ? "danger" : "warning"}>{v.reviewStatus}</Badge></Row>
    <H2>{new Date(v.startedAt).toLocaleDateString()} · {v.durationHrs} h</H2>
    <Card>
      <KV k="Technicians" v={v.technicianIds.map((t) => api.userName(t)).join(", ")} />
      <KV k="Logged" v={relative(v.createdAt)} />
      {v.gps && <KV k="GPS" v={`${v.gps.lat.toFixed(4)}, ${v.gps.lng.toFixed(4)}`} />}
      {v.checkComment && <KV k="Checker" v={`${api.userName(v.checkedBy)}: “${v.checkComment}”`} />}
    </Card>
    <Field label="Findings"><P>{v.findings}</P></Field>
    <Field label="Actions taken"><P>{v.actionsTaken || "—"}</P></Field>
    <Card>
      <P small tone="muted">Costs</P>
      <KV k="Travel" v={naira(v.costTravel)} /><KV k="Labour" v={naira(v.costLabour)} /><KV k="Parts" v={naira(v.costParts)} /><Divider /><KV k="Total" v={naira(v.costTotal)} />
    </Card>
    {v.parts.length > 0 && <Card><P small tone="muted">Parts used</P>{v.parts.map((p) => <Row key={p.movementId} style={{ justifyContent: "space-between" }}><P>{api.itemName(p.itemId)} × {p.qty}</P>{p.serials?.length ? <P small mono tone="muted">{p.serials.join(", ")}</P> : null}</Row>)}</Card>}
    <Field label="Photos"><PhotoStrip projectId={v.projectId} ids={v.attachmentIds} caption="" readOnly /></Field>
    {v.clientSignoff && <Card><P small tone="muted">Client sign-off</P><P bold>{v.clientSignoff.name}</P>{v.clientSignoff.rating && <P>{"★".repeat(v.clientSignoff.rating)}</P>}{v.clientSignoff.signatureAttachmentId && <PhotoStrip projectId={v.projectId} ids={[v.clientSignoff.signatureAttachmentId]} caption="" readOnly />}</Card>}
  </Screen>;
}
