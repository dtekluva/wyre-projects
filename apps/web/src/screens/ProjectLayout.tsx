import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { ApiError, PROJECT_TYPE_LABEL, ROLE_LABEL, STAGES, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Avatar, Badge, Empty, Note, RagDot, StageChip } from "../components/ui";
import { Timeline } from "../components/Timeline";

const Tab = ({ to, label, end, soon }: { to: string; label: string; end?: boolean; soon?: string }) =>
  soon ? <span className="tab tab--soon" title={`Coming in ${soon}`}>{label}<span className="tab__hint">{soon}</span></span>
       : <NavLink to={to} end={end} className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}>{label}</NavLink>;

export function ProjectLayout() {
  const { id = "" } = useParams(); const api = useApi(); const { user } = useAuth();
  let p: Project;
  try { p = api.getProject(user.id, id); }
  catch (e) { return <Empty title={e instanceof ApiError && e.code === "forbidden" ? "You are not a member of this project" : "Project not found"} hint="Ask a Project Manager or Admin to add you." />; }
  const pending = api.listApprovals({ projectId: p.id, status: "pending" });
  const team = api.listMemberships(p.id);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="row sm muted"><Link to="/" className="link muted">Portfolio</Link><span>/</span><span className="ns-mono">{p.code}</span></div>
          <h1 className="page-title">{p.name}</h1>
          <div className="page-sub row row--wrap">{p.clientName} · {p.branchName} · {p.location} · {PROJECT_TYPE_LABEL[p.projectType]}{p.systemCapacityKwp ? ` · ${p.systemCapacityKwp} kWp` : ""}</div>
        </div>
        <div className="stack page-head__side">
          <div className="row"><StageChip stage={p.stage} /><Badge variant={p.rag === "green" ? "success" : p.rag === "amber" ? "warning" : "danger"}><RagDot rag={p.rag} /> {p.rag.toUpperCase()}</Badge></div>
          <div className="row row--wrap sm muted">PM <Avatar user={api.getUser(p.pmId)} sm /> {api.userName(p.pmId)} · Lead Eng <Avatar user={api.getUser(p.leadEngineerId)} sm /> {api.userName(p.leadEngineerId)}</div>
        </div>
      </div>
      {p.ragReason && <div style={{ marginBottom: 16 }}><Note tone={p.rag === "red" ? "danger" : "warn"}><b>Why {p.rag}:</b> {p.ragReason}</Note></div>}
      <nav className="tabs">
        <Tab to={`/projects/${p.id}`} label="Overview" end />
        <Tab to={`/projects/${p.id}/timeline`} label="Timeline" />
        <Tab to={`/projects/${p.id}/documents`} label="Documents & evidence" />
        <Tab to={`/projects/${p.id}/people`} label="People" />
        <Tab to={`/projects/${p.id}/money`} label="Money" />
        <Tab to={`/projects/${p.id}/assets`} label="Assets & stock" />
        <Tab to="#" label="Field" soon="Phase 3" />
      </nav>
      <div className="workspace">
        <div><Outlet context={p} /></div>
        <aside className="ctx">
          <div className="card ctx__card"><div className="ctx__title">Awaiting approval</div>
            {pending.length ? <div className="stack">{pending.map((a) => <div key={a.id} className="sm"><Link to="/work/approvals" className="link">{a.title}</Link><div className="muted">needs {a.requiredRoles.filter((r) => !a.decisions.some((d) => d.role === r)).map((r) => ROLE_LABEL[r]).join(", ")}</div></div>)}</div>
              : <div className="sm muted">Nothing pending</div>}</div>
          <div className="card ctx__card"><div className="ctx__title">Stage</div><div className="sm"><b>{STAGES[p.stage].name}</b><div className="muted">{p.stagePlanned[p.stage] ? `Planned exit ${p.stagePlanned[p.stage]}` : "No planned exit date"}</div></div></div>
          <div className="card ctx__card"><div className="ctx__title">Team</div><div className="stack" style={{ gap: 6 }}>{team.map((m) => <div key={m.id} className="row sm"><Avatar user={api.getUser(m.userId)} sm /><span className="grow ellipsis">{api.userName(m.userId)}</span><span className="muted">{ROLE_LABEL[m.role]}</span></div>)}</div></div>
          <div className="card ctx__card"><div className="ctx__title">Recent activity</div><Timeline events={api.listEvents(p.id)} limit={5} /><Link to={`/projects/${p.id}/timeline`} className="sm link">Full timeline →</Link></div>
        </aside>
      </div>
    </>
  );
}
