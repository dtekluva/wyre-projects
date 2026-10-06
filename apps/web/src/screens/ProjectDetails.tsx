import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CONTRACT_STATUS_LABEL, PROJECT_TYPE_LABEL, VAT_TREATMENT_LABEL, fmtDate, naira, relative, type Project, type ProjectType } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Note } from "../components/ui";
import { CommercialsModal } from "../components/CommercialsModal";

const TYPES = Object.keys(PROJECT_TYPE_LABEL) as ProjectType[];

/**
 * What was entered when the project was opened — and, for Director / Tech Lead / Finance, the place to change it.
 * Commercials have their own modal (linked here), the schedule lives on the Overview, roles under People.
 */
export function ProjectDetails() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const can = api.can(user.id, "project.update", p.id);
  const [editing, setEditing] = useState(false); const [com, setCom] = useState(false);
  const leads = api.getUsers().filter((u) => u.roles.includes("techlead"));
  const [f, setF] = useState({ name: p.name, clientName: p.clientName, branchName: p.branchName, location: p.location, projectType: p.projectType, kwp: p.systemCapacityKwp ? String(p.systemCapacityKwp) : "", pmId: p.pmId, leadEngineerId: p.leadEngineerId });
  const start = () => { setF({ name: p.name, clientName: p.clientName, branchName: p.branchName, location: p.location, projectType: p.projectType, kwp: p.systemCapacityKwp ? String(p.systemCapacityKwp) : "", pmId: p.pmId, leadEngineerId: p.leadEngineerId }); setEditing(true); };
  const save = () => { if (safe(() => api.updateProjectDetails(user.id, p.id, { name: f.name, clientName: f.clientName, branchName: f.branchName, location: f.location, projectType: f.projectType, systemCapacityKwp: f.kwp.trim() ? Number(f.kwp) : null, pmId: f.pmId, leadEngineerId: f.leadEngineerId }), "Project details updated")) setEditing(false); };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const row = (label: string, value: React.ReactNode) => <><span>{label}</span><b>{value}</b></>;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="viewbar">
        <div className="sm muted grow">Opened by <b>{api.userName(p.createdBy)}</b> {relative(p.createdAt)} · last change by <b>{api.userName(p.updatedBy)}</b> {relative(p.updatedAt)} · every change is in the chronology</div>
        {can && !editing && <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={start}>Edit details</button>}
        {editing && <><button className="ns-btn ns-btn--primary ns-btn--sm" onClick={save}>Save</button><button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setEditing(false)}>Cancel</button></>}
      </div>
      {!can && <Note tone="info">Director, Tech Lead or Finance can edit these. You can read them.</Note>}

      <div className="card">
        <div className="card__head"><div className="card__title">Client & site</div></div>
        {editing ? <div className="card__body form">
          <label className="ns-field" style={{ gridColumn: "1 / -1" }}><span className="ns-field__label">Project name</span><input className="ns-input" value={f.name} onChange={set("name")} /></label>
          <label className="ns-field"><span className="ns-field__label">Client</span><input className="ns-input" value={f.clientName} onChange={set("clientName")} /></label>
          <label className="ns-field"><span className="ns-field__label">Branch / site</span><input className="ns-input" value={f.branchName} onChange={set("branchName")} /></label>
          <label className="ns-field"><span className="ns-field__label">Location</span><input className="ns-input" value={f.location} onChange={set("location")} /></label>
        </div> : <div className="card__body review__kv">
          {row("Project name", p.name)}{row("Code", <span className="ns-mono">{p.code}</span>)}{row("Client", p.clientName)}{row("Branch / site", p.branchName)}{row("Location", p.location)}
        </div>}
      </div>

      <div className="card">
        <div className="card__head"><div className="card__title">System</div></div>
        {editing ? <div className="card__body form">
          <label className="ns-field"><span className="ns-field__label">Project type</span><select className="ns-input" value={f.projectType} onChange={set("projectType")}>{TYPES.map((t) => <option key={t} value={t}>{PROJECT_TYPE_LABEL[t]}</option>)}</select></label>
          <label className="ns-field"><span className="ns-field__label">System capacity (kWp, optional)</span><input className="ns-input" type="number" min="0" step="0.1" value={f.kwp} onChange={set("kwp")} placeholder="e.g. 40.6" /></label>
        </div> : <div className="card__body review__kv">
          {row("Project type", PROJECT_TYPE_LABEL[p.projectType])}{row("System capacity", p.systemCapacityKwp ? `${p.systemCapacityKwp} kWp` : <span className="muted">not set</span>)}
        </div>}
      </div>

      <div className="card">
        <div className="card__head"><div className="card__title">Team</div><span className="sm muted">Owners are granted membership; manage everyone else under People</span></div>
        {editing ? <div className="card__body form">
          <label className="ns-field"><span className="ns-field__label">Project manager</span><select className="ns-input" value={f.pmId} onChange={set("pmId")}>{leads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="ns-field"><span className="ns-field__label">Lead engineer</span><select className="ns-input" value={f.leadEngineerId} onChange={set("leadEngineerId")}>{leads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div> : <div className="card__body review__kv">
          {row("Project manager", api.userName(p.pmId))}{row("Lead engineer", api.userName(p.leadEngineerId))}
        </div>}
      </div>

      <div className="card">
        <div className="card__head"><div className="card__title">Commercials</div><div className="row" style={{ gap: 8 }}><Badge variant={p.contractStatus === "draft" ? "warning" : "success"}>{p.contractStatus === "draft" ? "Draft" : "Received"}</Badge><button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setCom(true)}>{api.can(user.id, "contract.manage", p.id) ? "View / edit" : "View"}</button></div></div>
        <div className="card__body review__kv">
          {row("Contract value", <>{naira(p.contractValueNet)} <span className="muted">net</span></>)}
          {row("VAT", p.vatTreatment === "exempt" ? "Exempt / zero-rated" : `${p.vatRate}% · ${naira(p.vatAmount)} · ${VAT_TREATMENT_LABEL[p.vatTreatment].split(" — ")[0]}`)}
          {row("Gross", naira(p.contractValue))}
          {row("Contract", p.contractStatus === "received" ? `Received ${fmtDate(p.contractReceivedOn)} by ${api.userName(p.contractReceivedBy ?? "")}` : CONTRACT_STATUS_LABEL.draft)}
          {row("Approved budget", p.approvedBudget ? naira(p.approvedBudget) : <span className="muted">not yet approved</span>)}
          {row("Retention", `${p.retentionPercent}% of net`)}
        </div>
      </div>
      {com && <CommercialsModal p={p} onClose={() => setCom(false)} />}
    </div>
  );
}
