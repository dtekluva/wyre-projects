import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CATEGORY_LABEL, MOVEMENT_LABEL, fmtDate, fmtQty, installedOn, naira, relative, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Empty, Note, ReviewBadge } from "../components/ui";
import { VoidControl, VoidedNote } from "../components/VoidControl";
import { ProjectRequests, RequestForm } from "../components/StockRequests";

const ASSET_BADGE = { in_stock: "neutral", installed: "success", faulty: "danger", replaced: "warning", decommissioned: "neutral" } as const;

export function ProjectAssets() {
  const p = useOutletContext<Project>(); const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const assets = api.listAssets({ projectId: p.id }); const mv = api.listMovements({ projectId: p.id });
  const isStore = api.can(user.id, "inventory.write"); const canRequest = api.can(user.id, "inventory.request", p.id);
  const canIssue = isStore || canRequest;
  const [itemId, setItemId] = useState(api.items[0]?.id ?? ""); const [qty, setQty] = useState("1"); const [sel, setSel] = useState<string[]>([]); const [label, setLabel] = useState("");
  const it = itemId ? api.item(itemId) : undefined; const avail = it ? api.available(it.id) : 0; const serialsInStock = it?.isSerialised ? api.inStockSerials(it.id) : [];
  const [rItem, setRItem] = useState(""); const [rQty, setRQty] = useState("1"); const [rSel, setRSel] = useState<string[]>([]); const [rWhy, setRWhy] = useState("");
  const installedItems = Array.from(new Set(assets.filter((a) => a.status === "installed").map((a) => a.inventoryItemId)));
  const soon = (d?: string) => d && new Date(d).getTime() - Date.now() < 90 * 86400000;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <InstalledCard p={p} />
      <div className="card table--wrap"><div className="card__head"><div className="card__title">Asset register</div><span className="sm muted">{assets.length} serialised assets on this project</span></div>
        {assets.length ? <table className="table ledger"><thead><tr><th>Type</th><th>Make / model</th><th>Serial</th><th className="num">Unit cost</th><th>Installed</th><th>Warranty to</th><th>Status</th></tr></thead>
          <tbody>{assets.map((a) => <tr key={a.id}><td>{a.assetType}</td><td>{a.make} {a.model}</td><td className="ns-mono">{a.serial}</td><td className="num ns-mono">{naira(a.unitCost)}</td><td className="sm">{fmtDate(a.installDate)}</td>
            <td className="sm">{fmtDate(a.warrantyEnd)} {soon(a.warrantyEnd) && a.status === "installed" && <Badge variant="warning">expiring</Badge>}</td><td><Badge variant={ASSET_BADGE[a.status]}>{a.status.replace("_", " ")}</Badge></td></tr>)}</tbody></table>
          : <div className="card__body"><Empty title="No serial-tracked units on this project" hint="Units taken into stock with serial numbers are listed here one by one once they are issued to the project. The counts above cover everything else." /></div>}</div>

      <div className="workspace" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Two doors into the same ledger. The store keeper issues directly (someone else checks). Everyone else
            asks — no serials, no WAC — and the store's hand-over is the check. */}
        {!isStore && canRequest
          ? <div className="card"><div className="card__head"><div className="card__title">Request stock from the store</div><span className="sm muted">the store keeper hands over · that is the check</span></div>
              <div className="card__body"><RequestForm projectId={p.id} /></div></div>
          : <div className="card"><div className="card__head"><div className="card__title">Issue stock to this project</div><span className="sm muted">→ Tech Lead / Finance check</span></div>
          <div className="card__body">{canIssue ? <form className="stack" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.issueStock(user.id, { itemId, qty: it?.isSerialised ? sel.length : Number(qty), projectId: p.id, serials: sel, label }); }, "Issue submitted — pending check")) { setSel([]); setLabel(""); } }}>
            <label className="ns-field"><span className="ns-field__label">Item</span><select className="ns-input" value={itemId} onChange={(e) => { setItemId(e.target.value); setSel([]); }}>{api.items.map((i) => <option key={i.id} value={i.id}>{i.name} — {api.available(i.id)} {i.unit} @ {naira(api.wacOf(i.id))}</option>)}</select></label>
            {it?.isSerialised ? <label className="ns-field"><span className="ns-field__label">Serials in stock ({serialsInStock.length}) — select {sel.length}</span>
              <select className="ns-input select-multi" multiple value={sel} onChange={(e) => setSel(Array.from(e.target.selectedOptions).map((o) => o.value))}>{serialsInStock.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              : <label className="ns-field"><span className="ns-field__label">Quantity ({it?.unit}) · {avail} available</span><input className="ns-input" type="number" min={1} max={avail} value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
            <label className="ns-field"><span className="ns-field__label">Pick list / reason</span><input className="ns-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Strings 1–3" /></label>
            <div><button className="ns-btn ns-btn--primary" type="submit">Issue @ WAC {naira(it ? api.wacOf(it.id) : 0)}</button></div>
          </form> : <Note tone="warn">Only a Store Keeper, or a PM / Field Tech on this project, can request stock.</Note>}</div></div>}
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

      <div className="card"><div className="card__head"><div className="card__title">Stock requests</div><span className="sm muted">{api.listStockRequests({ projectId: p.id, status: "requested" }).length} waiting for the store</span></div>
        <div className="card__body"><ProjectRequests projectId={p.id} /></div></div>

      <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock movements for this project</div><span className="sm muted">{mv.length} · ledger is append-only</span></div>
        {mv.length ? <table className="table ledger"><thead><tr><th>When</th><th>Type</th><th>Item</th><th className="num">Qty</th><th className="num">Unit (WAC)</th><th className="num">Total</th><th>By</th><th>Status</th></tr></thead>
          <tbody>{mv.map((m) => <tr key={m.id} className={m.voidedAt ? "voided" : ""}><td className="sm">{relative(m.createdAt)}</td><td><Badge variant={m.movementType === "issue" ? "info" : m.movementType === "return" ? "warning" : m.movementType === "write_off" ? "danger" : "success"}>{MOVEMENT_LABEL[m.movementType]}</Badge></td>
            <td>{api.itemName(m.itemId)}{m.serials?.length ? <div className="sm muted ns-mono">{m.serials.length} serials</div> : null}<div className="sm muted">{m.sourceRef?.label}</div></td><td className="num ns-mono">{m.qty}</td><td className="num ns-mono">{naira(m.unitCost)}</td><td className="num ns-mono">{naira(m.totalCost)}</td><td className="sm">{api.userName(m.createdBy)}</td><td><ReviewBadge status={m.reviewStatus} />{!m.voidedAt && <VoidControl kind="stock_movement" id={m.id} projectId={m.projectId} size="xs" what={`${api.itemName(m.itemId)} × ${m.qty}`} />}<VoidedNote r={m} /></td></tr>)}</tbody></table>
          : <div className="card__body"><Empty title="No stock movements yet" /></div>}</div>
    </div>
  );
}

