import { useState } from "react";
import { FilePick, type Pick } from "../components/FilePick";
import { Link, useOutletContext } from "react-router-dom";
import { COST_CATEGORY_LABEL, ROLE_LABEL, fmtDate, naira, pct, relative, type CostCategory, type Project, type PurchaseOrder } from "@wyre/api";
import { Thumbs } from "../components/Thumbs";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { MoneyStrip } from "../components/MoneyStrip";
import { Badge, Empty, Note, ReviewBadge } from "../components/ui";

const CATS: CostCategory[] = ["equipment", "civil", "labour", "logistics", "permits", "contingency", "om"];
const PO_BADGE: Record<PurchaseOrder["status"], ["neutral" | "success" | "warning" | "danger" | "info", string]> = {
  pending_approval: ["warning", "awaiting approval"], approved: ["info", "approved"], rejected: ["danger", "rejected"],
  partially_delivered: ["info", "partially delivered"], delivered: ["success", "delivered"], closed: ["neutral", "closed"],
};

function PoRow({ po, p }: { po: PurchaseOrder; p: Project }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(po.items.map((i) => [i.id, api.poRemaining(i, po.id)])));
  const [ser, setSer] = useState<Record<string, string>>({}); const [file, setFile] = useState<Pick[]>([]); const [notes, setNotes] = useState("");
  const ap = po.approvalId ? api.approvals.find((a) => a.id === po.approvalId) : undefined;
  const canReceive = api.can(user.id, "goods_receipt.create", p.id) && ["approved", "partially_delivered"].includes(po.status);
  const grns = api.listGRNs(p.id).filter((g) => g.poId === po.id);
  const [bv, bl] = PO_BADGE[po.status];
  const submit = () => {
    const ok = safe(() => {
      const f = file[0]; const att = api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, kind: f.file.type.startsWith("image/") ? "image" : "document", caption: `Delivery note — ${po.poNumber}`, linkedTo: { model: "PurchaseOrder", id: po.id, label: po.poNumber } });
      api.receiveGoods(user.id, po.id, { attachmentIds: [att.id], notes, lines: po.items.map((i) => ({ purchaseItemId: i.id, qty: qty[i.id] ?? 0, serials: (ser[i.id] ?? "").split(/[\s,;]+/).filter(Boolean) })) });
    }, "Goods receipt submitted — pending check");
    if (ok) { setOpen(false); setSer({}); setFile([]); setNotes(""); }
  };
  return (
    <div className="po">
      <div className="po__head">
        <b className="ns-mono">{po.poNumber}</b><span>{api.vendorName(po.vendorId)}</span><Badge variant={bv}>{bl}</Badge>
        <span className="right ns-mono">{naira(po.total)}</span>
        {canReceive && <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "Receive goods"}</button>}
      </div>
      <div className="sm muted">Raised by {api.userName(po.raisedBy)} {relative(po.raisedAt)}{ap && ap.status === "pending" && <> · awaiting {ap.requiredRoles.filter((r) => !ap.decisions.some((d) => d.role === r)).map((r) => ROLE_LABEL[r]).join(" + ")} · <Link to="/work/approvals" className="link">approvals</Link></>}</div>
      <ul className="po__lines">{po.items.map((i) => <li key={i.id}><span className="grow">{i.qty} × {i.description}{i.inventoryItemId && <span className="muted"> · stock</span>}</span><span className="ns-mono">{naira(i.unitCost)}</span><span className="ns-mono">{naira(i.lineTotal)}</span>
        <span className={`sm ${i.qtyReceived >= i.qty ? "" : "muted"}`}>{i.qtyReceived}/{i.qty} received</span></li>)}</ul>
      {grns.length > 0 && <div className="stack sm muted" style={{ marginTop: 6, gap: 4 }}>{grns.map((g) => <span key={g.id} className="row row--wrap" style={{ gap: 8 }}>{g.grnNumber} <ReviewBadge status={g.reviewStatus} /> <Thumbs ids={g.attachmentIds} empty="no image" /></span>)}</div>}
      {open && <div className="receive">
        <div className="ns-overline">Goods receipt against {po.poNumber} → {api.mainLocationId() ? api.locationName(api.mainLocationId()!) : "the warehouse"}</div>
        {po.items.map((i) => { const rem = api.poRemaining(i, po.id); const it = i.inventoryItemId ? api.item(i.inventoryItemId) : undefined; return <div key={i.id}>
          <div className="receive__line"><span className="sm">{i.description} <span className="muted">· {rem} outstanding</span></span>
            <input className="ns-input" type="number" min={0} max={rem} value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} /></div>
          {it?.isSerialised && (qty[i.id] ?? 0) > 0 && <label className="ns-field" style={{ marginTop: 6 }}><span className="ns-field__hint">Serial numbers — {qty[i.id]} required, comma or newline separated (plain ASCII)</span>
            <textarea className="ns-textarea" value={ser[i.id] ?? ""} onChange={(e) => setSer({ ...ser, [i.id]: e.target.value })} placeholder={`e.g. ${it.sku}-0001, ${it.sku}-0002`} /></label>}
        </div>; })}
        <div className="form"><label className="ns-field"><span className="ns-field__label">Delivery note / receipt photo (required)</span><FilePick picks={file} onChange={setFile} required label="Choose delivery note" /></label>
          <label className="ns-field"><span className="ns-field__label">Notes</span><input className="ns-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <button className="ns-btn ns-btn--primary" onClick={submit} disabled={!file.length}>Submit GRN for check</button></div>
      </div>}
    </div>
  );
}

