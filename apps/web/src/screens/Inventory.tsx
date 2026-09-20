import { useRef, useState } from "react";
import { FilePick, type Pick } from "../components/FilePick";
import { ASSET_TYPES, MOVEMENT_LABEL, fmtDate, naira, relative, type AssetType, type MovementType, type StockCount } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useWaitFor } from "../lib/useWaitFor";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { listen, speechSupported } from "../lib/dictation";
import { Badge, Empty, Kpi, Note, ReviewBadge } from "../components/ui";

export function Inventory() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  if (!api.can(user.id, "inventory.read") && !api.canAnywhere(user.id, "inventory.read")) return <Note tone="danger">Your role cannot view inventory.</Note>;
  const mainLoc = api.mainLocationId();
  const bal = api.balances().filter((b) => b.locationId === mainLoc); const sv = api.stockValue();
  const [focus, setFocus] = useState<string>(""); const [type, setType] = useState<"" | MovementType>("");
  const mv = api.listMovements({ itemId: focus || undefined, type: type || undefined }).slice(0, 60);
  const pending = api.listMovements({ status: "pending" }).length; const below = bal.filter((b) => b.belowReorder).length;
  const canWrite = api.can(user.id, "inventory.write");
  const [wItem, setWItem] = useState(api.items[0]?.id ?? ""); const [wQty, setWQty] = useState("1"); const [wSel, setWSel] = useState<string[]>([]); const [wWhy, setWWhy] = useState(""); const [wFile, setWFile] = useState<Pick[]>([]);
  const wi = wItem ? api.item(wItem) : undefined; const wVal = wi ? (wi.isSerialised ? wSel.length : Number(wQty) || 0) * api.wacOf(wi.id) : 0;
  const dirThr = api.thresholdNum("writeoff.director_threshold", 500_000);
  // phase 3 — locations, transfers, counts
  const locs = api.listLocations(); const counts = api.listCounts(); const canCount = api.can(user.id, "stockcount.create");
  const [tFrom, setTFrom] = useState(mainLoc ?? ""); const [tTo, setTTo] = useState(locs.find((l) => l.id !== mainLoc)?.id ?? ""); const [tItem, setTItem] = useState(api.items[0]?.id ?? ""); const [tQty, setTQty] = useState("1"); const [tSel, setTSel] = useState<string[]>([]);
  const [lName, setLName] = useState(""); const [lType, setLType] = useState<"vehicle" | "site" | "warehouse">("vehicle"); const [lCust, setLCust] = useState("");
  const [countLoc, setCountLoc] = useState(mainLoc ?? ""); const [entry, setEntry] = useState<Record<string, { qty: string; note: string }>>({});
  const ti = tItem ? api.item(tItem) : undefined;
  const openCount = counts.find((c) => c.status === "open");
  const lineVal = (c: StockCount, itemId: string) => entry[itemId] ?? { qty: String(c.lines.find((l) => l.itemId === itemId)?.countedQty ?? ""), note: c.lines.find((l) => l.itemId === itemId)?.note ?? "" };
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Inventory</h1><div className="page-sub">{mainLoc ? api.locationName(mainLoc) : "no location yet"} · weighted-average cost · ledger-backed</div></div></div>
      <div className="kpis">
        <Kpi label="Stock value" value={naira(sv.total, true)} sub={`${api.items.length} catalogue items`} />
        <Kpi label="Below reorder" value={below} sub="items at or under level" tone={below ? "warn" : undefined} />
        <Kpi label="Pending checks" value={pending} sub="issues / returns / write-offs" tone={pending ? "accent" : undefined} />
        <Kpi label="Serialised in stock" value={api.assets.filter((a) => a.status === "in_stock").length} sub="units in the asset register" />
        {Object.entries(sv.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, v]) => <Kpi key={c} label={`Value · ${c}`} value={naira(v, true)} />)}
      </div>

      <Catalogue />
      <ReceiveFromNote />
      <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock on hand</div><span className="sm muted">click a row to filter the ledger</span></div>
        <table className="table"><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th className="num">On hand</th><th className="num">Unit cost</th><th className="num">Value</th><th className="num">Reorder at</th><th></th></tr></thead>
          <tbody>{api.items.map((it) => { const b = bal.find((x) => x.itemId === it.id)!; const av = api.available(it.id); return <tr key={it.id} onClick={() => setFocus(focus === it.id ? "" : it.id)} style={{ cursor: "pointer", background: focus === it.id ? "var(--ns-color-surface-selected)" : undefined }}>
            <td className="ns-mono sm">{it.sku}</td><td>{it.name}{it.isSerialised && <span className="sm muted"> · serialised</span>}</td><td className="sm">{it.category}</td>
            <td className="num ns-mono">{b.qtyOnHand} {it.unit}{av !== b.qtyOnHand && <div className="sm muted">{av} free</div>}</td><td className="num ns-mono">{naira(b.wacUnitCost)}</td><td className="num ns-mono">{naira(b.value)}</td><td className="num ns-mono muted">{it.reorderLevel}</td>
            <td>{b.belowReorder ? <Badge variant="danger">reorder {it.reorderQty}</Badge> : b.qtyOnHand <= it.reorderLevel * 1.5 ? <Badge variant="warning">low</Badge> : null}</td></tr>; })}</tbody></table></div>

      <div className="workspace" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 20 }}>
        <div className="card"><div className="card__head"><div className="card__title">Locations</div><span className="sm muted">{locs.length}</span></div>
          <div className="card__body stack" style={{ gap: 6 }}>{locs.map((l) => { const v = api.balances().filter((b) => b.locationId === l.id).reduce((s, b) => s + b.value, 0); return <div key={l.id} className="row" style={{ justifyContent: "space-between" }}><span><b>{l.name}</b> <span className="sm muted">· {l.type}{l.custodianId ? ` · ${api.userName(l.custodianId)}` : ""}</span></span><span className="ns-mono sm">{naira(v, true)}</span></div>; })}
            {canWrite && <form className="form" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.addLocation(user.id, { name: lName, type: lType, custodianId: lCust || undefined }); }, "Location added")) setLName(""); }}>
              <input className="ns-input" placeholder="New location name" value={lName} onChange={(e) => setLName(e.target.value)} /><select className="ns-input" value={lType} onChange={(e) => setLType(e.target.value as typeof lType)}><option value="vehicle">vehicle</option><option value="site">site</option><option value="warehouse">warehouse</option></select>
              <select className="ns-input" value={lCust} onChange={(e) => setLCust(e.target.value)}><option value="">custodian…</option>{api.getUsers().map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><button className="ns-btn ns-btn--secondary" type="submit">Add</button></form>}</div></div>
        <div className="card"><div className="card__head"><div className="card__title">Transfer stock</div><span className="sm muted">Finance checks · value unchanged</span></div>
          <div className="card__body">{canWrite ? <form className="stack" onSubmit={(e) => { e.preventDefault(); if (safe(() => { api.transferStock(user.id, { itemId: tItem, qty: ti?.isSerialised ? tSel.length : Number(tQty), fromId: tFrom, toId: tTo, serials: tSel }); }, "Transfer submitted — pending check")) setTSel([]); }}>
            <div className="row"><select className="ns-input" value={tFrom} onChange={(e) => { setTFrom(e.target.value); setTSel([]); }}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><span>→</span><select className="ns-input" value={tTo} onChange={(e) => setTTo(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <select className="ns-input" value={tItem} onChange={(e) => { setTItem(e.target.value); setTSel([]); }}>{api.items.map((i) => <option key={i.id} value={i.id}>{i.name} · {api.available(i.id, tFrom)} free at source</option>)}</select>
            {ti?.isSerialised ? <select className="ns-input select-multi" multiple value={tSel} onChange={(e) => setTSel(Array.from(e.target.selectedOptions).map((o) => o.value))}>{api.inStockSerials(ti.id, tFrom).map((s) => <option key={s} value={s}>{s}</option>)}</select>
              : <input className="ns-input" type="number" min={1} value={tQty} onChange={(e) => setTQty(e.target.value)} />}
            <div><button className="ns-btn ns-btn--primary" type="submit">Transfer</button></div></form> : <Note tone="warn">Only the Store Keeper can transfer stock.</Note>}</div></div>
      </div>

      <div className="card" style={{ marginTop: 20 }}><div className="card__head"><div className="card__title">Stock counts</div><span className="sm muted">tolerance ±{api.thresholdNum("stockcount.tolerance_pct", 2)}% · variances post as adjustments on Finance approval</span></div>
        <div className="card__body stack">
          {counts.map((c) => <div key={c.id} className="stack" style={{ gap: 6 }}>
            <div className="row row--wrap"><b>{api.locationName(c.locationId)} · {fmtDate(c.countDate)}</b><Badge variant={c.status === "approved" ? "success" : c.status === "rejected" ? "danger" : c.status === "submitted" ? "warning" : "info"}>{c.status}</Badge><span className="sm muted">by {api.userName(c.countedBy)} · {c.lines.filter((l) => l.countedQty !== null).length}/{c.lines.length} counted{c.varianceValue ? ` · variance ${naira(c.varianceValue, true)}` : ""}</span></div>
            {c.status === "open" && canCount && <>
              <div className="table--wrap"><table className="table ledger"><thead><tr><th>Item</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th><th>Note (required outside tolerance)</th></tr></thead>
                <tbody>{c.lines.map((l) => { const v = lineVal(c, l.itemId); const counted = v.qty === "" ? null : Number(v.qty); const varn = counted === null ? null : counted - l.expectedQty; return <tr key={l.itemId}><td>{api.itemName(l.itemId)}</td><td className="num ns-mono">{l.expectedQty}</td>
                  <td className="num"><input className="ns-input" style={{ minHeight: 30, width: 90 }} type="number" value={v.qty} onChange={(e) => setEntry({ ...entry, [l.itemId]: { ...v, qty: e.target.value } })} /></td>
                  <td className={`num ns-mono ${varn ? "warn-cell" : ""}`}>{varn === null ? "—" : varn > 0 ? `+${varn}` : varn}</td><td><input className="ns-input" style={{ minHeight: 30 }} value={v.note} onChange={(e) => setEntry({ ...entry, [l.itemId]: { ...v, note: e.target.value } })} /></td></tr>; })}</tbody></table></div>
              <div className="row"><button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => safe(() => api.enterCount(user.id, c.id, c.lines.map((l) => { const v = lineVal(c, l.itemId); return { itemId: l.itemId, countedQty: v.qty === "" ? null : Number(v.qty), note: v.note }; })), "Count saved")}>Save</button>
                <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => { api.enterCount(user.id, c.id, c.lines.map((l) => { const v = lineVal(c, l.itemId); return { itemId: l.itemId, countedQty: v.qty === "" ? null : Number(v.qty), note: v.note }; })); api.submitCount(user.id, c.id); }, "Count submitted for Finance approval")}>Submit for approval</button></div></>}
            {c.status !== "open" && <div className="row row--wrap sm muted">{c.lines.filter((l) => l.variance).map((l) => <Badge key={l.itemId} variant={l.variance > 0 ? "info" : "warning"}>{api.itemName(l.itemId)} {l.variance > 0 ? "+" : ""}{l.variance}</Badge>)}{!c.lines.some((l) => l.variance) && <span>no variances</span>}</div>}
          </div>)}
          {!counts.length && <Empty title="No counts yet" />}
          {canCount && !openCount && <form className="form" onSubmit={(e) => { e.preventDefault(); safe(() => { api.startCount(user.id, countLoc); }, "Count started — expected quantities snapshotted"); }}><select className="ns-input" value={countLoc} onChange={(e) => setCountLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><button className="ns-btn ns-btn--secondary" type="submit">Start a count</button></form>}
        </div></div>

      <div className="workspace" style={{ gridTemplateColumns: "2fr 1fr", marginTop: 20 }}>
        <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock ledger {focus && <span className="muted">· {api.itemName(focus)}</span>}</div>
          <select className="ns-input" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value as "" | MovementType)}><option value="">All types</option>{(Object.keys(MOVEMENT_LABEL) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}</select></div>
          {mv.length ? <table className="table ledger"><thead><tr><th>When</th><th>Type</th><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th><th>Project</th><th>Ref</th><th>Status</th></tr></thead>
            <tbody>{mv.map((m) => <tr key={m.id}><td className="sm">{relative(m.createdAt)}</td><td><Badge variant={m.movementType === "receipt" ? "success" : m.movementType === "issue" ? "info" : m.movementType === "write_off" ? "danger" : "warning"}>{MOVEMENT_LABEL[m.movementType]}</Badge></td>
              <td>{api.itemName(m.itemId)}</td><td className={`num ns-mono ${["issue", "write_off"].includes(m.movementType) ? "warn-cell" : ""}`}>{["issue", "write_off"].includes(m.movementType) ? "−" : "+"}{m.qty}</td><td className="num ns-mono">{naira(m.unitCost)}</td><td className="num ns-mono">{naira(m.totalCost)}</td>
              <td className="sm ns-mono">{api.projectCode(m.projectId)}</td><td className="sm muted">{m.sourceRef?.label}{m.reason ? ` · ${m.reason}` : ""}</td><td><ReviewBadge status={m.reviewStatus} /></td></tr>)}</tbody></table> : <div className="card__body"><Empty title="No movements" /></div>}</div>
        <div className="card"><div className="card__head"><div className="card__title">Write off stock</div><span className="sm muted">Finance approval{wVal >= dirThr ? " + Director" : ""}</span></div>
          <div className="card__body">{canWrite ? <form className="stack" onSubmit={(e) => { e.preventDefault(); if (safe(() => { const f = wFile[0]; const ev = api.addEvidence(user.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, caption: `Write-off evidence — ${wi?.name}` }); api.writeOff(user.id, { itemId: wItem, qty: wi?.isSerialised ? wSel.length : Number(wQty), serials: wSel, reason: wWhy, attachmentIds: [ev.id] }); }, "Write-off submitted for Finance approval")) { setWSel([]); setWWhy(""); setWFile([]); } }}>
            <label className="ns-field"><span className="ns-field__label">Item</span><select className="ns-input" value={wItem} onChange={(e) => { setWItem(e.target.value); setWSel([]); }}>{api.items.map((i) => <option key={i.id} value={i.id}>{i.name} — {api.available(i.id)} free</option>)}</select></label>
            {wi?.isSerialised ? <label className="ns-field"><span className="ns-field__label">Serials — select {wSel.length}</span><select className="ns-input select-multi" multiple value={wSel} onChange={(e) => setWSel(Array.from(e.target.selectedOptions).map((o) => o.value))}>{api.inStockSerials(wi.id).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              : <label className="ns-field"><span className="ns-field__label">Quantity</span><input className="ns-input" type="number" min={1} value={wQty} onChange={(e) => setWQty(e.target.value)} /></label>}
            <label className="ns-field"><span className="ns-field__label">Reason (required)</span><input className="ns-input" value={wWhy} onChange={(e) => setWWhy(e.target.value)} placeholder="Damaged in transit…" /></label>
            <label className="ns-field"><span className="ns-field__label">Photo (required)</span><FilePick picks={wFile} onChange={setWFile} required label="Choose photo" /></label>
            <div className="row"><button className="ns-btn ns-btn--danger" type="submit">Write off {naira(wVal)}</button></div>
          </form> : <Note tone="warn">Only the Store Keeper can raise a write-off.</Note>}</div></div>
      </div>
    </>
  );
}

