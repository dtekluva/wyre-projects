import { useState } from "react";
import { MOVEMENT_LABEL, naira, relative, type MovementType } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Empty, Kpi, Note, ReviewBadge } from "../components/ui";

export function Inventory() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  if (!api.can(user.id, "inventory.read") && !api.canAnywhere(user.id, "inventory.read")) return <Note tone="danger">Your role cannot view inventory.</Note>;
  const bal = api.balances().filter((b) => b.locationId === "loc_wh"); const sv = api.stockValue();
  const [focus, setFocus] = useState<string>(""); const [type, setType] = useState<"" | MovementType>("");
  const mv = api.listMovements({ itemId: focus || undefined, type: type || undefined }).slice(0, 60);
  const pending = api.listMovements({ status: "pending" }).length; const below = bal.filter((b) => b.belowReorder).length;
  const canWrite = api.can(user.id, "inventory.write");
  const [wItem, setWItem] = useState(api.items[0]?.id ?? ""); const [wQty, setWQty] = useState("1"); const [wSel, setWSel] = useState<string[]>([]); const [wWhy, setWWhy] = useState(""); const [wFile, setWFile] = useState("");
  const wi = wItem ? api.item(wItem) : undefined; const wVal = wi ? (wi.isSerialised ? wSel.length : Number(wQty) || 0) * api.wacOf(wi.id) : 0;
  const dirThr = api.thresholdNum("writeoff.director_threshold", 500_000);
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Inventory</h1><div className="page-sub">{api.locationName("loc_wh")} · weighted-average cost · ledger-backed</div></div></div>
      <div className="kpis">
        <Kpi label="Stock value" value={naira(sv.total, true)} sub={`${api.items.length} catalogue items`} />
        <Kpi label="Below reorder" value={below} sub="items at or under level" tone={below ? "warn" : undefined} />
        <Kpi label="Pending checks" value={pending} sub="issues / returns / write-offs" tone={pending ? "accent" : undefined} />
        <Kpi label="Serialised in stock" value={api.assets.filter((a) => a.status === "in_stock").length} sub="units in the asset register" />
        {Object.entries(sv.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, v]) => <Kpi key={c} label={`Value · ${c}`} value={naira(v, true)} />)}
      </div>

      <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock on hand</div><span className="sm muted">click a row to filter the ledger</span></div>
        <table className="table"><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th className="num">On hand</th><th className="num">Unit cost</th><th className="num">Value</th><th className="num">Reorder at</th><th></th></tr></thead>
          <tbody>{api.items.map((it) => { const b = bal.find((x) => x.itemId === it.id)!; const av = api.available(it.id); return <tr key={it.id} onClick={() => setFocus(focus === it.id ? "" : it.id)} style={{ cursor: "pointer", background: focus === it.id ? "var(--ns-color-surface-selected)" : undefined }}>
            <td className="ns-mono sm">{it.sku}</td><td>{it.name}{it.isSerialised && <span className="sm muted"> · serialised</span>}</td><td className="sm">{it.category}</td>
            <td className="num ns-mono">{b.qtyOnHand} {it.unit}{av !== b.qtyOnHand && <div className="sm muted">{av} free</div>}</td><td className="num ns-mono">{naira(b.wacUnitCost)}</td><td className="num ns-mono">{naira(b.value)}</td><td className="num ns-mono muted">{it.reorderLevel}</td>
            <td>{b.belowReorder ? <Badge variant="danger">reorder {it.reorderQty}</Badge> : b.qtyOnHand <= it.reorderLevel * 1.5 ? <Badge variant="warning">low</Badge> : null}</td></tr>; })}</tbody></table></div>

      <div className="workspace" style={{ gridTemplateColumns: "2fr 1fr", marginTop: 20 }}>
        <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock ledger {focus && <span className="muted">· {api.itemName(focus)}</span>}</div>
          <select className="ns-input" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value as "" | MovementType)}><option value="">All types</option>{(Object.keys(MOVEMENT_LABEL) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}</select></div>
          {mv.length ? <table className="table ledger"><thead><tr><th>When</th><th>Type</th><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th><th>Project</th><th>Ref</th><th>Status</th></tr></thead>
            <tbody>{mv.map((m) => <tr key={m.id}><td className="sm">{relative(m.createdAt)}</td><td><Badge variant={m.movementType === "receipt" ? "success" : m.movementType === "issue" ? "info" : m.movementType === "write_off" ? "danger" : "warning"}>{MOVEMENT_LABEL[m.movementType]}</Badge></td>
              <td>{api.itemName(m.itemId)}</td><td className={`num ns-mono ${["issue", "write_off"].includes(m.movementType) ? "warn-cell" : ""}`}>{["issue", "write_off"].includes(m.movementType) ? "−" : "+"}{m.qty}</td><td className="num ns-mono">{naira(m.unitCost)}</td><td className="num ns-mono">{naira(m.totalCost)}</td>
              <td className="sm ns-mono">{api.projectCode(m.projectId)}</td><td className="sm muted">{m.sourceRef?.label}{m.reason ? ` · ${m.reason}` : ""}</td><td><ReviewBadge status={m.reviewStatus} /></td></tr>)}</tbody></table> : <div className="card__body"><Empty title="No movements" /></div>}</div>
        <div className="card"><div className="card__head"><div className="card__title">Write off stock</div><span className="sm muted">Finance approval{wVal >= dirThr ? " + Director" : ""}</span></div>
          <div className="card__body">{canWrite ? <form className="stack" onSubmit={(e) => { e.preventDefault(); if (safe(() => { const ev = api.addEvidence(user.id, { fileName: wFile.trim() || "damage-photo.jpg", caption: `Write-off evidence — ${wi?.name}` }); api.writeOff(user.id, { itemId: wItem, qty: wi?.isSerialised ? wSel.length : Number(wQty), serials: wSel, reason: wWhy, attachmentIds: [ev.id] }); }, "Write-off submitted for Finance approval")) { setWSel([]); setWWhy(""); setWFile(""); } }}>
            <label className="ns-field"><span className="ns-field__label">Item</span><select className="ns-input" value={wItem} onChange={(e) => { setWItem(e.target.value); setWSel([]); }}>{api.items.map((i) => <option key={i.id} value={i.id}>{i.name} — {api.available(i.id)} free</option>)}</select></label>
            {wi?.isSerialised ? <label className="ns-field"><span className="ns-field__label">Serials — select {wSel.length}</span><select className="ns-input select-multi" multiple value={wSel} onChange={(e) => setWSel(Array.from(e.target.selectedOptions).map((o) => o.value))}>{api.inStockSerials(wi.id).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              : <label className="ns-field"><span className="ns-field__label">Quantity</span><input className="ns-input" type="number" min={1} value={wQty} onChange={(e) => setWQty(e.target.value)} /></label>}
            <label className="ns-field"><span className="ns-field__label">Reason (required)</span><input className="ns-input" value={wWhy} onChange={(e) => setWWhy(e.target.value)} placeholder="Damaged in transit…" /></label>
            <label className="ns-field"><span className="ns-field__label">Photo (required)</span><input className="ns-input" value={wFile} onChange={(e) => setWFile(e.target.value)} placeholder="damage.jpg" /></label>
            <div className="row"><button className="ns-btn ns-btn--danger" type="submit">Write off {naira(wVal)}</button></div>
          </form> : <Note tone="warn">Only the Store Keeper can raise a write-off.</Note>}</div></div>
      </div>
    </>
  );
}
