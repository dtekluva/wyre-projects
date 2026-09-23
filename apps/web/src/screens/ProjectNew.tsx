import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DEFAULT_VAT_RATE, PROJECT_TYPE_LABEL, ROLE_LABEL, VAT_TREATMENT_LABEL, naira, netFromGross, vatOn, type ProjectType, type VatTreatment } from "@wyre/api";
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
  // The contract is written NET of VAT. People hold either number, so a toggle lets them type the gross and
  // we back out the net — forcing the arithmetic on them is how a gross figure ended up in a net field before.
  const [contract, setContract] = useState(""); const [haveGross, setHaveGross] = useState(false);
  const [vatRate, setVatRate] = useState(String(DEFAULT_VAT_RATE)); const [treatment, setTreatment] = useState<VatTreatment>("standard");
  const [budget, setBudget] = useState(""); const [received, setReceived] = useState(false);
  const rate = Number(vatRate) || 0; const typed = Number(contract) || 0;
  const net = haveGross ? netFromGross(typed, rate, treatment) : typed;
  const vat = vatOn(net, rate, treatment); const gross = net + vat;
  const [retention, setRetention] = useState(String(api.thresholdNum("retention.percent", 5)));
  const [pmId, setPmId] = useState(user.roles.includes("techlead") ? user.id : pms[0]?.id ?? ""); const [leId, setLeId] = useState(les[0]?.id ?? "");
  const [due, setDue] = useState(""); const [handover, setHandover] = useState("");
  const allowed = api.canCreateProject(user.id);
  const nextCode = api.nextProjectCode();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let id = "";
    const ok = safe(() => {
      const p = api.createProject(user.id, {
        name, clientName: client, branchName: branch, location: loc, projectType: type,
        systemCapacityKwp: kwp.trim() ? Number(kwp) : undefined,
        contractValueNet: net, vatRate: rate, vatTreatment: treatment, contractReceived: received, approvedBudget: Number(budget || 0), retentionPercent: Number(retention),
        pmId, leadEngineerId: leId, proposalDueDate: due || undefined, targetHandoverDate: handover || undefined,
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
            <label className="ns-field"><span className="ns-field__label">Contract value (₦, {haveGross ? "gross — VAT inclusive" : "net of VAT"})</span>
              <input className="ns-input" type="number" min="0" step="1" required value={contract} onChange={(e) => setContract(e.target.value)} placeholder="0" /></label>
            <label className="ns-field"><span className="ns-field__label">VAT rate (%)</span>
              <input className="ns-input" type="number" min="0" max="100" step="0.5" value={vatRate} onChange={(e) => setVatRate(e.target.value)} disabled={treatment === "exempt"} /></label>
            <label className="ns-field"><span className="ns-field__label">VAT treatment</span>
              <select className="ns-input" value={treatment} onChange={(e) => setTreatment(e.target.value as VatTreatment)}>{(Object.keys(VAT_TREATMENT_LABEL) as VatTreatment[]).map((t) => <option key={t} value={t}>{VAT_TREATMENT_LABEL[t]}</option>)}</select></label>
            <div className="ns-field" style={{ gridColumn: "1 / -1" }}>
              <label className="row sm" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={haveGross} onChange={(e) => setHaveGross(e.target.checked)} /> I only have the gross (VAT-inclusive) figure — work out the net for me</label>
              <div className="note note--info sm" style={{ marginTop: 6 }}>
                {treatment === "exempt" ? <>Net <b className="ns-mono">{naira(net)}</b> · no VAT (exempt / zero-rated)</>
                  : <>Net <b className="ns-mono">{naira(net)}</b> + VAT {rate}% <b className="ns-mono">{naira(vat)}</b> = gross <b className="ns-mono">{naira(gross)}</b>{treatment === "withheld_by_client" && <> · the client withholds the VAT and remits it to FIRS</>}</>}
              </div>
            </div>
            <label className="ns-field"><span className="ns-field__label">Approved cost budget (₦, net)</span>
              <input className="ns-input" type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 until approved" /></label>
            <label className="ns-field"><span className="ns-field__label">Retention (%)</span>
              <input className="ns-input" type="number" min="0" max="20" step="0.5" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>
            <label className="ns-field"><span className="ns-field__label">Proposal sign-off due (optional)</span>
              <input className="ns-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="ns-field"><span className="ns-field__label">Target handover (optional) <span className="muted">· the rest of the schedule is set on the Overview</span></span>
              <input className="ns-input" type="date" value={handover} onChange={(e) => setHandover(e.target.value)} min={due || undefined} /></label>
            <div className="ns-field" style={{ gridColumn: "1 / -1" }}>
              <label className="row sm" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} /> The signed contract is already in hand</label>
              <div className="sm muted" style={{ marginTop: 4 }}>{received ? "The project opens with its contract received." : "The project opens as a draft — figures are provisional until Finance or a Director marks the contract received under Money."}</div>
            </div>
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
