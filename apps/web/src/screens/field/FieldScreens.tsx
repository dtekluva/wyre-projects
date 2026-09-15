import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ISSUE_STATUS_LABEL, ROLE_LABEL, VISIT_TYPE_LABEL, fmtDate, naira, relative, type IssueCategory, type IssueSeverity, type VisitType } from "@wyre/api";
import { Thumbs } from "../../components/Thumbs";
import { VisitDetail } from "../../components/VisitDetail";
import { useApi } from "../../lib/useApi";
import { useAuth } from "../../lib/auth";
import { useGeo } from "../../lib/useGeo";
import { outbox } from "../../lib/outbox";
import { useField } from "../../components/field/FieldShell";
import { CameraInput, type Shot } from "../../components/field/CameraInput";
import { dataUrlToBlob } from "../../lib/outbox";
import { SignaturePad } from "../../components/field/SignaturePad";
import { Badge, Empty, RagDot, ReviewBadge, StageChip } from "../../components/ui";

const SEV: IssueSeverity[] = ["critical", "high", "medium", "low"];
const SEVV: Record<IssueSeverity, "danger" | "warning" | "info" | "neutral"> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const CATS: IssueCategory[] = ["electrical", "mechanical", "performance", "data", "safety", "client", "other"];
const Chips = <T extends string,>({ value, options, onChange, label }: { value: T; options: readonly T[] | T[]; onChange: (v: T) => void; label: (v: T) => React.ReactNode }) =>
  <div className="chips">{options.map((o) => <button key={o} type="button" className={`chip chip--lg ${value === o ? "chip--on" : ""}`} onClick={() => onChange(o)}>{label(o)}</button>)}</div>;
/** Every open project. Roles apply company-wide, so a field user can work on any of them; closed projects are
 *  hidden because there is nothing left to log against them. */
const useMine = () => {
  const api = useApi(); const { user } = useAuth();
  return api.projectsFor(user.id, "visit.create").filter((p) => p.stage < 8);
};
/** Projects this user is actually assigned to — used to mark them, and to sort their own sites to the top. */
const useAssigned = () => {
  const api = useApi(); const { user } = useAuth();
  return new Set(api.myProjects(user.id).map((p) => p.id));
};
/** Techs know sites by name, not by code, so lead with the name and keep the code as the secondary line. */
const useProjectLabel = () => {
  const api = useApi();
  return (id: string) => {
    const p = api.projects.find((x) => x.id === id);
    return p ? { name: p.branchName ? `${p.clientName} — ${p.branchName}` : p.name, code: p.code } : { name: id, code: "" };
  };
};
const useVan = () => { const api = useApi(); const { user } = useAuth(); return api.listLocations().find((l) => l.custodianId === user.id) ?? api.listLocations().find((l) => l.type === "vehicle") ?? api.listLocations()[0]; };

