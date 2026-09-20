import { useRef, useState } from "react";
import { FilePick, type Pick } from "../components/FilePick";
import { MOVEMENT_LABEL, fmtDate, naira, relative, type MovementType, type StockCount } from "@wyre/api";
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

      <ReceiveFromNote />
      <div className="card table--wrap"><div className="card__head"><div className="card__title">Stock on hand</div><span className="sm muted">click a row to filter the ledger</span></div>
        <table className="table"><thead><tr><th>SKU</th><th>Item</th><th>Category</th><th className="num">On hand</th><th className="num">Unit cost</th><th className="num">Value</th><th className="num">Reorder at</th><th></th></tr></thead>
          <tbody>{api.items.map((it) => { 
            // An item exists the moment stock is submitted, but its movement is still PENDING, so it has
            // no balance row yet. The old `!` assertion crashed the entire page on that first submit —
            // TypeScript believed it, the browser did not.
            const b = bal.find((x) => x.itemId === it.id)
              ?? { itemId: it.id, locationId: mainLoc ?? "", qtyOnHand: 0, wacUnitCost: 0, value: 0, belowReorder: false };
           const av = api.available(it.id); return <tr key={it.id} onClick={() => setFocus(focus === it.id ? "" : it.id)} style={{ cursor: "pointer", background: focus === it.id ? "var(--ns-color-surface-selected)" : undefined }}>
            <td className="ns-mono sm">{it.sku}</td><td>{it.name}{it.isSerialised && <span className="sm muted"> · serialised</span>}</td><td className="sm">{it.category}</td>
            <td className="num ns-mono">{b.qtyOnHand} {it.unit}{av !== b.qtyOnHand && <div className="sm muted">{av} free</div>}</td><td className="num ns-mono">{naira(b.wacUnitCost)}</td><td className="num ns-mono">{naira(b.value)}</td><td className="num ns-mono muted">{it.reorderLevel}</td>
            <td>{b.qtyOnHand === 0 && av === 0 ? <Badge variant="neutral">awaiting check</Badge> : b.belowReorder ? <Badge variant="danger">reorder {it.reorderQty}</Badge> : b.qtyOnHand <= it.reorderLevel * 1.5 ? <Badge variant="warning">low</Badge> : null}</td></tr>; })}</tbody></table></div>

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
              <td className="sm ns-mono">{api.projectCode(m.projectId)}</td><td className="sm muted">{m.sourceRef?.label}{m.reason ? ` · ${m.reason}` : ""}</td>
                <td><span className="row" style={{ gap: 6 }}><ReviewBadge status={m.reviewStatus} />
                  {/* The ledger is where a store keeper already is. Making them find the Review queue to
                      act on a row they are looking at is a navigation puzzle, not a control. */}
                  {m.reviewStatus === "pending" && api.can(user.id, "inventory.check", m.projectId) &&
                    <button className="ns-btn ns-btn--primary ns-btn--sm"
                            onClick={() => safe(() => api.check("stock_movement", m.id, user.id, "checked"), "Checked — stock updated")}>✓ Check</button>}
                </span></td></tr>)}</tbody></table> : <div className="card__body"><Empty title="No movements" /></div>}</div>
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

type ReadLine = { description: string; qty: number; unit: string | null; unit_cost: number | null; serials: string[]; matches_existing?: string | null };

/**
 * Add stock: upload the paperwork, say it, or type it.
 *
 * There is no catalogue to keep. A line carries a NAME — the first time a name arrives the server starts
 * tracking it, and every later delivery of the same name adds to the same pile. Nobody registers anything
 * in advance, which is the whole point: the item list is a record of what has come through the door.
 */
