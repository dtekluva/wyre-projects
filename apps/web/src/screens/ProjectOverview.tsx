import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { STAGES, daysBetween, fmtDate, type Project, type Stage } from "@wyre/api";
import { useSafe } from "../lib/toast";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { StageBar } from "../components/StageBar";
import { RollbackControl } from "../components/RollbackControl";
import { MoneyStrip } from "../components/MoneyStrip";
import { GateCard } from "../components/GateCard";
import { Badge } from "../components/ui";

export function ProjectOverview() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const g = api.gateStatus(p.id);
  // Schedule editing: the PM's call (project.update). Exited stages are history and stay read-only.
  const canPlan = api.can(user.id, "project.update", p.id);
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<Partial<Record<Stage, string>>>({});
  const startEdit = () => { setPlan({ ...p.stagePlanned }); setEditing(true); };
  const savePlan = () => {
    const planned: Partial<Record<Stage, string | null>> = {};
    for (const s of STAGES) { const st = s.stage as Stage; if (st < p.stage) continue; const v = plan[st] ?? null; if ((p.stagePlanned[st] ?? null) !== v) planned[st] = v; }
    if (!Object.keys(planned).length) { setEditing(false); return; }
    if (safe(() => api.setStagePlan(user.id, p.id, { planned }), "Schedule updated")) setEditing(false);
  };
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
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}><div className="grow"><StageBar stage={p.stage} /></div><RollbackControl p={p} /></div>
      <MoneyStrip p={p} />
      <GateCard projectId={p.id} />
      <div className="card">
        <div className="card__head"><div className="card__title">Next actions</div><Badge variant={actions.length ? "warning" : "success"}>{actions.length || "none"}</Badge></div>
        <div className="card__body">{actions.length ? <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{actions.map((a, i) => <li key={i} className={`sm`} style={{ color: a.tone === "danger" ? "var(--ns-color-danger-text)" : undefined }}>{a.to ? <Link to={a.to} className="link">{a.text}</Link> : a.text}</li>)}</ul> : <div className="sm muted">Nothing outstanding for this stage.</div>}</div>
      </div>
      <div id="schedule" className="card table--wrap">
        <div className="card__head"><div className="card__title">Plan vs actual</div>
          <div className="row" style={{ gap: 8 }}><span className="sm muted">Stage exit dates</span>
            {canPlan && !editing && <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={startEdit}>Edit schedule</button>}
            {editing && <><button className="ns-btn ns-btn--primary ns-btn--sm" onClick={savePlan}>Save</button><button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setEditing(false)}>Cancel</button></>}</div></div>
        {editing && <div className="note note--info sm" style={{ margin: "8px 16px 0" }}>Dates must run in stage order. Stages already exited are history and cannot be changed. Every change is logged in the chronology.</div>}
        <table className="table"><thead><tr><th>#</th><th>Stage</th><th>Planned exit</th><th>Actual</th><th>Slip</th></tr></thead>
          <tbody>{STAGES.map((s) => { const st = s.stage as Stage; const pl = p.stagePlanned[st]; const ac = p.stageActual[st];
            const slip = pl && (ac ?? (st === p.stage ? today : undefined)) ? daysBetween(pl, ac ?? today) : undefined;
            const locked = st < p.stage;
            return <tr key={st} style={{ opacity: st > p.stage && !editing ? 0.55 : 1 }}>
              <td className="ns-mono">{st}</td><td>{s.name}{st === p.stage && <Badge variant="info">current</Badge>}</td>
              <td className="sm">{editing && !locked
                ? <input className="ns-input" type="date" style={{ minHeight: 32, width: 160 }} value={plan[st] ?? ""} onChange={(e) => setPlan({ ...plan, [st]: e.target.value || undefined })} />
                : (pl ? fmtDate(pl) : <span className="muted">{editing ? "exited" : "—"}</span>)}</td><td className="sm">{fmtDate(ac)}</td>
              <td>{slip === undefined ? <span className="sm muted">—</span> : slip > 0 ? <Badge variant={slip > 7 ? "danger" : "warning"}>+{slip} d</Badge> : <Badge variant="success">{slip === 0 ? "on time" : `${-slip} d early`}</Badge>}</td>
            </tr>; })}</tbody></table>
      </div>
    </div>
  );
}
