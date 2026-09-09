import { useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABEL, naira, relative, type Approval } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge } from "./ui";

const KIND: Record<Approval["kind"], string> = { gate: "Stage gate", po: "Purchase order", change_order: "Change order", retention: "Retention release" };

export function ApprovalCard({ a }: { a: Approval }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  const project = api.projects.find((p) => p.id === a.projectId)!;
  const me = api.canDecide(user.id, a);
  const waiting = a.requiredRoles.filter((r) => !a.decisions.some((d) => d.role === r));
  return (
    <article className={`ns-approval ns-approval--${a.status}`}>
      <div className="ns-approval__top">
        <div><div className="ns-overline">{KIND[a.kind]} · <span className="ns-mono">{project.code}</span></div><h3 className="ns-approval__title">{a.title}</h3></div>
        <Badge variant={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"}><span className="ns-badge__dot" />{a.status}</Badge>
      </div>
      <div className="ns-approval__meta">
        <span>Raised by <b>{api.userName(a.requestedBy)}</b> {relative(a.requestedAt)}</span>
        {a.amount !== undefined && <span>Amount <b className="ns-mono">{naira(a.amount)}</b></span>}
        <span>Requires <b>{a.requiredRoles.map((r) => ROLE_LABEL[r]).join(" + ")}</b></span>
      </div>
      <div className="review__body"><div className="sm" style={{ color: "var(--ns-color-text-secondary)" }}>{a.description}</div></div>
      {a.decisions.length > 0 && <ul className="decisions">
        {a.decisions.map((d, i) => <li key={i}>{d.decision === "approved" ? "✓" : "✕"} <b>{api.userName(d.approverId)}</b> ({ROLE_LABEL[d.role]}) {d.decision} {relative(d.at)}{d.comment && <span className="muted"> — “{d.comment}”</span>}</li>)}
      </ul>}
      {a.status === "pending" && <div className="ns-approval__actions">
        {me.ok ? (rejecting ? <>
            <textarea className="ns-textarea" placeholder="Reason for rejection (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="ns-btn ns-btn--danger ns-btn--sm" onClick={() => { if (safe(() => api.decide(a.id, user.id, "rejected", comment), "Rejected")) setRejecting(false); }}>Confirm reject</button>
            <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(false)}>Cancel</button>
          </> : <>
            <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => api.decide(a.id, user.id, "approved"), `Approved as ${ROLE_LABEL[me.role!]}`)}>Approve as {ROLE_LABEL[me.role!]}</button>
            <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setRejecting(true)}>Reject…</button>
          </>)
          : <span className="sm muted">{me.reason} · awaiting {waiting.map((r) => ROLE_LABEL[r]).join(", ")}</span>}
        <Link className="ns-btn ns-btn--ghost ns-btn--sm right" to={`/projects/${a.projectId}`}>Open project</Link>
      </div>}
    </article>
  );
}
