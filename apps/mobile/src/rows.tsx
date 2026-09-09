import { useRouter } from "expo-router";
import { ISSUE_STATUS_LABEL, VISIT_TYPE_LABEL, naira, relative, type Issue, type SiteVisit } from "@wyre/api";
import { useApi } from "@/store";
import { Badge, Card, P, Row } from "@/ui";
import type { Tone } from "@/theme";
export const SEV: Record<Issue["severity"], Tone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
export function IssueRow({ issue }: { issue: Issue }) {
  const api = useApi(); const router = useRouter(); const sla = api.issueSla(issue);
  return <Card onPress={() => router.push(`/issue/${issue.id}`)}>
    <Row style={{ justifyContent: "space-between" }}><P bold style={{ flexShrink: 1 }}>{issue.title}</P><Badge tone={SEV[issue.severity]}>{issue.severity}</Badge></Row>
    <Row wrap><P small mono tone="muted">{api.projectCode(issue.projectId)}</P><Badge tone={issue.status === "closed" ? "success" : issue.status === "resolved" ? "warning" : "neutral"}>{ISSUE_STATUS_LABEL[issue.status]}</Badge>
      {issue.reviewStatus === "pending" && <Badge tone="warning">pending check</Badge>}
      {sla.open && (sla.breached ? <Badge tone="danger">SLA breached {Math.abs(sla.hoursLeft)} h</Badge> : <P small tone="faint">SLA in {sla.hoursLeft} h</P>)}</Row>
    <P small tone="muted">{relative(issue.raisedAt)} · {api.userName(issue.raisedBy)}</P>
  </Card>;
}
export function VisitRow({ visit }: { visit: SiteVisit }) {
  const api = useApi(); const router = useRouter();
  return <Card onPress={() => router.push(`/visit/${visit.id}`)}>
    <Row style={{ justifyContent: "space-between" }}><P bold>{VISIT_TYPE_LABEL[visit.visitType]}</P><Badge tone={visit.reviewStatus === "checked" ? "success" : visit.reviewStatus === "rejected" ? "danger" : "warning"}>{visit.reviewStatus}</Badge></Row>
    <Row wrap><P small mono tone="muted">{api.projectCode(visit.projectId)}</P><P small tone="muted">{relative(visit.startedAt)} · {visit.durationHrs} h · {naira(visit.costTotal, true)}</P></Row>
    <P small tone="muted" style={{}} >{visit.findings.length > 90 ? visit.findings.slice(0, 90) + "…" : visit.findings}</P>
  </Card>;
}
