import { useState } from "react";
import { Link } from "react-router-dom";
import { STAGES, daysBetween, naira, pct, type Rag, type Stage } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useIsMobile } from "../lib/useMediaQuery";
import { Badge, Bar, Empty, RagDot, StageChip } from "../components/ui";
import { Dashboard } from "../components/Dashboard";

export function Portfolio() {
  const api = useApi(); const { user } = useAuth(); const mobile = useIsMobile();
  const [q, setQ] = useState(""); const [stage, setStage] = useState<"all" | Stage>("all"); const [rag, setRag] = useState<"all" | Rag>("all");
  const all = api.listProjects(user.id);
  // Without money.read the snapshot carries no actuals, so a burn figure would read as "nothing spent"
  // rather than "not yours to see". Hide the money columns instead of printing a misleading zero.
  const seesMoney = api.can(user.id, "money.read");
  const rows = all.filter((p) =>
    (stage === "all" || p.stage === stage) && (rag === "all" || p.rag === rag) &&
    (!q || `${p.code} ${p.name} ${p.clientName} ${p.location}`.toLowerCase().includes(q.toLowerCase())));
  const today = new Date().toISOString();
  const atRisk = all.filter((p) => p.rag !== "green").length;
  const contract = all.reduce((s, p) => s + p.contractValue, 0);
  const budget = seesMoney ? all.reduce((s, p) => s + api.money(p.id).planned, 0) : 0;
  const actual = seesMoney ? all.reduce((s, p) => s + api.money(p.id).actual, 0) : 0;
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Portfolio</h1><div className="page-sub">{all.length} projects you can see · {atRisk} need attention</div></div>
        {api.canCreateProject(user.id) && <Link to="/projects/new" className="ns-btn ns-btn--primary">+ New project</Link>}</div>
      <div className="hero">
        <div className="hero__figure">
          <div className="hero__value">{naira(contract, true)}</div>
          <div className="hero__label">contract value across {all.length} project{all.length === 1 ? "" : "s"}</div>
        </div>
        <div className="hero__side">
          <div className="hero__stat"><b>{all.filter((p) => p.stage < 8).length}</b><span>live</span></div>
          <div className={`hero__stat ${atRisk ? "hero__stat--warn" : ""}`}><b>{atRisk}</b><span>at risk</span></div>
          {seesMoney && <div className="hero__stat"><b>{pct(actual, budget)}%</b><span>budget burn</span></div>}
        </div>
      </div>

      <Dashboard projects={all} />

      <h2 className="dash__h2">All projects</h2>
      <div className="filters">
        <input className="ns-input" placeholder="Search code, name, client, location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ns-input" value={stage} onChange={(e) => setStage(e.target.value === "all" ? "all" : Number(e.target.value) as Stage)}>
          <option value="all">All stages</option>{STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.stage} · {s.name}</option>)}</select>
        {(["all", "red", "amber", "green"] as const).map((r) => <button key={r} className={`chip ${rag === r ? "chip--on" : ""}`} onClick={() => setRag(r)}>{r === "all" ? "All RAG" : <><RagDot rag={r} /> {r}</>}</button>)}
      </div>
      {mobile ? (rows.length === 0 ? <Empty title="No projects match" hint="Try clearing the filters." /> : <div className="stack">{rows.map((p) => {
        const planned = p.stagePlanned[p.stage]; const slip = planned && planned < today ? daysBetween(planned, today) : 0;
        const mo = seesMoney ? api.money(p.id) : undefined; const burn = mo?.burnPct ?? 0; const g = api.gateStatus(p.id); const ok = g.items.filter((i) => i.state === "ok").length; const pending = api.pendingChecks(p.id);
        return <Link key={p.id} to={`/projects/${p.id}`} className="card pcard">
          <div className="pcard__top"><RagDot rag={p.rag} title={p.ragReason} /><span className="pcard__name">{p.name}</span><StageChip stage={p.stage} /></div>
          <div className="sm muted"><span className="ns-mono">{p.code}</span> · {p.clientName} · {p.location}</div>
          <div className="pcard__row"><span className="ns-mono">{naira(p.contractValue, true)}</span>{seesMoney && <span className="row"><Bar pct={burn} /><span className="sm ns-mono">{mo!.planned ? `${burn}%` : "—"}</span></span>}</div>
          <div className="pcard__row row--wrap">
            {slip > 0 ? <Badge variant={slip > 7 ? "danger" : "warning"}>+{slip} d</Badge> : p.stage !== 8 && <Badge variant="success">on track</Badge>}
            {p.openIssues.critical > 0 && <Badge variant="danger">{p.openIssues.critical} crit</Badge>}{p.openIssues.high > 0 && <Badge variant="warning">{p.openIssues.high} high</Badge>}
            {pending > 0 && <Badge variant="warning">{pending} to check</Badge>}
            <span className="sm muted right">{g.terminal ? "closed" : g.pendingApproval ? "awaiting approval" : g.ready ? "gate ready" : `${ok}/${g.items.length} evidence`}</span>
          </div>
        </Link>; })}</div>) :
      <div className="card table--wrap">
        {rows.length === 0 ? <div className="card__body"><Empty title="No projects match" hint="Try clearing the filters." /></div> :
        <table className="table">
          <thead><tr><th>Project</th><th>Stage</th><th>RAG</th><th className="num">Contract</th>{seesMoney && <th>Budget burn</th>}<th>Slip</th><th>Issues</th><th className="num">Checks</th><th>Gate</th></tr></thead>
          <tbody>{rows.map((p) => {
            const planned = p.stagePlanned[p.stage]; const slip = planned && planned < today ? daysBetween(planned, today) : 0;
            const mo = seesMoney ? api.money(p.id) : undefined; const burn = mo?.burnPct ?? 0; const g = api.gateStatus(p.id); const ok = g.items.filter((i) => i.state === "ok").length;
            const pending = api.pendingChecks(p.id);
            return <tr key={p.id}>
              <td><Link to={`/projects/${p.id}`} className="link">{p.name}</Link><div className="sm muted"><span className="ns-mono">{p.code}</span> · {p.clientName} · {p.location}</div></td>
              <td><StageChip stage={p.stage} /></td>
              <td><span className="row"><RagDot rag={p.rag} title={p.ragReason} /><span className="sm">{p.rag}</span></span></td>
              <td className="num ns-mono">{naira(p.contractValue, true)}</td>
              {seesMoney && <td><span className="row"><Bar pct={burn} /><span className="sm ns-mono">{mo!.planned ? `${burn}%` : "—"}</span></span></td>}
              <td>{slip > 0 ? <Badge variant={slip > 7 ? "danger" : "warning"}>+{slip} d</Badge> : p.stage === 8 ? <span className="sm muted">—</span> : <Badge variant="success">on track</Badge>}</td>
              <td><span className="row row--wrap">{p.openIssues.critical > 0 && <Badge variant="danger">{p.openIssues.critical} crit</Badge>}{p.openIssues.high > 0 && <Badge variant="warning">{p.openIssues.high} high</Badge>}
                {(p.openIssues.medium + p.openIssues.low) > 0 && <span className="sm muted">{p.openIssues.medium + p.openIssues.low} other</span>}{Object.values(p.openIssues).every((n) => n === 0) && <span className="sm muted">none</span>}</span></td>
              <td className="num">{pending ? <Badge variant="warning">{pending}</Badge> : <span className="sm muted">0</span>}</td>
              <td className="sm">{g.terminal ? <span className="muted">closed</span> : g.pendingApproval ? <Badge variant="info">awaiting approval</Badge> : g.ready ? <Badge variant="success">ready</Badge> : <span className="muted">{ok}/{g.items.length} checked</span>}</td>
            </tr>; })}
          </tbody>
        </table>}
      </div>}
    </>
  );
}