export function FieldSignin() {
  const api = useApi(); const { user, switchUser, remote, logout } = useAuth(); const nav = useNavigate();
  if (remote) return <div className="stack"><h1 className="field__title">Signed in</h1><div className="frow"><b>{user.name}</b><span className="sm muted">{user.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span></div>
    <button className="ns-btn ns-btn--secondary ns-btn--block" onClick={logout}>Sign out</button></div>;
  return <div className="stack"><h1 className="field__title">Who's in the field?</h1><p className="muted sm">Demo sign-in — pick a user. Their roles and projects apply.</p>
    {api.getUsers().map((u) => <button key={u.id} className={`frow ${u.id === user.id ? "frow--on" : ""}`} onClick={() => { switchUser(u.id); nav("/field"); }}><b>{u.name}</b><span className="sm muted">{u.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span></button>)}</div>;
}

export function FieldHome() {
  const api = useApi(); const { user } = useAuth(); const { online, queue } = useField(); const mine = useMine(); const assigned = useAssigned();
  const issues = mine.flatMap((p) => api.listIssues({ projectId: p.id, openOnly: true })); const breached = issues.filter((i) => api.issueSla(i).breached).length;
  const checks = user.id ? api.reviewQueue(user.id).length : 0;
  return <div className="stack">
    <div><div className="muted sm">{new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "short" })}</div><h1 className="field__title">Hi {(user.name || "there").split(" ")[0]}</h1></div>
    {!online && <div className="fnote fnote--warn">You're offline — anything you submit is queued ({queue.length}) and syncs automatically.</div>}
    <div className="fgrid">
      <Link to="/field/issues" className="fkpi"><b>{issues.length}</b><span>open issues</span></Link>
      <div className={`fkpi ${breached ? "fkpi--bad" : ""}`}><b>{breached}</b><span>SLA breached</span></div>
      <Link to="/work/reviews" className="fkpi"><b>{checks}</b><span>awaiting my check</span></Link>
      <div className="fkpi"><b>{assigned.size}</b><span>assigned to me</span></div>
    </div>
    <div className="fgrid"><Link to="/field/issues/new" className="ns-btn ns-btn--primary ns-btn--block">＋ New issue</Link><Link to="/field/visits/new" className="ns-btn ns-btn--secondary ns-btn--block">＋ Log a visit</Link></div>
    <h2 className="field__h2">Projects</h2>
    {[...mine].sort((a, b) => Number(assigned.has(b.id)) - Number(assigned.has(a.id))).map((p) => <Link key={p.id} to={`/field/issues?p=${p.id}`} className="frow frow--col">
      <span className="row" style={{ gap: 8 }}><RagDot rag={p.rag} /><b className="grow">{p.name}</b></span>
      <span className="row row--wrap sm muted" style={{ gap: 8 }}><StageChip stage={p.stage} />{p.location}{assigned.has(p.id) && <Badge variant="info">assigned to me</Badge>}</span></Link>)}
  </div>;
}

export function FieldIssues() {
  const api = useApi(); const mine = useMine(); const plabel = useProjectLabel(); const [onlyOpen, setOnlyOpen] = useState(true);
  const list = mine.flatMap((p) => api.listIssues({ projectId: p.id, openOnly: onlyOpen })).sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity));
  return <div className="stack">
    <div className="row" style={{ justifyContent: "space-between" }}><h1 className="field__title">Issues</h1><button className="chip" onClick={() => setOnlyOpen((v) => !v)}>{onlyOpen ? "Open only" : "All"}</button></div>
    {list.length ? list.map((i) => { const sla = api.issueSla(i); return <Link key={i.id} to={`/field/issues/${i.id}`} className="frow frow--col">
      <span className="row" style={{ justifyContent: "space-between" }}><b className="ellipsis">{i.title}</b><Badge variant={SEVV[i.severity]}>{i.severity}</Badge></span>
      <span className="row row--wrap sm muted">{plabel(i.projectId).name} · {ISSUE_STATUS_LABEL[i.status]} · <ReviewBadge status={i.reviewStatus} />{sla.open && (sla.breached ? <Badge variant="danger">SLA −{Math.abs(sla.hoursLeft)} h</Badge> : <span>SLA {sla.hoursLeft} h</span>)}</span></Link>; })
      : <Empty title="No issues" />}
    <Link to="/field/issues/new" className="fab" aria-label="New issue">＋</Link>
  </div>;
}