export function ProjectMoney() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const m = api.money(p.id); const canMoney = api.can(user.id, "money.read", p.id);
  const cost = api.listCostItems(p.id); const pos = api.listPOs(p.id); const cos = api.listChangeOrders(p.id); const acts = api.listActuals(p.id); const ret = api.retention(p.id);
  const bills = api.listQbBills().filter((b) => b.projectId === p.id);
  const dirThr = api.thresholdNum("po.director_threshold", 5_000_000);
  // forms
  const [ciCat, setCiCat] = useState<CostCategory>("equipment"); const [ciLabel, setCiLabel] = useState(""); const [ciAmt, setCiAmt] = useState("");
  const [vendor, setVendor] = useState(""); const [poNotes, setPoNotes] = useState("");
  type L = { description: string; qty: string; unitCost: string; inventoryItemId: string; costItemId: string };
  const blank = (): L => ({ description: "", qty: "1", unitCost: "", inventoryItemId: "", costItemId: cost.find((c) => c.reviewStatus === "checked")?.id ?? "" });
  const [lines, setLines] = useState<L[]>([blank()]);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
  const setLine = (i: number, patch: Partial<L>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, id: string) => { const it = id ? api.item(id) : undefined; const eq = cost.find((c) => c.category === "equipment" && c.reviewStatus === "checked");
    setLine(i, { inventoryItemId: id, description: it ? it.name : lines[i].description, unitCost: it ? String(api.wacOf(it.id) || "") : lines[i].unitCost, costItemId: it && eq ? eq.id : lines[i].costItemId }); };
  const [coT, setCoT] = useState(""); const [coR, setCoR] = useState(""); const [coS, setCoS] = useState(""); const [coC, setCoC] = useState(""); const [coD, setCoD] = useState("0");
  if (!canMoney) return <Note tone="warn">Your role cannot view project money.</Note>;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <MoneyStrip p={p} />

      <div className="card"><div className="card__head"><div className="card__title">Budget vs actual by category</div>
        <div className="legend"><span><i style={{ background: "var(--ns-purple-200)" }} />committed</span><span><i style={{ background: "var(--ns-color-primary)" }} />actual</span><span>track = planned</span></div></div>
        <div className="card__body">{CATS.filter((c) => m.byCategory[c].planned || m.byCategory[c].committed || m.byCategory[c].actual).map((c) => { const b = m.byCategory[c]; const base = Math.max(b.planned, b.committed, b.actual, 1);
          return <div key={c} className="catbar"><span className="sm">{COST_CATEGORY_LABEL[c]}</span>
            <div className="catbar__track"><i className="catbar__committed" style={{ width: `${pct(b.committed, base)}%` }} /><i className={`catbar__actual ${b.planned && b.actual > b.planned ? "catbar__actual--over" : ""}`} style={{ width: `${pct(b.actual, base)}%` }} /></div>
            <span className="catbar__nums">{naira(b.actual, true)} / {naira(b.committed, true)} / <b>{naira(b.planned, true)}</b></span></div>; })}
          {m.planned === 0 && <Empty title="No checked budget lines yet" />}</div></div>

      <div className="card"><div className="card__head"><div className="card__title">Budget lines</div><span className="sm muted">{cost.length} lines · Finance checks</span></div>
        <div className="table--wrap"><table className="table ledger"><thead><tr><th>Line</th><th>Category</th><th className="num">Planned</th><th>Status</th></tr></thead>
          <tbody>{cost.map((c) => <tr key={c.id}><td>{c.label}<div className="sm muted">by {api.userName(c.submittedBy)} {relative(c.submittedAt)}</div></td><td>{COST_CATEGORY_LABEL[c.category]}</td><td className="num ns-mono">{naira(c.plannedAmount)}</td><td><ReviewBadge status={c.reviewStatus} /></td></tr>)}</tbody></table></div>
        {api.can(user.id, "cost.create", p.id) && <div className="card__foot"><form className="form grow" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.addCostItem(user.id, p.id, { category: ciCat, label: ciLabel, plannedAmount: Number(ciAmt) }); }, "Budget line submitted for Finance check")) { setCiLabel(""); setCiAmt(""); } }}>
          <select className="ns-input" value={ciCat} onChange={(e) => setCiCat(e.target.value as CostCategory)}>{CATS.map((c) => <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>)}</select>
          <input className="ns-input" placeholder="Label" value={ciLabel} onChange={(e) => setCiLabel(e.target.value)} /><input className="ns-input" type="number" placeholder="Planned ₦" value={ciAmt} onChange={(e) => setCiAmt(e.target.value)} />
          <button className="ns-btn ns-btn--secondary" type="submit">Add line</button></form></div>}
      </div>

      <div className="card"><div className="card__head"><div className="card__title">Purchase orders</div><span className="sm muted">{pos.length} POs · committed {naira(m.committed, true)}</span></div>
        {pos.length ? pos.map((po) => <PoRow key={po.id} po={po} p={p} />) : <div className="card__body"><Empty title="No purchase orders yet" /></div>}
        {api.can(user.id, "po.create", p.id) && <div className="card__foot" style={{ display: "block" }}>
          <div className="ns-overline" style={{ marginBottom: 8 }}>Raise a purchase order</div>
          <div className="form" style={{ marginBottom: 8 }}><label className="ns-field"><span className="ns-field__label">Vendor <span className="muted">(optional)</span></span>
            <input className="ns-input" list="po-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Who you are buying from" />
            <datalist id="po-vendors">{api.vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist></label>
            <label className="ns-field"><span className="ns-field__label">Notes</span><input className="ns-input" value={poNotes} onChange={(e) => setPoNotes(e.target.value)} /></label></div>
          <div className="polines">{lines.map((l, i) => <div key={i} className="poline">
            <label className="ns-field"><span className="ns-field__hint">Description</span><input className="ns-input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></label>
            <label className="ns-field"><span className="ns-field__hint">Stock item (optional)</span><select className="ns-input" value={l.inventoryItemId} onChange={(e) => pickItem(i, e.target.value)}><option value="">— service / non-stock —</option>{api.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></label>
            <label className="ns-field"><span className="ns-field__hint">Budget line</span><select className="ns-input" value={l.costItemId} onChange={(e) => setLine(i, { costItemId: e.target.value })}><option value="">—</option>{cost.filter((c) => c.reviewStatus === "checked").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <label className="ns-field"><span className="ns-field__hint">Qty</span><input className="ns-input" type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
            <label className="ns-field"><span className="ns-field__hint">Unit ₦</span><input className="ns-input" type="number" min={0} value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></label>
            <button className="ns-btn ns-btn--ghost ns-btn--sm" type="button" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} aria-label="Remove line">✕</button>
          </div>)}</div>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}><button className="ns-btn ns-btn--ghost ns-btn--sm" type="button" onClick={() => setLines((ls) => [...ls, blank()])}>+ line</button>
            <span className="sm muted">Total <b className="ns-mono">{naira(total)}</b> → {total >= dirThr ? "Finance + Director" : "Finance"} approval</span>
            <button className="ns-btn ns-btn--primary right" type="button" onClick={() => { if (safe(() => { api.createPO(user.id, p.id, { vendorName: vendor, notes: poNotes, items: lines.map((l) => ({ description: l.description, qty: Number(l.qty), unitCost: Number(l.unitCost), inventoryItemId: l.inventoryItemId || undefined, costItemId: l.costItemId || undefined })) }); }, "PO raised — sent for approval")) { setLines([blank()]); setPoNotes(""); } }}>Raise PO</button></div>
        </div>}
      </div>

      <div className="card"><div className="card__head"><div className="card__title">Change orders</div><span className="sm muted">approved {naira(m.changeOrders, true)}</span></div>
        <div className="card__body">{cos.length ? <table className="table ledger"><thead><tr><th>#</th><th>Title</th><th className="num">Cost Δ</th><th className="num">Days</th><th>Status</th></tr></thead>
          <tbody>{cos.map((c) => <tr key={c.id}><td className="ns-mono">{c.coNumber}</td><td>{c.title}<div className="sm muted">{c.reason}</div></td><td className="num ns-mono">{naira(c.costDelta)}</td><td className="num">{c.timeDeltaDays}</td><td><Badge variant={c.status === "approved" ? "success" : c.status === "rejected" ? "danger" : "warning"}>{c.status.replace("_", " ")}</Badge></td></tr>)}</tbody></table> : <Empty title="No change orders" />}</div>
        {api.can(user.id, "change_order.create", p.id) && <div className="card__foot"><form className="form grow" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.raiseChangeOrder(user.id, p.id, { title: coT, reason: coR, scopeDelta: coS, costDelta: Number(coC), timeDeltaDays: Number(coD) }); }, "Change order raised — sent for approval")) { setCoT(""); setCoR(""); setCoS(""); setCoC(""); setCoD("0"); } }}>
          <input className="ns-input" placeholder="Title" value={coT} onChange={(e) => setCoT(e.target.value)} /><input className="ns-input" placeholder="Reason" value={coR} onChange={(e) => setCoR(e.target.value)} />
          <input className="ns-input" placeholder="Scope change" value={coS} onChange={(e) => setCoS(e.target.value)} /><input className="ns-input" type="number" placeholder="Cost Δ ₦" value={coC} onChange={(e) => setCoC(e.target.value)} />
          <input className="ns-input" type="number" placeholder="Days Δ" value={coD} onChange={(e) => setCoD(e.target.value)} /><button className="ns-btn ns-btn--secondary" type="submit">Raise CO</button></form></div>}
      </div>

      <div className="card table--wrap"><div className="card__head"><div className="card__title">Actuals ledger</div><span className="sm muted">only checked / approved events · {naira(m.actual, true)}</span></div>
        {acts.length ? <table className="table ledger"><thead><tr><th>Date</th><th>Source</th><th>Reference</th><th>Category</th><th className="num">Amount</th><th>Evidence</th></tr></thead>
          <tbody>{acts.map((a) => <tr key={a.id}><td className="sm">{fmtDate(a.date)}</td><td><Badge variant="neutral">{a.source.replace("_", " ")}</Badge></td><td>{a.sourceRef.label}{a.vendorId && <div className="sm muted">{api.vendorName(a.vendorId)}</div>}</td><td className="sm">{COST_CATEGORY_LABEL[a.category]}</td>
            <td className={`num ns-mono ${a.amount < 0 ? "warn-cell" : ""}`}>{naira(a.amount)}</td><td><Thumbs ids={a.attachmentIds} /></td></tr>)}</tbody></table> : <div className="card__body"><Empty title="No actuals yet" hint="Actuals appear when goods receipts, stock issues or change orders are checked / approved." /></div>}</div>

      <div className="workspace" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card"><div className="card__head"><div className="card__title">Retention</div>{ret.releasedAt ? <Badge variant="success">released</Badge> : ret.amountHeld ? <Badge variant="warning">held</Badge> : <Badge variant="neutral">not yet</Badge>}</div>
          <div className="card__body stack" style={{ gap: 6 }}><div className="sm">{ret.percent}% of contract · <b className="ns-mono">{naira(ret.amountHeld)}</b></div><div className="sm muted">{ret.releaseConditions}</div>
            {ret.releasedAt && <div className="sm">Released {fmtDate(ret.releasedAt)} by {api.userName(ret.releasedBy)}</div>}
            {!ret.releasedAt && ret.amountHeld > 0 && api.can(user.id, "retention.request", p.id) && <div><button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => safe(() => { api.requestRetentionRelease(user.id, p.id); }, "Retention release requested")}>Request release</button></div>}</div></div>
        <div className="card"><div className="card__head"><div className="card__title">QuickBooks bills</div><Link to="/finance/reconciliation" className="sm link">Reconciliation →</Link></div>
          <div className="card__body stack" style={{ gap: 6 }}>{bills.length ? bills.map((b) => <div key={b.id} className="row sm"><span className="ns-mono">{b.docNumber}</span><span className="grow ellipsis">{b.vendorName}</span><span className="ns-mono">{naira(b.totalAmount, true)}</span>
            <Badge variant={b.confidence === "matched" ? "success" : b.confidence === "suggested" ? "warning" : "danger"}>{b.confidence}{b.poNumber ? ` · ${b.poNumber}` : ""}</Badge></div>) : <span className="sm muted">No synced bills for this project</span>}</div></div>
      </div>
    </div>
  );
}
