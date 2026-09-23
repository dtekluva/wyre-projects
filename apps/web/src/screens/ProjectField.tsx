import { useState } from "react";
import { FilePick, type Pick } from "../components/FilePick";
import { useOutletContext } from "react-router-dom";
import { COMMISSIONING_TEMPLATE, HSE_TYPE_LABEL, ROLE_LABEL, VISIT_TYPE_LABEL, fmtDate, naira, relative,
  type HseType, type Issue, type IssueCategory, type IssueSeverity, type IssueStatus, type Project, type VisitType, type WarrantyStatus } from "@wyre/api";
import { Thumbs } from "../components/Thumbs";
import { VisitDetail } from "../components/VisitDetail";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Avatar, Badge, Empty, Note, ReviewBadge } from "../components/ui";
import { IssueDetail } from "../components/IssueDetail";

const SEV: Record<IssueSeverity, "danger" | "warning" | "info" | "neutral"> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const CATS: IssueCategory[] = ["electrical", "mechanical", "performance", "data", "safety", "client", "other"];
const COLS: { key: string; label: string; statuses: IssueStatus[] }[] = [
  { key: "open", label: "Open", statuses: ["open"] }, { key: "wip", label: "In progress", statuses: ["in_progress"] }, { key: "parts", label: "Awaiting parts", statuses: ["awaiting_parts"] },
  { key: "resolved", label: "Resolved · pending check", statuses: ["resolved"] }, { key: "closed", label: "Closed", statuses: ["closed", "wont_fix"] },
];

/** Board card: a summary. Everything else — files at any stage, actions, checking — lives in the detail it opens. */
function IssueCard({ i, onOpen }: { i: Issue; onOpen: () => void }) {
  const api = useApi(); const sla = api.issueSla(i);
  const extra = i.attachmentIds.length;
  return <div className={`issue issue--btn ${i.voidedAt ? "voided" : ""}`} role="button" tabIndex={0} title="Open issue" onClick={onOpen}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
    <div className="row" style={{ justifyContent: "space-between" }}><b className="ellipsis">{i.title}</b><Badge variant={SEV[i.severity]}>{i.severity}</Badge></div>
    <div className="row row--wrap sm muted">{i.category}{i.isSnag && <Badge variant="info">snag</Badge>}<ReviewBadge status={i.reviewStatus} />{sla.open && (sla.breached ? <Badge variant="danger">SLA −{Math.abs(sla.hoursLeft)} h</Badge> : <span>SLA {sla.hoursLeft} h</span>)}</div>
    <div className="sm muted">{api.userName(i.raisedBy)} · {relative(i.raisedAt)}{i.assigneeId ? ` · → ${api.userName(i.assigneeId)}` : ""}</div>
    <div className="row row--wrap" style={{ marginTop: 6, gap: 10 }} onClick={(e) => e.stopPropagation()}>
      <span className="sm muted">Before</span><Thumbs ids={i.beforeAttachmentIds} empty="none" max={3} />
      {extra > 0 && <><span className="sm muted">+{extra} file{extra > 1 ? "s" : ""}</span><Thumbs ids={i.attachmentIds} max={3} /></>}
      {i.afterAttachmentIds.length > 0 && <><span className="sm muted">After</span><Thumbs ids={i.afterAttachmentIds} max={3} /></>}
    </div>
    {i.resolution && <div className="sm"><b>Fix:</b> {i.resolution}{i.costToResolve ? ` · ${naira(i.costToResolve)}` : ""}</div>}
    {i.checkComment && <div className="sm muted">Checker: “{i.checkComment}”</div>}
  </div>;
}