export function FieldIssueNew() {
  const { user } = useAuth(); const api = useApi(); const mine = useMine(); const plabel = useProjectLabel(); const { submit } = useField(); const nav = useNavigate(); const geo = useGeo();
  const [pid, setPid] = useState(mine[0]?.id ?? ""); const [sev, setSev] = useState<IssueSeverity>("medium"); const [cat, setCat] = useState<IssueCategory>("electrical");
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [asset, setAsset] = useState(""); const [shots, setShots] = useState<Shot[]>([]);
  const assets = pid ? api.listAssets({ projectId: pid, status: "installed" }) : [];
  const go = () => { if (!shots.length) return; const r = submit(`Issue raised — ${title}`, { kind: "raise_issue", actorId: user.id, projectId: pid, photos: shots.map((s) => ({ fileName: s.fileName, caption: `Before — ${title}`, gps: geo.status === "ok" ? { lat: geo.lat!, lng: geo.lng! } : undefined, blob: s.file })), input: { category: cat, severity: sev, title, description: desc, assetId: asset || undefined } }); if (r !== "error") nav("/field/issues"); };
  return <div className="stack">
    <h1 className="field__title">New issue</h1>
    <label className="flabel">Project</label><Chips value={pid} options={mine.map((p) => p.id)} onChange={setPid} label={(id) => <span className="chip__stack"><b>{plabel(id).name}</b><span className="chip__code ns-mono">{plabel(id).code}</span></span>} />
    <label className="flabel">Severity · SLA</label><Chips value={sev} options={SEV} onChange={setSev} label={(s) => `${s} · ${api.slaHours(s)} h`} />
    <label className="flabel">Category</label><Chips value={cat} options={CATS} onChange={setCat} label={(c) => c} />
    <input className="ns-input fld" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
    <textarea className="ns-textarea fld" placeholder="What's wrong?" value={desc} onChange={(e) => setDesc(e.target.value)} />
    {assets.length > 0 && <select className="ns-input fld" value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">Asset (optional)</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.serial} · {a.model}</option>)}</select>}
    <label className="flabel">Before photo</label><CameraInput shots={shots} onChange={setShots} required label="Take photo" />
    <button className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" disabled={!title.trim() || !shots.length || !pid} onClick={go}>Raise issue</button>
  </div>;
}

export function FieldIssueDetail() {
  const { id } = useParams(); const api = useApi(); const { user } = useAuth(); const plabel = useProjectLabel(); const { submit } = useField(); const nav = useNavigate();
  const i = api.issues.find((x) => x.id === id); const [open, setOpen] = useState(false); const [root, setRoot] = useState(""); const [res, setRes] = useState(""); const [cost, setCost] = useState(""); const [shots, setShots] = useState<Shot[]>([]);
  if (!i) return <Empty title="Issue not found" />;
  const sla = api.issueSla(i); const canUpdate = api.can(user.id, "issue.update", i.projectId) && !["closed", "wont_fix", "resolved"].includes(i.status);
  const asset = i.assetId ? api.assets.find((a) => a.id === i.assetId) : undefined;
  return <div className="stack">
    <div className="row" style={{ justifyContent: "space-between" }}><Badge variant={SEVV[i.severity]}>{i.severity}</Badge><ReviewBadge status={i.reviewStatus} /></div>
    <h1 className="field__title">{i.title}</h1>
    <div className="sm muted">{plabel(i.projectId).name} · <span className="ns-mono">{plabel(i.projectId).code}</span> · {i.category} · {ISSUE_STATUS_LABEL[i.status]} · raised by {api.userName(i.raisedBy)} {relative(i.raisedAt)}</div>
    {sla.open && <div className={`fnote ${sla.breached ? "fnote--bad" : ""}`}>{sla.breached ? `SLA breached by ${Math.abs(sla.hoursLeft)} h` : `${sla.hoursLeft} h left on SLA`} · due {fmtDate(i.slaDueAt)}</div>}
    <p>{i.description}</p>
    {asset && <div className="sm">Asset: <b className="ns-mono">{asset.serial}</b> · {asset.model} · warranty to {fmtDate(asset.warrantyEnd)}</div>}
    <div className="sm muted">{i.assigneeId ? `Assigned to ${api.userName(i.assigneeId)}` : "Unassigned"}</div>
    <div className="row row--wrap" style={{ gap: 10 }}><span className="sm muted">Before</span><Thumbs ids={i.beforeAttachmentIds} empty="none" />
      {i.afterAttachmentIds.length > 0 && <><span className="sm muted">After</span><Thumbs ids={i.afterAttachmentIds} /></>}</div>
    {i.resolution && <div className="fnote"><b>Resolution:</b> {i.resolution}{i.rootCause ? ` · root cause: ${i.rootCause}` : ""}{i.costToResolve ? ` · ${naira(i.costToResolve)}` : ""}</div>}
    {i.checkComment && <div className="fnote fnote--warn">Checker: “{i.checkComment}”</div>}
    {canUpdate && !open && <div className="fgrid">
      {i.status === "open" && <button className="ns-btn ns-btn--secondary ns-btn--block" onClick={() => submit("Started", { kind: "set_issue_status", actorId: user.id, issueId: i.id, status: "in_progress" })}>Start work</button>}
      {i.status === "in_progress" && <button className="ns-btn ns-btn--secondary ns-btn--block" onClick={() => submit("Awaiting parts", { kind: "set_issue_status", actorId: user.id, issueId: i.id, status: "awaiting_parts" })}>Awaiting parts</button>}
      <button className="ns-btn ns-btn--primary ns-btn--block" onClick={() => setOpen(true)}>Resolve…</button></div>}
    {open && <div className="stack">
      <input className="ns-input fld" placeholder="Root cause" value={root} onChange={(e) => setRoot(e.target.value)} /><textarea className="ns-textarea fld" placeholder="What you did to fix it" value={res} onChange={(e) => setRes(e.target.value)} />
      <input className="ns-input fld" type="number" placeholder="Extra cost ₦ (optional)" value={cost} onChange={(e) => setCost(e.target.value)} />
      <label className="flabel">After photo</label><CameraInput shots={shots} onChange={setShots} required label="Take after photo" />
      <button className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" disabled={!res.trim() || !shots.length} onClick={() => { const r = submit(`Resolution submitted — ${i.title}`, { kind: "resolve_issue", actorId: user.id, issueId: i.id, projectId: i.projectId, photos: shots.map((s) => ({ fileName: s.fileName, caption: `After — ${i.title}`, blob: s.file })), input: { rootCause: root, resolution: res, costToResolve: Number(cost) || 0 } }); if (r !== "error") nav("/field/issues"); }}>Submit for check</button>
      <button className="ns-btn ns-btn--ghost ns-btn--block" onClick={() => setOpen(false)}>Cancel</button></div>}
  </div>;
}

export function FieldVisits() {
  const api = useApi(); const mine = useMine(); const plabel = useProjectLabel();
  const [open, setOpen] = useState<string | null>(null);
  const list = mine.flatMap((p) => api.listVisits(p.id)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return <div className="stack"><h1 className="field__title">Visits</h1>
    {list.length ? list.map((v) => <button key={v.id} className="frow frow--col" onClick={() => setOpen(v.id)}>
      <span className="row" style={{ justifyContent: "space-between", width: "100%" }}><b>{VISIT_TYPE_LABEL[v.visitType]}</b><ReviewBadge status={v.reviewStatus} /></span>
      <span className="sm muted">{plabel(v.projectId).name} · {fmtDate(v.startedAt)} · {v.durationHrs} h · {naira(v.costTotal, true)}{v.clientSignoff ? " · signed" : ""}</span>
      <span className="sm">{v.findings}</span><Thumbs ids={v.attachmentIds} empty="no photos" /></button>) : <Empty title="No visits yet" />}
    {open && (() => { const v = list.find((x) => x.id === open); return v ? <VisitDetail visit={v} onClose={() => setOpen(null)} /> : null; })()}
    <Link to="/field/visits/new" className="fab" aria-label="Log a visit">＋</Link></div>;
}

export function FieldVisitNew() {
  const api = useApi(); const { user } = useAuth(); const mine = useMine(); const plabel = useProjectLabel(); const van = useVan(); const { submit, online } = useField(); const nav = useNavigate(); const geo = useGeo();
  const [started] = useState(() => new Date().toISOString());
  const [pid, setPid] = useState(mine[0]?.id ?? ""); const [type, setType] = useState<VisitType>("routine"); const [find, setFind] = useState(""); const [act, setAct] = useState("");
  const [parts, setParts] = useState<Record<string, number>>({}); const [travel, setTravel] = useState(""); const [labour, setLabour] = useState(""); const [shots, setShots] = useState<Shot[]>([]);
  const [signName, setSignName] = useState(""); const [rating, setRating] = useState(0); const [sig, setSig] = useState<string | null>(null);
  const vanItems = useMemo(() => api.items.filter((it) => !it.isSerialised && api.available(it.id, van.id) > 0), [api, van.id]);
  const partsCost = Object.entries(parts).reduce((s, [id, q]) => s + q * api.wacOf(id), 0);
  const go = () => {
    const r = submit(`Visit logged — ${VISIT_TYPE_LABEL[type]}`, { kind: "log_visit", actorId: user.id, projectId: pid,
      photos: shots.map((s) => ({ fileName: s.fileName, caption: s.caption?.trim() || `${VISIT_TYPE_LABEL[type]} — site photo`, gps: geo.status === "ok" ? { lat: geo.lat!, lng: geo.lng! } : undefined, blob: s.file })),
      signature: sig && signName.trim() ? { name: signName.trim(), rating: rating || undefined, fileName: `signature-${Date.now()}.png`, blob: dataUrlToBlob(sig) } : undefined,
      input: { visitType: type, startedAt: started, endedAt: new Date().toISOString(), findings: find, actionsTaken: act, costTravel: Number(travel) || 0, costLabour: Number(labour) || 0, locationId: van.id,
        parts: Object.entries(parts).filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty })), gps: geo.status === "ok" ? { lat: geo.lat!, lng: geo.lng! } : undefined, offlineCapturedAt: online ? undefined : new Date().toISOString() } });
    if (r !== "error") nav("/field/visits");
  };
  return <div className="stack">
    <div className="row" style={{ justifyContent: "space-between" }}><span className="sm muted">Started {new Date(started).toLocaleTimeString()}</span><span className="sm muted">📍 {geo.status === "ok" ? `${geo.lat!.toFixed(4)}, ${geo.lng!.toFixed(4)}` : geo.status === "locating" ? "locating…" : "no GPS"}</span></div>
    <h1 className="field__title">Log a visit</h1>
    <label className="flabel">Project</label><Chips value={pid} options={mine.map((p) => p.id)} onChange={setPid} label={(id) => <span className="chip__stack"><b>{plabel(id).name}</b><span className="chip__code ns-mono">{plabel(id).code}</span></span>} />
    <label className="flabel">Visit type</label><Chips value={type} options={Object.keys(VISIT_TYPE_LABEL) as VisitType[]} onChange={setType} label={(t) => VISIT_TYPE_LABEL[t]} />
    <textarea className="ns-textarea fld" placeholder="What you found" value={find} onChange={(e) => setFind(e.target.value)} /><textarea className="ns-textarea fld" placeholder="What you did" value={act} onChange={(e) => setAct(e.target.value)} />
    <label className="flabel">Parts used from {van.name}</label>
    {vanItems.length ? vanItems.map((it) => { const q = parts[it.id] ?? 0; const av = api.available(it.id, van.id); return <div key={it.id} className="stepper"><span className="grow"><b>{it.name}</b><span className="sm muted"> · {av} {it.unit} on van · {naira(api.wacOf(it.id))}</span></span>
      <button type="button" onClick={() => setParts({ ...parts, [it.id]: Math.max(0, q - 1) })}>−</button><span className="ns-mono">{q}</span><button type="button" onClick={() => setParts({ ...parts, [it.id]: Math.min(av, q + 1) })}>+</button></div>; }) : <div className="sm muted">Nothing on the van.</div>}
    {partsCost > 0 && <div className="sm muted">Parts at WAC: <b className="ns-mono">{naira(partsCost)}</b> — checked together with this visit</div>}
    <div className="fgrid"><input className="ns-input fld" type="number" placeholder="Travel ₦" value={travel} onChange={(e) => setTravel(e.target.value)} /><input className="ns-input fld" type="number" placeholder="Labour ₦" value={labour} onChange={(e) => setLabour(e.target.value)} /></div>
    <label className="flabel">Site photos</label><CameraInput shots={shots} onChange={setShots} required captions label="Take photo" />
    <label className="flabel">Client sign-off</label>
    <input className="ns-input fld" placeholder="Client name" value={signName} onChange={(e) => setSignName(e.target.value)} />
    <div className="chips">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`chip chip--lg ${rating >= n ? "chip--on" : ""}`} onClick={() => setRating(n)}>★</button>)}</div>
    <SignaturePad onChange={setSig} />
    <button className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" disabled={!pid || !find.trim() || !shots.length} onClick={go}>Submit visit for check</button>
  </div>;
}

