import { Link, useOutletContext } from "react-router-dom";
import { STAGES, daysBetween, fmtDate, type Project, type Stage } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { StageBar } from "../components/StageBar";
import { MoneyStrip } from "../components/MoneyStrip";
import { GateCard } from "../components/GateCard";
import { Badge } from "../components/ui";

export function ProjectOverview() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth();
  const g = api.gateStatus(p.id);
  const pendingChecks = api.reviewQueue(user.id).filter((i) => i.projectId === p.id);
  const actions: { text: string; to: string; tone: "danger" | "warning" | "info" }[] = [];
  g.items.filter((i) => i.state === "rejected").forEach((i) => actions.push({ text: `Resubmit ${i.label} — rejected`, to: "documents", tone: "danger" }));
  g.items.filter((i) => i.state === "missing").forEach((i) => actions.push({ text: `Add ${i.label}`, to: "documents", tone: "warning" }));
  if (pendingChecks.length) actions.push({ text: `${pendingChecks.length} input${pendingChecks.length > 1 ? "s" : ""} awaiting your check`, to: "/work/reviews", tone: "info" });
  if (g.pendingApproval) actions.push({ text: `Gate approval awaiting ${g.approverRoles.join(" + ")}`, to: "/work/approvals", tone: "info" });
  if (g.ready && !g.pendingApproval && !g.terminal) actions.push({ text: "Gate evidence complete — request approval", to: "", tone: "info" });
  const today = new Date().toISOString();
  return (
    <div className="stack" style={{ gap: 20 }}>
      <StageBar stage={p.stage} />
      <MoneyStrip p={p} />
      <GateCard projectId={p.id} />
      <div className="card">
        <div className="card__head"><div className="card__title">Next actions</div><Badge variant={actions.length ? "warning" : "success"}>{actions.length || "none"}</Badge></div>
        <div className="card__body">{actions.length ? <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{actions.map((a, i) => <li key={i} className={`sm`} style={{ color: a.tone === "danger" ? "var(--ns-color-danger-text)" : undefined }}>{a.to ? <Link to={a.to} className="link">{a.text}</Link> : a.text}</li>)}</ul> : <div className="sm muted">Nothing outstanding for this stage.</div>}</div>
      </div>
      <div className="card table--wrap">
        <div className="card__head"><div className="card__title">Plan vs actual</div><span className="sm muted">Stage exit dates</span></div>
        <table className="table"><thead><tr><th>#</th><th>Stage</th><th>Planned exit</th><th>Actual</th><th>Slip</th></tr></thead>
          <tbody>{STAGES.map((s) => { const st = s.stage as Stage; const pl = p.stagePlanned[st]; const ac = p.stageActual[st];
            const slip = pl && (ac ?? (st === p.stage ? today : undefined)) ? daysBetween(pl, ac ?? today) : undefined;
            return <tr key={st} style={{ opacity: st > p.stage ? 0.55 : 1 }}>
              <td className="ns-mono">{st}</td><td>{s.name}{st === p.stage && <Badge variant="info">current</Badge>}</td>
              <td className="sm">{fmtDate(pl)}</td><td className="sm">{fmtDate(ac)}</td>
              <td>{slip === undefined ? <span className="sm muted">—</span> : slip > 0 ? <Badge variant={slip > 7 ? "danger" : "warning"}>+{slip} d</Badge> : <Badge variant="success">{slip === 0 ? "on time" : `${-slip} d early`}</Badge>}</td>
            </tr>; })}</tbody></table>
      </div>
    </div>
  );
}
