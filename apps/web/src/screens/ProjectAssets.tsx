import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { MOVEMENT_LABEL, fmtDate, naira, relative, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Empty, Note, ReviewBadge } from "../components/ui";

const ASSET_BADGE = { in_stock: "neutral", installed: "success", faulty: "danger", replaced: "warning", decommissioned: "neutral" } as const;

export function ProjectAssets() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const assets = api.listAssets({ projectId: p.id }); const mv = api.listMovements({ projectId: p.id });
  const canIssue = api.can(user.id, "inventory.write") || api.can(user.id, "inventory.request", p.id);
  const [itemId, setItemId] = useState(api.items[0]?.id ?? ""); const [qty, setQty] = useState("1"); const [sel, setSel] = useState<string[]>([]); const [label, setLabel] = useState("");
  const it = itemId ? api.item(itemId) : undefined; const avail = it ? api.available(it.id) : 0; const serialsInStock = it?.isSerialised ? api.inStockSerials(it.id) : [];
  const [rItem, setRItem] = useState(""); const [rQty, setRQty] = useState("1"); const [rSel, setRSel] = useState<string[]>([]); const [rWhy, setRWhy] = useState("");
  const installedItems = Array.from(new Set(assets.filter((a) => a.status === "installed").map((a) => a.inventoryItemId)));
  const soon = (d?: string) => d && new Date(d).getTime() - Date.now() < 90 * 86400000;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card table--wrap"><div className="card__head"><div className="card__title">Asset register</div><span className="sm muted">{assets.length} serialised assets on this project</span></div>
        {assets.length ? <table className="table ledger"><thead><tr><th>Type</th><th>Make / model</th><th>Serial</th><th className="num">Unit cost</th><th>Installed</th><th>Warranty to</th><th>Status</th></tr></thead>
          <tbody>{assets.map((a) => <tr key={a.id}><td>{a.assetType}</td><td>{a.make} {a.model}</td><td className="ns-mono">{a.serial}</td><td className="num ns-mono">{naira(a.unitCost)}</td><td className="sm">{fmtDate(a.installDate)}</td>
            <td className="sm">{fmtDate(a.warrantyEnd)} {soon(a.warrantyEnd) && a.status === "installed" && <Badge variant="warning">expiring</Badge>}</td><td><Badge variant={ASSET_BADGE[a.status]}>{a.status.replace("_", " ")}</Badge></td></tr>)}</tbody></table>
          : <div className="card__body"><Empty title="No assets installed yet" hint="Assets appear here when serialised stock is issued to the project and checked." /></div>}</div>

      <div className="workspace" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card"><div className="card__head"><div className="card__title">Issue stock to this project</div><span className="sm muted">→ PM / Finance check</span></div>
          <div className="card__body">{canIssue ? <form className="stack" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.issueStock(user.id, { itemId, qty: it?.isSerialised ? sel.length : Number(qty), projectId: p.id, serials: sel, label }); }, "Issue submitted — pending check")) { setSel([]); setLabel(""); } }}>
            <label className="ns-field"><span className="ns-field__label">Item</span><select className="ns-input" value={itemId} onChange={(e) => { setItemId(e.target.value); setSel([]); }}>{api.items.map((i) => <option key={i.id} value={i.id}>{i.name} — {api.available(i.id)} {i.unit} @ {naira(api.wacOf(i.id))}</option>)}</select></label>
            {it?.isSerialised ? <label className="ns-field"><span className="ns-field__label">Serials in stock ({serialsInStock.length}) — select {sel.length}</span>
              <select className="ns-input select-multi" multiple value={sel} onChange={(e) => setSel(Array.from(e.target.selectedOptions).map((o) => o.value))}>{serialsInStock.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              : <label className="ns-field"><span className="ns-field__label">Quantity ({it?.unit}) · {avail} available</span><input className="ns-input" type="number" min={1} max={avail} value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
            <label className="ns-field"><span className="ns-field__label">Pick list / reason</span><input className="ns-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Strings 1–3" /></label>
            <div><button className="ns-btn ns-btn--primary" type="submit">Issue @ WAC {naira(it ? api.wacOf(it.id) : 0)}</button></div>
          </form> : <Note tone="warn">Only a Store Keeper, or a PM / Field Tech on this project, can request stock.</Note>}</div></div>
        <div className="card"><div className="card__head"><div className="card__title">Return unused stock</div><span className="sm muted">credits the project</span></div>
          <div className="card__body">{canIssue ? <form className="stack" onSubmit={(e) => { e.preventDefault(); if (safe(() => { const ri = api.item(rItem); api.returnStock(user.id, { itemId: rItem, qty: ri.isSerialised ? rSel.length : Number(rQty), projectId: p.id, serials: rSel, reason: rWhy }); }, "Return submitted — pending check")) { setRSel([]); setRWhy(""); } }}>
            <label className="ns-field"><span className="ns-field__label">Item</span><select className="ns-input" value={rItem} onChange={(e) => { setRItem(e.target.value); setRSel([]); }}><option value="">—</option>{api.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            {rItem && api.item(rItem).isSerialised ? <label className="ns-field"><span className="ns-field__label">Installed serials — select {rSel.length}</span>
              <select className="ns-input select-multi" multiple value={rSel} onChange={(e) => setRSel(Array.from(e.target.selectedOptions).map((o) => o.value))}>{assets.filter((a) => a.inventoryItemId === rItem && a.status === "installed").map((a) => <option key={a.serial} value={a.serial}>{a.serial}</option>)}</select></label>
              : <label className="ns-field"><span className="ns-field__label">Quantity</span><input className="ns-input" type="number" min={1} value={rQty} onChange={(e) => setRQty(e.target.value)} /></label>}
            <label className="ns-field"><span className="ns-field__label">Reason</span><input className="ns-input" value={rWhy} onChange={(e) => setRWhy(e.target.value)} /></label>
            <div><button className="ns-btn ns-btn--secondary" type="submit" disabled={!rItem}>Return to warehouse</button></div>
            {installedItems.length === 0 && <span className="sm muted">Nothing installed to return.</span>}
          </form> : <Note tone="warn">Not allowed for your role.</Note>}</div></div>
      </div>

      <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock movements for this project</div><span className="sm muted">{mv.length} · ledger is append-only</span></div>
        {mv.length ? <table className="table ledger"><thead><tr><th>When</th><th>Type</th><th>Item</th><th className="num">Qty</th><th className="num">Unit (WAC)</th><th className="num">Total</th><th>By</th><th>Status</th></tr></thead>
          <tbody>{mv.map((m) => <tr key={m.id}><td className="sm">{relative(m.createdAt)}</td><td><Badge variant={m.movementType === "issue" ? "info" : m.movementType === "return" ? "warning" : m.movementType === "write_off" ? "danger" : "success"}>{MOVEMENT_LABEL[m.movementType]}</Badge></td>
            <td>{api.itemName(m.itemId)}{m.serials?.length ? <div className="sm muted ns-mono">{m.serials.length} serials</div> : null}<div className="sm muted">{m.sourceRef?.label}</div></td><td className="num ns-mono">{m.qty}</td><td className="num ns-mono">{naira(m.unitCost)}</td><td className="num ns-mono">{naira(m.totalCost)}</td><td className="sm">{api.userName(m.createdBy)}</td><td><ReviewBadge status={m.reviewStatus} /></td></tr>)}</tbody></table>
          : <div className="card__body"><Empty title="No stock movements yet" /></div>}</div>
    </div>
  );
}