export function ProjectField() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const issues = api.listIssues({ projectId: p.id }); const visits = api.listVisits(p.id); const coms = api.listCommissioning(p.id); const hse = api.listHse(p.id); const wars = api.listWarranty(p.id);
  const [tab, setTab] = useState<"issues" | "visits" | "commissioning" | "hse" | "warranty">("issues");
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  // forms
  const [iCat, setICat] = useState<IssueCategory>("electrical"); const [iSev, setISev] = useState<IssueSeverity>("medium"); const [iTitle, setITitle] = useState(""); const [iDesc, setIDesc] = useState(""); const [iPhoto, setIPhoto] = useState<Pick[]>([]); const [iAsset, setIAsset] = useState("");
  const [openVisit, setOpenVisit] = useState<string | null>(null);
  const [vType, setVType] = useState<VisitType>("routine"); const [vFind, setVFind] = useState(""); const [vAct, setVAct] = useState(""); const [vTravel, setVTravel] = useState(""); const [vLabour, setVLabour] = useState(""); const [vPhoto, setVPhoto] = useState<Pick[]>([]); const [vHrs, setVHrs] = useState("2"); const [vItem, setVItem] = useState(""); const [vQty, setVQty] = useState("1"); const [vLoc, setVLoc] = useState(api.mainLocationId() ?? "");
  const [cRes, setCRes] = useState<"pass" | "conditional" | "fail">("pass"); const [cItems, setCItems] = useState<Record<string, { pass: boolean; v: string }>>(() => Object.fromEntries(COMMISSIONING_TEMPLATE.map((t) => [t.key, { pass: true, v: "" }])));
  const [cMeter, setCMeter] = useState({ serialAscii: true, ctRatioVerified: true, firstLiveReading: true, historicalOk: true }); const [cWitness, setCWitness] = useState(""); const [cNotes, setCNotes] = useState(""); const [cPhoto, setCPhoto] = useState<Pick[]>([]);
  const [hType, setHType] = useState<HseType>("near_miss"); const [hSev, setHSev] = useState<IssueSeverity>("low"); const [hDesc, setHDesc] = useState(""); const [hAct, setHAct] = useState("");
  const [wAsset, setWAsset] = useState(""); const [wNotes, setWNotes] = useState("");
  const installed = api.listAssets({ projectId: p.id, status: "installed" });
  const pendingVisitParts = (id: string) => api.listMovements({ projectId: p.id }).filter((m) => m.sourceRef?.id === id);
  const tabs = [["issues", `Issues (${issues.filter((i) => !["closed", "wont_fix"].includes(i.status)).length})`], ["visits", `Visits (${visits.length})`], ["commissioning", `Commissioning (${coms.length})`], ["hse", `HSE (${hse.length})`], ["warranty", `Warranty (${wars.length})`]] as const;
  return <div className="stack" style={{ gap: 16 }}>
    <div className="row row--wrap">{tabs.map(([k, l]) => <button key={k} className={`chip ${tab === k ? "chip--on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>

    {openIssue && (() => { const i = issues.find((x) => x.id === openIssue); return i ? <IssueDetail issue={i} onClose={() => setOpenIssue(null)} /> : null; })()}
    {tab === "issues" && <>
      <div className="board">{COLS.map((c) => { const list = issues.filter((i) => c.statuses.includes(i.status)); return <div key={c.key} className="board__col"><div className="board__head">{c.label} <span className="muted">{list.length}</span></div>{list.map((i) => <IssueCard key={i.id} i={i} onOpen={() => setOpenIssue(i.id)} />)}{!list.length && <div className="sm muted">—</div>}</div>; })}</div>
      {api.can(user.id, "issue.create", p.id) && <div className="card"><div className="card__head"><div className="card__title">Raise an issue</div><span className="sm muted">before photo required · report is maker-checked</span></div>
        <div className="card__body form">
          <select className="ns-input" value={iSev} onChange={(e) => setISev(e.target.value as IssueSeverity)}>{(["critical", "high", "medium", "low"] as IssueSeverity[]).map((s) => <option key={s} value={s}>{s} · SLA {api.slaHours(s)} h</option>)}</select>
          <select className="ns-input" value={iCat} onChange={(e) => setICat(e.target.value as IssueCategory)}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input className="ns-input" placeholder="Title" value={iTitle} onChange={(e) => setITitle(e.target.value)} /><input className="ns-input" placeholder="Description" value={iDesc} onChange={(e) => setIDesc(e.target.value)} />
          <select className="ns-input" value={iAsset} onChange={(e) => setIAsset(e.target.value)}><option value="">— no asset —</option>{installed.map((a) => <option key={a.id} value={a.id}>{a.serial} · {a.model}</option>)}</select>
          <FilePick picks={iPhoto} onChange={setIPhoto} required label="Before photo" />
          <button className="ns-btn ns-btn--primary" disabled={!iPhoto.length || !iTitle.trim()} onClick={() => { if (safe(() => { const f = iPhoto[0]; const a = api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, caption: `Before — ${iTitle}` }); api.raiseIssue(user.id, p.id, { category: iCat, severity: iSev, title: iTitle, description: iDesc, assetId: iAsset || undefined, beforeAttachmentIds: [a.id] }); }, "Issue raised — pending check")) { setITitle(""); setIDesc(""); setIPhoto([]); } }}>Raise</button>
        </div></div>}
    </>}

    {tab === "visits" && <>
      {visits.length ? visits.map((v) => <div key={v.id} className={`card ${v.voidedAt ? "voided" : ""}`}><div className="card__head"><button className="card__title link" onClick={() => setOpenVisit(v.id)} title="Open visit">{VISIT_TYPE_LABEL[v.visitType]} · {fmtDate(v.startedAt)} · {v.durationHrs} h</button><ReviewBadge status={v.reviewStatus} /></div>
        <div className="card__body stack" style={{ gap: 6 }}>
          <div className="sm muted">{v.technicianIds.map((t) => api.userName(t)).join(", ")}{v.gps ? ` · 📍 ${v.gps.lat.toFixed(3)}, ${v.gps.lng.toFixed(3)}` : ""}{v.clientSignoff ? ` · signed: ${v.clientSignoff.name}${v.clientSignoff.rating ? " " + "★".repeat(v.clientSignoff.rating) : ""}` : ""}</div>
          <div className="row row--wrap" style={{ marginTop: 6, gap: 10 }}><Thumbs ids={v.attachmentIds} empty="no photos" />
            {v.clientSignoff?.signatureAttachmentId && <Thumbs ids={[v.clientSignoff.signatureAttachmentId]} />}</div>
          <div><b>Findings:</b> {v.findings}</div>{v.actionsTaken && <div><b>Actions:</b> {v.actionsTaken}</div>}
          <div className="row row--wrap sm"><Badge variant="neutral">travel {naira(v.costTravel, true)}</Badge><Badge variant="neutral">labour {naira(v.costLabour, true)}</Badge><Badge variant="neutral">parts {naira(v.costParts, true)}</Badge><b className="ns-mono">{naira(v.costTotal)}</b></div>
          {v.parts.length > 0 && <div className="sm muted">Parts: {v.parts.map((pt) => `${api.itemName(pt.itemId)} × ${pt.qty}`).join(" · ")} — {pendingVisitParts(v.id).every((m) => m.reviewStatus === "checked") ? "posted" : "posts on check"}</div>}
          {v.checkComment && <div className="sm muted">Checker: “{v.checkComment}”</div>}
          <div><button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setOpenVisit(v.id)}>Open visit</button></div>
        </div></div>) : <Empty title="No visits logged" />}
      {openVisit && (() => { const v = visits.find((x) => x.id === openVisit); return v ? <VisitDetail visit={v} onClose={() => setOpenVisit(null)} /> : null; })()}
      {api.can(user.id, "visit.create", p.id) && <div className="card"><div className="card__head"><div className="card__title">Log a visit</div><span className="sm muted">at least one photo · label each · PM / lead engineer checks</span></div>
        <div className="card__body form">
          <select className="ns-input" value={vType} onChange={(e) => setVType(e.target.value as VisitType)}>{(Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map((t) => <option key={t} value={t}>{VISIT_TYPE_LABEL[t]}</option>)}</select>
          <input className="ns-input" type="number" step="0.5" placeholder="Hours" value={vHrs} onChange={(e) => setVHrs(e.target.value)} />
          <input className="ns-input" placeholder="Findings" value={vFind} onChange={(e) => setVFind(e.target.value)} /><input className="ns-input" placeholder="Actions taken" value={vAct} onChange={(e) => setVAct(e.target.value)} />
          <input className="ns-input" type="number" placeholder="Travel ₦" value={vTravel} onChange={(e) => setVTravel(e.target.value)} /><input className="ns-input" type="number" placeholder="Labour ₦" value={vLabour} onChange={(e) => setVLabour(e.target.value)} />
          <select className="ns-input" value={vLoc} onChange={(e) => setVLoc(e.target.value)}>{api.listLocations().map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select className="ns-input" value={vItem} onChange={(e) => setVItem(e.target.value)}><option value="">— no parts —</option>{api.items.filter((it) => !it.isSerialised && api.available(it.id, vLoc) > 0).map((it) => <option key={it.id} value={it.id}>{it.name} · {api.available(it.id, vLoc)} free</option>)}</select>
          <input className="ns-input" type="number" min={1} placeholder="Qty" value={vQty} onChange={(e) => setVQty(e.target.value)} />
          <FilePick picks={vPhoto} onChange={setVPhoto} required multiple captions label="Add site photos" captionPlaceholder="Label, e.g. inverter display before" />
          <button className="ns-btn ns-btn--primary" disabled={!vPhoto.length} onClick={() => { if (safe(() => { const ids = vPhoto.map((f) => api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, caption: f.caption?.trim() || `${VISIT_TYPE_LABEL[vType]} — site photo` }).id); const end = new Date(); const start = new Date(end.getTime() - (Number(vHrs) || 1) * 3600000);
            api.logVisit(user.id, p.id, { visitType: vType, startedAt: start.toISOString(), endedAt: end.toISOString(), findings: vFind, actionsTaken: vAct, costTravel: Number(vTravel) || 0, costLabour: Number(vLabour) || 0, locationId: vLoc, parts: vItem ? [{ itemId: vItem, qty: Number(vQty) || 1 }] : [], attachmentIds: ids }); }, "Visit logged — pending check")) { setVFind(""); setVAct(""); setVTravel(""); setVLabour(""); setVPhoto([]); setVItem(""); } }}>Log visit</button>
        </div></div>}
    </>}

    {tab === "commissioning" && <>
      <CommissioningAssignment p={p} assignee={assignee} setAssignee={setAssignee} />
      {coms.length ? coms.map((c) => <div key={c.id} className="card"><div className="card__head"><div className="card__title">Commissioning {fmtDate(c.date)} · <span style={{ textTransform: "uppercase" }}>{c.result}</span></div><div className="row"><Badge variant={Object.values(c.meter).every(Boolean) ? "success" : "danger"}>meter integrity {Object.values(c.meter).every(Boolean) ? "pass" : "fail"}</Badge><ReviewBadge status={c.reviewStatus} /></div></div>
        <div className="card__body stack" style={{ gap: 6 }}><div className="sm muted">Engineer {api.userName(c.engineerId)}{c.clientWitness ? ` · witness ${c.clientWitness.name}` : ""}</div>
        <div className="row row--wrap" style={{ gap: 10 }}><Thumbs ids={c.attachmentIds} empty="no photos" />{c.clientWitness?.signatureAttachmentId && <Thumbs ids={[c.clientWitness.signatureAttachmentId]} />}</div>{c.notes && <div>{c.notes}</div>}
          <div className="row row--wrap">{c.items.map((it) => <Badge key={it.key} variant={it.pass ? "success" : "danger"}>{it.label}{it.measuredValue ? `: ${it.measuredValue}${it.unit ? " " + it.unit : ""}` : ""}</Badge>)}</div>
          <div className="sm muted">Meter checks — ASCII serial {c.meter.serialAscii ? "✓" : "✗"} · CT ratio {c.meter.ctRatioVerified ? "✓" : "✗"} · first live reading {c.meter.firstLiveReading ? "✓" : "✗"} · historical packets {c.meter.historicalOk ? "✓" : "✗"}</div></div></div>)
        : <Empty title="No commissioning record" hint="A checked record with result pass generates the gate-5 evidence documents." />}
      {api.can(user.id, "commissioning.create", p.id) && <div className="card"><div className="card__head"><div className="card__title">New commissioning record</div><span className="sm muted">A tech lead or director checks it — never its author</span></div>
        <div className="card__body stack">
          <div className="form"><select className="ns-input" value={cRes} onChange={(e) => setCRes(e.target.value as typeof cRes)}><option value="pass">pass</option><option value="conditional">conditional</option><option value="fail">fail</option></select>
            <input className="ns-input" placeholder="Client witness name" value={cWitness} onChange={(e) => setCWitness(e.target.value)} /><FilePick picks={cPhoto} onChange={setCPhoto} required label="Commissioning photo" /><input className="ns-input" placeholder="Notes" value={cNotes} onChange={(e) => setCNotes(e.target.value)} /></div>
          <div className="table--wrap"><table className="table ledger"><thead><tr><th>Checklist item</th><th>Measured</th><th>Pass</th></tr></thead><tbody>{COMMISSIONING_TEMPLATE.map((t) => <tr key={t.key}><td>{t.label}</td><td><input className="ns-input" style={{ minHeight: 30 }} placeholder={t.unit ?? ""} value={cItems[t.key].v} onChange={(e) => setCItems({ ...cItems, [t.key]: { ...cItems[t.key], v: e.target.value } })} /></td><td><input type="checkbox" className="checkbox" checked={cItems[t.key].pass} onChange={(e) => setCItems({ ...cItems, [t.key]: { ...cItems[t.key], pass: e.target.checked } })} /></td></tr>)}</tbody></table></div>
          <div className="row row--wrap sm">{(Object.keys(cMeter) as (keyof typeof cMeter)[]).map((k) => <label key={k} className="row"><input type="checkbox" className="checkbox" checked={cMeter[k]} onChange={(e) => setCMeter({ ...cMeter, [k]: e.target.checked })} />{k}</label>)}</div>
          <div><button className="ns-btn ns-btn--primary" disabled={!cPhoto.length} onClick={() => safe(() => { const f = cPhoto[0]; const a = api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, caption: "Commissioning photo" }); const sig = cWitness.trim() ? api.addAttachment(user.id, p.id, { fileName: "witness-signature.png", caption: `Witness — ${cWitness.trim()}` }) : undefined;
            api.createCommissioning(user.id, p.id, { date: new Date().toISOString().slice(0, 10), result: cRes, notes: cNotes, items: COMMISSIONING_TEMPLATE.map((t) => ({ key: t.key, pass: cItems[t.key].pass, measuredValue: cItems[t.key].v || undefined })), meter: cMeter, clientWitness: cWitness.trim() ? { name: cWitness.trim(), signatureAttachmentId: sig?.id } : undefined, attachmentIds: [a.id] }); }, "Commissioning record submitted — pending check")}>Submit record</button></div>
        </div></div>}
    </>}

    {tab === "hse" && <>
      {hse.length ? hse.map((h) => <div key={h.id} className="card"><div className="card__head"><div className="card__title">{HSE_TYPE_LABEL[h.type]} · {fmtDate(h.occurredAt)}</div><div className="row"><Badge variant={SEV[h.severity]}>{h.severity}</Badge><ReviewBadge status={h.reviewStatus} /></div></div>
        <div className="card__body stack" style={{ gap: 4 }}><div>{h.description}</div><div className="sm"><b>Actions:</b> {h.actions}</div><div className="sm muted">Reported by {api.userName(h.reportedBy)}</div><Thumbs ids={h.attachmentIds} empty="no photos" /></div></div>) : <Empty title="No HSE incidents" />}
      {api.can(user.id, "hse.create", p.id) && <div className="card"><div className="card__head"><div className="card__title">Report an HSE incident</div></div><div className="card__body form">
        <select className="ns-input" value={hType} onChange={(e) => setHType(e.target.value as HseType)}>{(Object.keys(HSE_TYPE_LABEL) as HseType[]).map((t) => <option key={t} value={t}>{HSE_TYPE_LABEL[t]}</option>)}</select>
        <select className="ns-input" value={hSev} onChange={(e) => setHSev(e.target.value as IssueSeverity)}>{(["critical", "high", "medium", "low"] as IssueSeverity[]).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <input className="ns-input" placeholder="What happened" value={hDesc} onChange={(e) => setHDesc(e.target.value)} /><input className="ns-input" placeholder="Actions taken" value={hAct} onChange={(e) => setHAct(e.target.value)} />
        <button className="ns-btn ns-btn--primary" onClick={() => { if (safe(() => { api.reportHse(user.id, p.id, { type: hType, severity: hSev, description: hDesc, actions: hAct, occurredAt: new Date().toISOString() }); }, "HSE incident reported — pending check")) { setHDesc(""); setHAct(""); } }}>Report</button></div></div>}
    </>}

    {tab === "warranty" && <>
      {wars.length ? wars.map((w) => { const a = api.assets.find((x) => x.id === w.assetId); return <div key={w.id} className="card"><div className="card__head"><div className="card__title">{a?.make} {a?.model} · <span className="ns-mono">{a?.serial}</span></div><div className="row"><Badge variant={w.status === "accepted" || w.status === "refunded" || w.status === "replaced" ? "success" : w.status === "rejected" ? "danger" : "warning"}>{w.status}</Badge><ReviewBadge status={w.reviewStatus} /></div></div>
        <div className="card__body stack" style={{ gap: 4 }}><div className="sm muted">{api.vendorName(w.vendorId)} · claimed {fmtDate(w.claimedAt)} · warranty to {fmtDate(a?.warrantyEnd)}{w.costRecovered ? ` · recovered ${naira(w.costRecovered)}` : ""}</div><div>{w.notes}</div>{w.outcome && <div className="sm"><b>Outcome:</b> {w.outcome}</div>}
          {api.can(user.id, "warranty.create", p.id) && w.status === "raised" && <div className="row row--wrap">{(["accepted", "rejected", "replaced", "refunded"] as WarrantyStatus[]).map((s) => <button key={s} className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.updateWarrantyClaim(user.id, w.id, { status: s, outcome: `Marked ${s}`, costRecovered: s === "refunded" ? a?.unitCost ?? 0 : 0 }), `Claim ${s} — pending check`)}>{s}</button>)}</div>}
        </div></div>; }) : <Empty title="No warranty claims" />}
      {api.can(user.id, "warranty.create", p.id) && <div className="card"><div className="card__head"><div className="card__title">Raise a warranty claim</div></div><div className="card__body form">
        <select className="ns-input" value={wAsset} onChange={(e) => setWAsset(e.target.value)}><option value="">— asset —</option>{installed.map((a) => <option key={a.id} value={a.id}>{a.serial} · {a.model} · to {fmtDate(a.warrantyEnd)}</option>)}</select>
        <input className="ns-input" placeholder="Notes" value={wNotes} onChange={(e) => setWNotes(e.target.value)} />
        <button className="ns-btn ns-btn--primary" onClick={() => { if (safe(() => { api.raiseWarrantyClaim(user.id, p.id, { assetId: wAsset, notes: wNotes }); }, "Claim raised — pending check")) { setWAsset(""); setWNotes(""); } }}>Raise claim</button></div></div>}
    </>}
    {!api.can(user.id, "project.read", p.id) && <Note tone="danger">No access.</Note>}
  </div>;
}

/**
 * Who records commissioning on this site. A techlead delegates it per project — usually to the tech who
 * did the install and took the readings. The form below unlocks itself once `can()` sees the assignment,
 * so nothing here renders it; this card only decides who.
 */
function CommissioningAssignment({ p, assignee, setAssignee }: { p: Project; assignee: string; setAssignee: (v: string) => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const canAssign = api.can(user.id, "membership.manage", p.id);
  const current = p.commissioningAssigneeId ? api.userOrStub(p.commissioningAssigneeId) : undefined;
  const mine = current?.id === user.id;
  const candidates = api.getUsers();

  if (mine) return (
    <Note tone="success"><b>You are commissioning this site.</b> Record the readings below; a tech lead or director checks them.</Note>
  );

  if (current) return (
    <div className="card"><div className="card__body row" style={{ gap: 12 }}>
      <Avatar user={current} sm />
      <div className="grow"><div>{current.name} is commissioning this site</div><div className="sm muted">Assigned per site · a tech lead or director still checks the record</div></div>
      {canAssign && <>
        <select className="ns-input" style={{ maxWidth: 200 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Reassign to…</option>
          {candidates.filter((u) => u.id !== current.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="ns-btn ns-btn--sm" disabled={!assignee} onClick={() => safe(() => { api.assignCommissioning(user.id, p.id, assignee); setAssignee(""); }, "Reassigned")}>Assign</button>
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.assignCommissioning(user.id, p.id), "Cleared")}>Clear</button>
      </>}
    </div></div>
  );

  if (!canAssign) return <Note tone="info">Commissioning has not been assigned for this site yet. A tech lead can assign it to anyone, including a tech.</Note>;

  return (
    <div className="card"><div className="card__head"><div className="card__title">Who commissions this site</div>
      <span className="sm muted">Whoever you pick may record the readings — a tech lead or director still checks them</span></div>
      <div className="card__body row" style={{ gap: 8 }}>
        <select className="ns-input grow" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Choose a person…</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.roles.map((r) => ROLE_LABEL[r]).join(", ")}</option>)}
        </select>
        <button className="ns-btn ns-btn--primary" disabled={!assignee} onClick={() => safe(() => { api.assignCommissioning(user.id, p.id, assignee); setAssignee(""); }, "Assigned — logged to chronology")}>Assign</button>
      </div>
    </div>
  );
}