/**
 * Items and vendors — the reference data everything else depends on. A PO needs a vendor, and stock only
 * enters the ledger against an item, so on an empty database this card is the first thing anyone uses.
 */
function Catalogue() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const may = api.can(user.id, "catalogue.manage");
  const [tab, setTab] = useState<"" | "item" | "vendor">("");
  const [sku, setSku] = useState(""); const [name, setName] = useState(""); const [cat, setCat] = useState<AssetType>("panel");
  const [unit, setUnit] = useState("pcs"); const [ser, setSer] = useState(false);
  const [lvl, setLvl] = useState("0"); const [rq, setRq] = useState("0"); const [vend, setVend] = useState("");
  const [vName, setVName] = useState(""); const [vCat, setVCat] = useState("");

  const head = <div className="card__head"><div className="card__title">Catalogue</div>
    <span className="sm muted">{api.items.length} item{api.items.length === 1 ? "" : "s"} · {api.vendors.length} vendor{api.vendors.length === 1 ? "" : "s"}</span></div>;

  if (!may) return <div className="card" style={{ marginBottom: 20 }}>{head}
    <div className="card__body"><Note tone="warn">Only a Director, Tech Lead or Store Keeper can change the catalogue.</Note></div></div>;

  if (!tab) return <div className="card" style={{ marginBottom: 20 }}>{head}
    <div className="card__body row" style={{ gap: 8 }}>
      <div className="grow sm muted">{api.items.length || api.vendors.length
        ? "Add the things you buy and the people you buy them from."
        : "Nothing here yet. A purchase order needs a vendor, and stock only enters the ledger against an item — so start here."}</div>
      <button className="ns-btn ns-btn--primary" onClick={() => setTab("item")}>＋ New item</button>
      <button className="ns-btn" onClick={() => setTab("vendor")}>＋ New vendor</button>
    </div></div>;

  return <div className="card" style={{ marginBottom: 20 }}>{head}
    <div className="card__body stack" style={{ gap: 12 }}>
      {tab === "item" ? <>
        <div className="form">
          <label className="ns-field"><span className="ns-field__label">SKU</span>
            <input className="ns-input" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="INV-5KW" /></label>
          <label className="ns-field"><span className="ns-field__label">Name</span>
            <input className="ns-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="5 kW hybrid inverter" /></label>
          <label className="ns-field"><span className="ns-field__label">Category</span>
            <select className="ns-input" value={cat} onChange={(e) => setCat(e.target.value as AssetType)}>{ASSET_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="ns-field"><span className="ns-field__label">Unit</span>
            <input className="ns-input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs" /></label>
          <label className="ns-field"><span className="ns-field__label">Reorder at</span>
            <input className="ns-input" type="number" min="0" value={lvl} onChange={(e) => setLvl(e.target.value)} /></label>
          <label className="ns-field"><span className="ns-field__label">Reorder qty</span>
            <input className="ns-input" type="number" min="0" value={rq} onChange={(e) => setRq(e.target.value)} /></label>
          <label className="ns-field"><span className="ns-field__label">Default vendor</span>
            <select className="ns-input" value={vend} onChange={(e) => setVend(e.target.value)}>
              <option value="">— none —</option>{api.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        </div>
        <label className="row sm" style={{ gap: 8 }}>
          <input type="checkbox" checked={ser} onChange={(e) => setSer(e.target.checked)} />
          <span>Track individual serial numbers — required for anything that carries a warranty</span></label>
        <div className="row" style={{ gap: 8 }}>
          <button className="ns-btn ns-btn--primary" disabled={!sku.trim() || !name.trim()}
            onClick={() => { if (safe(() => api.addItem(user.id, { sku, name, category: cat, unit, isSerialised: ser, reorderLevel: Number(lvl) || 0, reorderQty: Number(rq) || 0, defaultVendorId: vend || undefined }), `${name} added to the catalogue`)) { setSku(""); setName(""); setLvl("0"); setRq("0"); setSer(false); setTab(""); } }}>Add item</button>
          <button className="ns-btn ns-btn--ghost" onClick={() => setTab("")}>Cancel</button>
        </div>
      </> : <>
        <div className="form">
          <label className="ns-field"><span className="ns-field__label">Vendor name</span>
            <input className="ns-input" value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Dixsen Energy" /></label>
          <label className="ns-field"><span className="ns-field__label">What they supply</span>
            <input className="ns-input" value={vCat} onChange={(e) => setVCat(e.target.value)} placeholder="Inverters & batteries" /></label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="ns-btn ns-btn--primary" disabled={!vName.trim()}
            onClick={() => { if (safe(() => api.addVendor(user.id, { name: vName, category: vCat || undefined }), `${vName} added`)) { setVName(""); setVCat(""); setTab(""); } }}>Add vendor</button>
          <button className="ns-btn ns-btn--ghost" onClick={() => setTab("")}>Cancel</button>
        </div>
      </>}
    </div></div>;
}

type ReadLine = { description: string; qty: number; unit: string | null; unit_cost: number | null; serials: string[] };

/**
 * Upload a delivery note, let Claude read it, then map each line to a catalogue item and submit.
 *
 * The mapping step is the point. An extracted description is the supplier's words, not your SKU, so a
 * person picks the item — the model never decides what a line *is*, only what the page *says*.
 */
function ReceiveFromNote() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const may = api.can(user.id, "inventory.write");
  const locs = api.listLocations(); const mainLoc = api.mainLocationId();
  const [file, setFile] = useState<Pick[]>([]);
  const [extId, setExtId] = useState("");
  const [loc, setLoc] = useState(mainLoc ?? "");
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [qty, setQty] = useState<Record<number, string>>({});
  const [serials, setSerials] = useState<Record<number, string>>({});
  const [how, setHow] = useState<"upload" | "say">("upload");

  // Rendering nothing for someone without the permission hides the feature entirely — they cannot tell
  // it exists, let alone what to do about it. The sibling cards say why; so does this one.
  if (!may) return <div className="card" style={{ marginBottom: 20 }}>
    <div className="card__head"><div className="card__title">Receive stock from a delivery note</div>
      <span className="sm muted">read by Claude · every line still gets checked</span></div>
    <div className="card__body"><Note tone="warn">Only a Store Keeper can take stock in.
      Roles stack, so a Director can add <b>Store Keeper</b> to their own account under Users &amp; roles and do it themselves.</Note></div>
  </div>;

  // Resume on its own: the id lives in component state, so a refresh (or a different device) would
  // otherwise abandon a reading that has already been paid for and finished.
  const all = api.extractions ?? [];
  const ext = all.find((e) => e.id === extId)
    ?? all.find((e) => e.target === "stock_lines" && !["accepted", "rejected"].includes(e.status));
  useWaitFor(!!ext && (ext.status === "queued" || ext.status === "running"));
  const f = (ext?.fields ?? {}) as unknown as { reference?: string; supplier?: string; dated?: string; lines?: ReadLine[]; notes?: string; confidence?: string };
  const lines = f.lines ?? [];

  // Offer a best guess by word overlap, but never silently apply it — the select starts on the guess
  // and the store keeper confirms or changes it.
  const guess = (desc: string) => {
    const words = desc.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    let best = ""; let score = 0;
    for (const it of api.items) {
      const hay = `${it.sku} ${it.name} ${it.make ?? ""} ${it.model ?? ""}`.toLowerCase();
      const n = words.filter((w) => hay.includes(w)).length;
      if (n > score) { score = n; best = it.id; }
    }
    return score >= 1 ? best : "";
  };

  const itemFor = (i: number, l: ReadLine) => picked[i] ?? guess(l.description);

  const submit = () => {
    const payload = lines.map((l, i) => {
      const itemId = itemFor(i, l); if (!itemId) return null;
      const it = api.item(itemId);
      const ser = (serials[i] ?? l.serials.join("\n")).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      return { itemId, qty: Number(qty[i] ?? l.qty) || 0, unitCost: l.unit_cost ?? 0, serials: it.isSerialised ? ser : [] };
    }).filter(Boolean);
    if (!payload.length) return safe(() => { throw new Error("Match at least one line to a catalogue item"); }, "");
    if (safe(() => api.receiveStock(user.id, {
      locationId: loc, reason: f.reference ? `Delivery note ${f.reference}` : "Received from document",
      attachmentIds: [ext!.sourceId], lines: payload,
    }), "Submitted — each line is pending a check")) { setExtId(""); setFile([]); setPicked({}); setQty({}); setSerials({}); }
  };

  return <div className="card" style={{ marginBottom: 20 }}>
    <div className="card__head"><div className="card__title">Add stock</div>
      <span className="sm muted">upload the paperwork or just say what arrived · every line still gets checked by someone else</span></div>
    <div className="card__body stack" style={{ gap: 12 }}>
      {!ext ? <>
        <div className="row" style={{ gap: 8 }}>
          <button className={`ns-btn ${how === "upload" ? "ns-btn--primary" : ""}`} onClick={() => setHow("upload")}>Upload a document</button>
          <button className={`ns-btn ${how === "say" ? "ns-btn--primary" : ""}`} onClick={() => setHow("say")}>Say what arrived</button>
        </div>
        {how === "upload" ? <>
          <div className="sm muted">Waybill, delivery note, supplier invoice or a photo of one. Serial numbers are read off the page so nobody retypes them.</div>
          {/* Choosing the file IS the action — a separate "read it" button was just a second step
              that could only ever be pressed once, on a file already chosen. */}
          <FilePick picks={file} onChange={(picks) => {
            setFile(picks);
            const p0 = picks[0];
            if (!p0) return;
            safe(() => {
              const att = api.addEvidence(user.id, { fileName: p0.fileName, sizeBytes: p0.size, blob: p0.file, caption: "Delivery note" });
              const e = api.requestExtraction(user.id, "attachment", att.id, "stock_lines");
              setExtId(e.id);
            }, "Reading it — this takes a few seconds");
          }} required label="Delivery note or photo" />
        </> : <Dictate onDone={(text) => safe(() => { const e = api.requestExtraction(user.id, "dictation", "", "stock_lines", text); setExtId(e.id); }, "Working out what you said")} />}
      </> : ext.status === "queued" || ext.status === "running" ? <Note tone="info">Reading it… this usually takes under a minute.</Note>
      : ext.status === "failed" ? <Note tone="danger">Could not read it: {ext.error}
          <button className="ns-btn ns-btn--ghost ns-btn--sm" style={{ marginLeft: 8 }} onClick={() => { setExtId(""); setFile([]); }}>Start again</button></Note>
      : <>
        <div className="row sm" style={{ gap: 12 }}>
          <span><b>{f.reference || "no reference"}</b></span>
          {f.supplier && <span className="muted">{f.supplier}</span>}
          {f.dated && <span className="muted">{fmtDate(f.dated)}</span>}
          <Badge variant={f.confidence === "high" ? "success" : f.confidence === "low" ? "danger" : "warning"}>confidence {f.confidence}</Badge>
          <span className="grow" />
          <span className="muted">${ext.costUsd.toFixed(4)}</span>
        </div>
        {f.notes && <Note tone="warn">{f.notes}</Note>}
        <label className="ns-field" style={{ maxWidth: 280 }}><span className="ns-field__label">Into which location</span>
          <select className="ns-input" value={loc} onChange={(e) => setLoc(e.target.value)}>
            {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <div className="table--wrap"><table className="table"><thead><tr>
          <th>On the page</th><th>Catalogue item</th><th className="num">Qty</th><th>Serials</th></tr></thead>
          <tbody>{lines.map((l, i) => {
            const id = itemFor(i, l); const it = id ? api.item(id) : undefined;
            const need = it?.isSerialised ? Number(qty[i] ?? l.qty) || 0 : 0;
            const have = (serials[i] ?? l.serials.join("\n")).split(/[\n,]/).map((x) => x.trim()).filter(Boolean).length;
            return <tr key={i}>
              <td><div>{l.description}</div><div className="sm muted">{l.qty}{l.unit ? ` ${l.unit}` : ""}{l.unit_cost ? ` @ ${naira(l.unit_cost)}` : " · no price on the page"}</div></td>
              <td><select className="ns-input" value={id} onChange={(e) => setPicked({ ...picked, [i]: e.target.value })}>
                <option value="">— skip this line —</option>
                {api.items.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}</select>
                {!id && <div className="sm muted">no match — add it to the catalogue first</div>}</td>
              <td className="num" style={{ width: 90 }}><input className="ns-input" type="number" min="0" value={qty[i] ?? String(l.qty)} onChange={(e) => setQty({ ...qty, [i]: e.target.value })} /></td>
              <td style={{ minWidth: 200 }}>{it?.isSerialised
                ? <><textarea className="ns-input" rows={Math.max(2, l.serials.length)} value={serials[i] ?? l.serials.join("\n")} onChange={(e) => setSerials({ ...serials, [i]: e.target.value })} />
                    <div className={`sm ${have === need ? "muted" : "note--danger"}`}>{have} of {need} needed</div></>
                : <span className="sm muted">not serialised</span>}</td>
            </tr>; })}</tbody></table></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="ns-btn ns-btn--primary" onClick={submit}>Submit for check</button>
          <button className="ns-btn ns-btn--ghost" onClick={() => safe(() => { api.rejectExtraction(user.id, ext.id); setExtId(""); setFile([]); }, "Discarded")}>Discard</button>
        </div>
      </>}
    </div></div>;
}

/**
 * Speak the delivery instead of typing it. The phone transcribes locally and the words show as they are
 * said, so a mangled serial is caught while the speaker still remembers what it should be. They edit the
 * text before anything is sent — the recording is never the record.
 */
function Dictate({ onDone }: { onDone: (text: string) => void }) {
  const [text, setText] = useState("");
  const [live, setLive] = useState(false);
  const [err, setErr] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const supported = speechSupported();

  const start = () => {
    setErr(""); setLive(true);
    stopRef.current = listen((t, final) => { setText(t); if (final) setLive(false); },
                             (m) => { setErr(m); setLive(false); });
  };
  const stop = () => { stopRef.current?.(); setLive(false); };

  if (!supported) return <Note tone="warn">This browser cannot transcribe speech. Chrome, Edge and Safari can — or upload the delivery note instead.</Note>;

  return <div className="stack" style={{ gap: 10 }}>
    <div className="sm muted">Say what arrived — for example: <i>"three Deye six K inverters, serials delta yankee six K two four alpha zero zero eight one seven three nine one, … and twelve JA Solar five eighty watt panels"</i>. Read serials out slowly.</div>
    <div className="row" style={{ gap: 8 }}>
      {live
        ? <button className="ns-btn ns-btn--danger" onClick={stop}>■ Stop</button>
        : <button className="ns-btn ns-btn--primary" onClick={start}>● {text ? "Record more" : "Start recording"}</button>}
      {live && <span className="sm muted">listening…</span>}
    </div>
    {err && <Note tone="danger">{err}</Note>}
    <label className="ns-field"><span className="ns-field__label">What you said — correct anything it misheard</span>
      <textarea className="ns-input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Your words appear here as you speak, and you can edit them." /></label>
    <div><button className="ns-btn ns-btn--primary" disabled={live || text.trim().length < 10} onClick={() => onDone(text.trim())}>Turn this into stock lines</button></div>
  </div>;
}
