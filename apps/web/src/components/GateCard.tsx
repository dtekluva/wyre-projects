import { Link } from "react-router-dom";
import { ROLE_LABEL, STAGES, type EvidenceState } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, ReviewBadge } from "./ui";
import { VoidControl } from "./VoidControl";

const ICON: Record<EvidenceState, string> = { ok: "✓", pending: "…", rejected: "✕", missing: "" };

export function GateCard({ projectId }: { projectId: string }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const g = api.gateStatus(projectId);
  if (g.terminal) return <div className="card"><div className="card__head"><div className="card__title">Project closed</div><Badge variant="success">All gates passed</Badge></div>
    <div className="card__body muted">Records retained for project life + 7 years. Chronology and attachments are never deleted.</div></div>;
  const canRequest = api.can(user.id, "gate.request", projectId);
  const ok = g.items.filter((i) => i.state === "ok").length;
  const roles = g.approverRoles.map((r) => ROLE_LABEL[r]).join(" + ");
  const next = STAGES[g.nextStage!];
  return (
    <div className="card">
      <div className="card__head">
        <div><div className="ns-overline">Gate {g.stage} → {g.nextStage}</div><div className="card__title">Exit {g.name} → {next.name}</div></div>
        <Badge variant={g.ready ? "success" : ok === 0 ? "neutral" : "warning"}>{ok}/{g.items.length} evidence checked</Badge>
      </div>
      <ul className="gate__list">
        {g.items.map((i) => {
          const d = i.document;
          const sub = i.state === "missing" ? "Not yet added" : i.state === "rejected" ? d?.checkComment ?? "Rejected" :
            i.state === "pending" ? `Submitted by ${api.userName(d?.submittedBy)} — awaiting check` : `${d?.title} · checked by ${api.userName(d?.checkedBy)}`;
          return <li key={i.docType} className={`gate__item gate__item--${i.state}`}>
            <span className={`gate__state gate__state--${i.state}`} aria-hidden>{ICON[i.state]}</span>
            <div className="gate__label ellipsis">{i.label}<small className="ellipsis" title={sub}>{sub}</small></div>
            {d && !d.voidedAt && <VoidControl kind="document" id={d.id} projectId={d.projectId} size="xs" what={d.title} />}
            {d ? <ReviewBadge status={d.reviewStatus} /> : <Link to="documents" className="ns-btn ns-btn--ghost ns-btn--sm">Add</Link>}
          </li>;
        })}
      </ul>
      <div className="card__foot">
        <div className="sm muted">Approver{g.approverRoles.length > 1 ? "s" : ""}: <b>{roles}</b></div>
        {g.pendingApproval
          ? <Badge variant="warning"><span className="ns-badge__dot" />Awaiting {roles} · requested by {api.userName(g.pendingApproval.requestedBy)}</Badge>
          : <button className={`ns-btn ns-btn--sm ${g.ready ? "ns-btn--primary" : ""}`} disabled={!canRequest}
              title={!canRequest ? "Only a Director, Tech Lead or Finance can request a gate"
                : g.ready ? "Send to approvers" : "Outstanding evidence is listed for the approver — they decide"}
              onClick={() => safe(() => { api.requestGate(projectId, user.id); },
                g.ready ? "Gate approval requested" : "Requested — the approver will see what is outstanding")}>
              {g.ready ? "Request gate approval" : "Request anyway"}</button>}
      </div>
    </div>
  );
}