export function FieldVan() {
  const api = useApi(); const van = useVan(); const bal = api.balances().filter((b) => b.locationId === van.id && b.qtyOnHand > 0);
  return <div className="stack"><h1 className="field__title">{van.name}</h1><div className="sm muted">Custodian {api.userName(van.custodianId)} · value {naira(bal.reduce((s, b) => s + b.value, 0), true)}</div>
    {bal.length ? bal.map((b) => { const it = api.item(b.itemId); return <div key={b.itemId} className="frow"><span><b>{it.name}</b><div className="sm muted">{it.sku}{it.isSerialised ? " · serialised" : ""}</div></span><span className="ns-mono">{b.qtyOnHand} {it.unit}<div className="sm muted">{naira(b.value, true)}</div></span></div>; }) : <Empty title="Van is empty" />}</div>;
}

export function FieldQueue() {
  const { queue, flush, online } = useField();
  return <div className="stack"><h1 className="field__title">Sync queue</h1><div className="sm muted">Submissions made offline replay in order when you're back online.</div>
    {queue.length ? queue.map((q) => <div key={q.id} className="frow frow--col"><span className="row" style={{ justifyContent: "space-between" }}><b>{q.label}</b><Badge variant={q.status === "failed" ? "danger" : "warning"}>{q.status}</Badge></span><span className="sm muted">{relative(q.createdAt)}{q.error ? ` · ${q.error}` : ""}</span>
      {q.status === "failed" && <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => outbox.remove(q.id)}>Discard</button>}</div>) : <Empty title="Queue is empty" />}
    <button className="ns-btn ns-btn--primary ns-btn--block" disabled={!online || !queue.length} onClick={() => flush()}>Sync now</button></div>;
}