function ReceiveFromNote() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const may = api.can(user.id, "inventory.write");
  const locs = api.listLocations(); const mainLoc = api.mainLocationId();
  const [file, setFile] = useState<Pick[]>([]);
  const [extId, setExtId] = useState("");
  const [loc, setLoc] = useState(mainLoc ?? "");
  const [how, setHow] = useState<"upload" | "say" | "type">("upload");
  const [names, setNames] = useState<Record<number, string>>({});
  const [qty, setQty] = useState<Record<number, string>>({});
  const [serials, setSerials] = useState<Record<number, string>>({});
  const [costs, setCosts] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState<ReadLine[]>([]);

  const all = api.extractions ?? [];
  const ext = all.find((e) => e.id === extId)
    ?? all.find((e) => e.target === "stock_lines" && !["accepted", "rejected"].includes(e.status));
  useWaitFor(!!ext && (ext.status === "queued" || ext.status === "running"));

  if (!may) return <div className="card" style={{ marginBottom: 20 }}>
    <div className="card__head"><div className="card__title">Add stock</div></div>
    <div className="card__body"><Note tone="warn">Only a Store Keeper can take stock in.
      Roles stack, so a Director can add <b>Store Keeper</b> to their own account under Users &amp; roles.</Note></div>
  </div>;

  const f = (ext?.fields ?? {}) as unknown as { reference?: string; supplier?: string; dated?: string; lines?: ReadLine[]; notes?: string; confidence?: string };
  const lines: ReadLine[] = typed.length ? typed : (f.lines ?? []);
  const reviewing = typed.length > 0 || (ext?.status === "done");

  const reset = () => { setExtId(""); setFile([]); setNames({}); setQty({}); setSerials({}); setCosts({}); setTyped([]); };

  const submit = () => {
    const payload = lines.map((l, i) => {
      const name = (names[i] ?? l.description).trim(); if (!name) return null;
      const ser = (serials[i] ?? l.serials.join("\n")).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      return { name, unit: l.unit ?? "", qty: Number(qty[i] ?? l.qty) || 0, unitCost: Number(costs[i] ?? l.unit_cost ?? 0) || 0, serials: ser };
    }).filter(Boolean);
    if (!payload.length) return safe(() => { throw new Error("Give at least one line a name"); }, "");
    const ok = safe(() => api.receiveStock(user.id, {
      locationId: loc,
      reason: f.reference ? `Delivery note ${f.reference}` : typed.length ? "Entered by hand" : "Received from document",
      attachmentIds: ext?.sourceId ? [ext.sourceId] : ["typed"],
      lines: payload,
    }), "Submitted — each line is pending a check");
    if (!ok) return;
    // Best-effort tidy-up: the snapshot that comes back from receiveStock may already have moved this
    // row on, and a failure here must not take the page down after the stock has been accepted.
    if (ext) { try { api.rejectExtraction(user.id, ext.id); } catch { /* already gone */ } }
    reset();
  };

  return <div className="card" style={{ marginBottom: 20 }}>
    <div className="card__head"><div className="card__title">Add stock</div>
      <span className="sm muted">upload the paperwork, say it, or type it · every line still gets checked by someone else</span></div>
    <div className="card__body stack" style={{ gap: 12 }}>
      {!reviewing && !ext ? <>
        <div className="row" style={{ gap: 8 }}>
          <button className={`ns-btn ${how === "upload" ? "ns-btn--primary" : ""}`} onClick={() => setHow("upload")}>Upload a document</button>
          <button className={`ns-btn ${how === "say" ? "ns-btn--primary" : ""}`} onClick={() => setHow("say")}>Say what arrived</button>
          <button className={`ns-btn ${how === "type" ? "ns-btn--primary" : ""}`} onClick={() => { setHow("type"); setTyped([{ description: "", qty: 1, unit: "pcs", unit_cost: null, serials: [] }]); }}>Type it in</button>
        </div>
        {how === "upload" ? <>
          <div className="sm muted">Waybill, delivery note, supplier invoice or a photo of one. Serial numbers are read off the page so nobody retypes them.</div>
          <FilePick picks={file} onChange={(picks) => {
            setFile(picks);
            const p0 = picks[0]; if (!p0) return;
            safe(() => {
              const att = api.addEvidence(user.id, { fileName: p0.fileName, sizeBytes: p0.size, blob: p0.file, caption: "Delivery note" });
              setExtId(api.requestExtraction(user.id, "attachment", att.id, "stock_lines").id);
            }, "Reading it — this usually takes under a minute");
          }} required label="Delivery note or photo" />
        </> : how === "say" ? <Dictate onDone={(text) => safe(() => { setExtId(api.requestExtraction(user.id, "dictation", "", "stock_lines", text).id); }, "Working out what you said")} />
        : null}
      </> : ext && (ext.status === "queued" || ext.status === "running") ? <Note tone="info">Reading it… this usually takes under a minute.</Note>
      : ext && ext.status === "failed" ? <Note tone="danger">Could not read it: {ext.error}
          <button className="ns-btn ns-btn--ghost ns-btn--sm" style={{ marginLeft: 8 }} onClick={() => { safe(() => api.rejectExtraction(user.id, ext.id), "Discarded"); reset(); }}>Start again</button></Note>
      : <>
        {ext && <div className="row sm" style={{ gap: 12 }}>
          <span><b>{f.reference || "from your recording"}</b></span>
          {f.supplier && <span className="muted">{f.supplier}</span>}
          {f.dated && <span className="muted">{fmtDate(f.dated)}</span>}
          <Badge variant={f.confidence === "high" ? "success" : f.confidence === "low" ? "danger" : "warning"}>confidence {f.confidence}</Badge>
          <span className="grow" /><span className="muted">${ext.costUsd.toFixed(4)}</span>
        </div>}
        {f.notes && <Note tone="warn">{f.notes}</Note>}
        <label className="ns-field" style={{ maxWidth: 280 }}><span className="ns-field__label">Into which location</span>
          <select className="ns-input" value={loc} onChange={(e) => setLoc(e.target.value)}>
            {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <div className="table--wrap"><table className="table table--entry"><thead><tr>
          <th>What it is</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit cost</th><th className="num">Line total</th><th>Serial numbers</th></tr></thead>
          <tbody>{lines.map((l, i) => {
            // The model is told what is already in stock and returns the existing name when a line is
            // the same product written differently, so a second delivery lands on the same pile.
            const name = names[i] ?? l.matches_existing ?? l.description;
            const ser = (serials[i] ?? l.serials.join("\n")).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
            const n = Number(qty[i] ?? l.qty) || 0;
            const known = api.items.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
            return <tr key={i}>
              <td style={{ minWidth: 240 }}>
                <input className="ns-input" value={name} placeholder="e.g. Deye inverter 20kVA" onChange={(e) => setNames({ ...names, [i]: e.target.value })} />
                <div className="sm muted">{!name.trim() ? "name it"
                  : known ? `adds to your existing ${known.name}`
                  : "new — tracked from now on"}
                  {l.matches_existing && l.matches_existing !== l.description ? ` · page said "${l.description}"` : ""}
                  {l.unit_cost ? ` · ${naira(l.unit_cost)} each` : ""}</div></td>
              <td className="num" style={{ width: 90 }}><input className="ns-input" type="number" min="0" value={qty[i] ?? String(l.qty)} onChange={(e) => setQty({ ...qty, [i]: e.target.value })} /></td>
              <td className="sm cell-mid" style={{ width: 70 }}>{l.unit || "pcs"}</td>
              <td className="num" style={{ width: 120 }}>
                <input className="ns-input" type="number" min="0" step="0.01" placeholder="0"
                       value={costs[i] ?? (l.unit_cost != null ? String(l.unit_cost) : "")}
                       onChange={(e) => setCosts({ ...costs, [i]: e.target.value })} />
                {/* A price of zero is legal — a donation, a sample — but it makes the running average
                    cost meaningless for that item, so say so rather than letting it pass unremarked. */}
                {!(Number(costs[i] ?? l.unit_cost ?? 0) > 0) && <div className="sm muted">no price</div>}</td>
              <td className="num ns-mono cell-mid" style={{ width: 110 }}>{naira((Number(costs[i] ?? l.unit_cost ?? 0) || 0) * n)}</td>
              <td style={{ minWidth: 200 }}>
                <textarea className="ns-input" rows={Math.max(1, l.serials.length)} placeholder="one per line, if any"
                          value={serials[i] ?? l.serials.join("\n")} onChange={(e) => setSerials({ ...serials, [i]: e.target.value })} />
                {ser.length > 0 && ser.length !== n && <div className="sm note--danger">{ser.length} serial{ser.length === 1 ? "" : "s"} for {n}</div>}</td>
            </tr>; })}</tbody></table></div>
        <div className="row" style={{ gap: 8 }}>
          {typed.length > 0 && <button className="ns-btn ns-btn--ghost" onClick={() => setTyped([...typed, { description: "", qty: 1, unit: "pcs", unit_cost: null, serials: [] }])}>＋ Another line</button>}
          <span className="grow sm muted">Total {naira(lines.reduce((t, l, i) => t + (Number(costs[i] ?? l.unit_cost ?? 0) || 0) * (Number(qty[i] ?? l.qty) || 0), 0))}</span>
          <button className="ns-btn ns-btn--primary" onClick={submit}>Submit for check</button>
          <button className="ns-btn ns-btn--ghost" onClick={() => { if (ext) safe(() => api.rejectExtraction(user.id, ext.id), "Discarded"); reset(); }}>Discard</button>
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
