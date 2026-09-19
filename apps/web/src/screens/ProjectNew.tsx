import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PROJECT_TYPE_LABEL, ROLE_LABEL, type ProjectType } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Note } from "../components/ui";

const TYPES = Object.keys(PROJECT_TYPE_LABEL) as ProjectType[];

export function ProjectNew() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe(); const nav = useNavigate();
  // both owners are Tech Leads now; the two fields still name who is responsible for what
  const pms = api.getUsers().filter((u) => u.roles.includes("techlead"));
  const les = pms;
  const [name, setName] = useState(""); const [client, setClient] = useState(""); const [branch, setBranch] = useState(""); const [loc, setLoc] = useState("");
  const [type, setType] = useState<ProjectType>("solar_battery"); const [kwp, setKwp] = useState("");
  const [contract, setContract] = useState(""); const [budget, setBudget] = useState("");
  const [retention, setRetention] = useState(String(api.thresholdNum("retention.percent", 5)));
  const [pmId, setPmId] = useState(user.roles.includes("techlead") ? user.id : pms[0]?.id ?? ""); const [leId, setLeId] = useState(les[0]?.id ?? "");
  const [due, setDue] = useState("");
  const allowed = api.canCreateProject(user.id);
  const nextCode = api.nextProjectCode();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let id = "";
    const ok = safe(() => {
      const p = api.createProject(user.id, {
        name, clientName: client, branchName: branch, location: loc, projectType: type,
        systemCapacityKwp: kwp.trim() ? Number(kwp) : undefined,
        contractValue: Number(contract || 0), approvedBudget: Number(budget || 0), retentionPercent: Number(retention),
        pmId, leadEngineerId: leId, proposalDueDate: due || undefined,
      });
      id = p.id;
    }, "Project created — now at stage 0 · Lead / Proposal");
    if (ok) nav(`/projects/${id}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row sm muted"><Link to="/" className="link muted">Portfolio</Link><span>/</span><span>New project</span></div>
          <h1 className="page-title">New project</h1>
          <div className="page-sub">Opens at stage 0 · Lead / Proposal. Next code <span className="ns-mono">{nextCode}</span>. Creator and every later change are captured in the chronology.</div>
        </div>
      </div>
      {!allowed ? <Note tone="warn">Only a {ROLE_LABEL.techlead} or {ROLE_LABEL.director} can open a project. You are signed in as {user.name} ({user.roles.map((r) => ROLE_LABEL[r]).join(", ")}).</Note> :
      <form className="stack" onSubmit={submit} style={{ maxWidth: 860 }}>
        <div className="card">
          <div className="card__head"><b>Client & site</b></div>
          <div className="card__body form">
            <label className="ns-field" style={{ gridColumn: "1 / -1" }}><span className="ns-field__label">Project name</span>
              <input className="ns-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sweet Sensation Sango — Solar + Battery" /></label>
            <label className="ns-field"><span className="ns-field__label">Client</span>
              <input className="ns-input" required value={client} onChange={(e) => setClient(e.target.value)} placeholder="Company or person" /></label>
            <label className="ns-field"><span className="ns-field__label">Branch / site</span>
              <input className="ns-input" required value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. Sango" /></label>
            <label className="ns-field"><span className="ns-field__label">Location</span>
              <input className="ns-input" required value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Town, State" /></label>
            <label className="ns-field"><span className="ns-field__label">Project type</span>
              <select className="ns-input" value={type} onChange={(e) => setType(e.target.value as ProjectType)}>{TYPES.map((t) => <option key={t} value={t}>{PROJECT_TYPE_LABEL[t]}</option>)}</select></label>
            <label className="ns-field"><span className="ns-field__label">System capacity (kWp, optional)</span>
              <input className="ns-input" type="number" min="0" step="0.1" value={kwp} onChange={(e) => setKwp(e.target.value)} placeholder="e.g. 40.6" /></label>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><b>Commercials</b><span className="sm muted">Budget lines, POs and actuals are added later under Money</span></div>
          <div className="card__body form">
            <label className="ns-field"><span className="ns-field__label">Contract value (₦, VAT inclusive)</span>
              <input className="ns-input" type="number" min="0" step="1" required value={contract} onChange={(e) => setContract(e.target.value)} placeholder="0" /></label>
            <label className="ns-field"><span className="ns-field__label">Approved cost budget (₦)</span>
              <input className="ns-input" type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 until approved" /></label>
            <label className="ns-field"><span className="ns-field__label">Retention (%)</span>
              <input className="ns-input" type="number" min="0" max="20" step="0.5" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>
            <label className="ns-field"><span className="ns-field__label">Proposal sign-off due (optional)</span>
              <input className="ns-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><b>Team</b><span className="sm muted">Both are granted membership; add field techs under People</span></div>
          <div className="card__body form">
            <label className="ns-field"><span className="ns-field__label">Project manager</span>
              <select className="ns-input" value={pmId} onChange={(e) => setPmId(e.target.value)}>{pms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="ns-field"><span className="ns-field__label">Lead engineer</span>
              <select className="ns-input" value={leId} onChange={(e) => setLeId(e.target.value)}>{les.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          </div>
          <div className="card__foot row row--wrap" style={{ justifyContent: "flex-end" }}>
            <Link to="/" className="ns-btn ns-btn--ghost">Cancel</Link>
            <button className="ns-btn ns-btn--primary" type="submit">Create project</button>
          </div>
        </div>
      </form>}
    </>
  );
}