/**
 * How much has gone into this project — Akanimo, 2026-11-04. The tracker's record of "installed" is stock issued to the
 * project and checked, less checked returns; issues still waiting for their check are shown apart. Tools and PPE are left out.
 */
function InstalledCard({ p }: { p: Project }) {
  const api = useApi();
  const inst = installedOn(api, p.id);
  const pending = inst.lines.reduce((s, l) => s + l.pending, 0);
  return <div className="card">
    <div className="card__head"><div className="card__title">Installed on this project</div>
      <span className="sm muted">issued to site and checked, less returns{pending ? ` · ${fmtQty(pending)} more waiting for a check` : ""}</span></div>
    {!inst.lines.length ? <div className="card__body"><Empty title="Nothing issued to this site yet" hint="Equipment counts here once it is issued to the project — from the store, a stock request or a visit — and checked." /></div> : <>
      <div className="installed">
        {inst.byCategory.map((c) => <div key={c.category} className="installed__tile">
          <div className="installed__label">{CATEGORY_LABEL[c.category] ?? c.category}</div>
          <div className="installed__value">{fmtQty(c.net)}{c.unit ? <span className="installed__unit"> {c.unit}</span> : null}</div>
          {c.category === "panel" && inst.panelsKwp > 0 && <div className="installed__sub"><b>{fmtQty(inst.panelsKwp)} kWp</b>{inst.capacityKwp ? ` of ${fmtQty(inst.capacityKwp)} kWp` : ""}</div>}
          {c.category === "panel" && inst.capacityKwp ? <div className="installed__bar" title={`${inst.pct}% of the planned system`}><span style={{ width: `${Math.min(100, inst.pct ?? 0)}%` }} /></div> : null}
          {c.pending > 0 && <div className="installed__sub installed__sub--wait">+{fmtQty(c.pending)} waiting for a check</div>}
        </div>)}
      </div>
      <div className="table--wrap"><table className="table"><thead><tr><th>Item</th><th>Type</th><th className="num">Issued</th><th className="num">Returned</th><th className="num">Installed</th><th className="num">Waiting for a check</th></tr></thead>
        <tbody>{inst.lines.map((l) => <tr key={l.itemId}><td>{l.name}{l.watts ? <span className="sm muted"> · {l.watts} W each</span> : null}</td><td className="sm">{CATEGORY_LABEL[l.category] ?? l.category}</td>
          <td className="num ns-mono">{fmtQty(l.issued)}</td><td className="num ns-mono">{l.returned ? fmtQty(l.returned) : "—"}</td><td className="num ns-mono"><b>{fmtQty(l.net)}</b> {l.unit}</td>
          <td className="num ns-mono">{l.pending ? fmtQty(l.pending) : "—"}</td></tr>)}</tbody></table></div>
      {inst.panelsKwp > 0 && !inst.capacityKwp && <div className="card__foot sm muted">Add the system size on the Details tab to see installed panels against the plan.</div>}
    </>}
  </div>;
}
