import { useState } from "react";
import { Link } from "react-router-dom";
import { STAGES, daysBetween, naira, pct, type Rag, type Stage } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Badge, Bar, Empty, Kpi, RagDot, StageChip } from "../components/ui";

export function Portfolio() {
  const api = useApi(); const { user } = useAuth();
  const [q, setQ] = useState(""); const [stage, setStage] = useState<"all" | Stage>("all"); const [rag, setRag] = useState<"all" | Rag>("all");
  const all = api.listProjects(user.id);
  const rows = all.filter((p) =>
    (stage === "all" || p.stage === stage) && (rag === "all" || p.rag === rag) &&
    (!q || `${p.code} ${p.name} ${p.clientName} ${p.location}`.toLowerCase().includes(q.toLowerCase())));
  const today = new Date().toISOString();
  const atRisk = all.filter((p) => p.rag !== "green").length;
  const checks = api.reviewQueue(user.id).length; const approvals = api.approvalsFor(user.id).length;
  const contract = all.reduce((s, p) => s + p.contractValue, 0);
  const budget = all.reduce((s, p) => s + p.approvedBudget, 0); const actual = all.reduce((s, p) => s + p.actual, 0);
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Portfolio</h1><div className="page-sub">{all.length} projects you can see · {atRisk} need attention</div></div></div>
      <div className="kpis">
        <Kpi label="Projects" value={all.length} sub={`${all.filter((p) => p.stage === 8).length} closed`} />
        <Kpi label="At risk" value={atRisk} sub={`${all.filter((p) => p.rag === "red").length} red · ${all.filter((p) => p.rag === "amber").length} amber`} tone={atRisk ? "warn" : undefined} />
        <Kpi label="My checks" value={checks} sub="inputs awaiting me" tone={checks ? "accent" : undefined} />
        <Kpi label="My approvals" value={approvals} sub="gates / POs / COs" tone={approvals ? "accent" : undefined} />
        <Kpi label="Contract value" value={naira(contract, true)} sub="across visible projects" />
        <Kpi label="Budget burn" value={`${pct(actual, budget)}%`} sub={`${naira(actual, true)} of ${naira(budget, true)}`} />
      </div>
      <div className="filters">
        <input className="ns-input" placeholder="Search code, name, client, location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ns-input" value={stage} onChange={(e) => setStage(e.target.value === "all" ? "all" : Number(e.target.value) as Stage)}>
          <option value="all">All stages</option>{STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.stage} · {s.name}</option>)}</select>
        {(["all", "red", "amber", "green"] as const).map((r) => <button key={r} className={`chip ${rag === r ? "chip--on" : ""}`} onClick={() => setRag(r)}>{r === "all" ? "All RAG" : <><RagDot rag={r} /> {r}</>}</button>)}
      </div>
      <div className="card table--wrap">
        {rows.length === 0 ? <div className="card__body"><Empty title="No projects match" hint="Try clearing the filters." /></div> :
        <table className="table">
          <thead><tr><th>Project</th><th>Stage</th><th>RAG</th><th className="num">Contract</th><th>Budget burn</th><th>Slip</th><th>Issues</th><th className="num">Checks</th><th>Gate</th></tr></thead>
          <tbody>{rows.map((p) => {
            const planned = p.stagePlanned[p.stage]; const slip = planned && planned < today ? daysBetween(planned, today) : 0;
            const burn = pct(p.actual, p.approvedBudget); const g = api.gateStatus(p.id); const ok = g.items.filter((i) => i.state === "ok").length;
            const pending = api.pendingChecks(p.id);
            return <tr key={p.id}>
              <td><Link to={`/projects/${p.id}`} className="link">{p.name}</Link><div className="sm muted"><span className="ns-mono">{p.code}</span> · {p.clientName} · {p.location}</div></td>
              <td><StageChip stage={p.stage} /></td>
              <td><span className="row"><RagDot rag={p.rag} title={p.ragReason} /><span className="sm">{p.rag}</span></span></td>
              <td className="num ns-mono">{naira(p.contractValue, true)}</td>
              <td><span className="row"><Bar pct={burn} /><span className="sm ns-mono">{p.approvedBudget ? `${burn}%` : "—"}</span></span></td>
              <td>{slip > 0 ? <Badge variant={slip > 7 ? "danger" : "warning"}>+{slip} d</Badge> : p.stage === 8 ? <span className="sm muted">—</span> : <Badge variant="success">on track</Badge>}</td>
              <td className="row">{p.openIssues.critical > 0 && <Badge variant="danger">{p.openIssues.critical} crit</Badge>}{p.openIssues.high > 0 && <Badge variant="warning">{p.openIssues.high} high</Badge>}
                {(p.openIssues.medium + p.openIssues.low) > 0 && <span className="sm muted">{p.openIssues.medium + p.openIssues.low} other</span>}{Object.values(p.openIssues).every((n) => n === 0) && <span className="sm muted">none</span>}</td>
              <td className="num">{pending ? <Badge variant="warning">{pending}</Badge> : <span className="sm muted">0</span>}</td>
              <td className="sm">{g.terminal ? <span className="muted">closed</span> : g.pendingApproval ? <Badge variant="info">awaiting approval</Badge> : g.ready ? <Badge variant="success">ready</Badge> : <span className="muted">{ok}/{g.items.length} checked</span>}</td>
            </tr>; })}
          </tbody>
        </table>}
      </div>
    </>
  );
}
