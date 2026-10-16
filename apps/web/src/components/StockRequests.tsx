import { useState } from "react";
import { Link } from "react-router-dom";
import { STOCK_REQUEST_STATUS_LABEL, fmtDate, naira, relative, type StockRequest, type StockRequestStatus } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Empty, Note } from "./ui";

const STATUS_VARIANT: Record<StockRequestStatus, "warning" | "success" | "danger" | "neutral"> = { requested: "warning", fulfilled: "success", declined: "danger", cancelled: "neutral" };

/**
 * A stock request as the store sees it: who wants what, for which project, how much of it is actually on the shelf.
 * "Hand over" is the whole fulfilment — there is no later check, because the requester and the store keeper are two
 * people already. Declining needs a reason the requester will read.
 */
export function RequestRow({ r, showProject }: { r: StockRequest; showProject?: boolean }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const isStore = api.can(user.id, "inventory.write");
  const [mode, setMode] = useState<"" | "fulfil" | "decline">("");
  const [qty, setQty] = useState<Record<string, string>>({}); const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState(""); const [why, setWhy] = useState("");
  const waiting = r.status === "requested";
  const supplied = (itemId: string) => { const it = api.item(itemId); return it.isSerialised ? (serials[itemId] ?? []).length : Number(qty[itemId] ?? Math.min(r.lines.find((l) => l.itemId === itemId)!.qty, api.available(itemId))) || 0; };
  const total = r.lines.reduce((s, l) => s + supplied(l.itemId) * api.wacOf(l.itemId), 0);
  const handOver = () => {
    const ok = safe(() => api.fulfilRequest(user.id, r.id, { lines: r.lines.map((l) => ({ itemId: l.itemId, qty: supplied(l.itemId), serials: api.item(l.itemId).isSerialised ? serials[l.itemId] ?? [] : undefined })), note }),
      "Handed over — stock and the project are updated");
    if (ok) setMode("");
  };
  return <div className={`req ${waiting ? "req--waiting" : ""}`}>
    <div className="row row--wrap req__head">
      {showProject && <Link to={`/projects/${r.projectId}/assets`} className="ns-mono sm">{api.projectCode(r.projectId)}</Link>}
      <b>{api.userName(r.requestedBy)}</b><span className="sm muted">asked {relative(r.requestedAt)}{r.neededBy ? ` · needed by ${fmtDate(r.neededBy)}` : ""}</span>
      <span className="grow" /><Badge variant={STATUS_VARIANT[r.status]}>{STOCK_REQUEST_STATUS_LABEL[r.status]}</Badge>
    </div>
    {r.note && <div className="sm">{r.note}</div>}
    <table className="table req__lines"><tbody>{r.lines.map((l) => { const it = api.item(l.itemId); const av = api.available(l.itemId); return <tr key={l.itemId}>
      <td>{it.name}</td>
      <td className="num ns-mono">{l.qty} {it.unit}</td>
      <td className="sm muted">{waiting ? (av >= l.qty ? `${av} in store` : <span className="note--danger">{av} in store — short</span>)
        : r.status === "fulfilled" ? `${l.suppliedQty ?? 0} supplied${(l.suppliedQty ?? 0) < l.qty ? " · short" : ""}${l.serials?.length ? ` · ${l.serials.join(", ")}` : ""}` : ""}</td>
      {mode === "fulfil" && <td style={{ minWidth: 200 }}>{it.isSerialised
        ? <select className="ns-input select-multi" multiple value={serials[l.itemId] ?? []} onChange={(e) => setSerials({ ...serials, [l.itemId]: Array.from(e.target.selectedOptions).map((o) => o.value) })} aria-label={`Serials for ${it.name}`}>
            {api.inStockSerials(l.itemId).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        : <input className="ns-input" type="number" min={0} max={Math.min(l.qty, av)} value={qty[l.itemId] ?? String(Math.min(l.qty, av))} onChange={(e) => setQty({ ...qty, [l.itemId]: e.target.value })} aria-label={`Supply ${it.name}`} />}</td>}
    </tr>; })}</tbody></table>
    {r.status === "fulfilled" && <div className="sm muted">Handed over by {api.userName(r.fulfilledBy)} {relative(r.fulfilledAt!)}{r.fulfilNote ? ` · “${r.fulfilNote}”` : ""}</div>}
    {r.status === "declined" && <div className="sm note--danger">Declined by {api.userName(r.resolvedBy)}: “{r.declineReason}”</div>}
    {r.status === "cancelled" && <div className="sm muted">Withdrawn by {api.userName(r.resolvedBy)}</div>}
    {waiting && mode === "" && <div className="row row--wrap" style={{ gap: 8 }}>
      {isStore && <><button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => setMode("fulfil")}>Hand over…</button>
        <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setMode("decline")}>Decline…</button></>}
      {(r.requestedBy === user.id || isStore) && <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.cancelRequest(user.id, r.id), "Request withdrawn")}>Withdraw</button>}
    </div>}
    {mode === "fulfil" && <div className="stack" style={{ gap: 8 }}>
      <input className="ns-input" placeholder="Note for the requester (optional) — e.g. 10 m short, rest on Friday" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row row--wrap" style={{ gap: 8 }}>
        <button className="ns-btn ns-btn--primary ns-btn--sm" disabled={!r.lines.some((l) => supplied(l.itemId) > 0)} onClick={handOver}>Hand over · {naira(total)} to the project</button>
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setMode("")}>Cancel</button>
        <span className="sm muted">This is the check: stock drops and the cost lands on the project now.</span></div>
    </div>}
    {mode === "decline" && <div className="row row--wrap" style={{ gap: 8 }}>
      <input className="ns-input grow" placeholder="Why — the requester will read this" value={why} onChange={(e) => setWhy(e.target.value)} />
      <button className="ns-btn ns-btn--danger ns-btn--sm" disabled={!why.trim()} onClick={() => { if (safe(() => api.declineRequest(user.id, r.id, why), "Declined")) setMode(""); }}>Decline</button>
      <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setMode("")}>Cancel</button>
    </div>}
  </div>;
}

/** The store's queue: what is waiting, then what was done lately. Sits above Add stock on Inventory. */
export function StockRequestsCard() {
  const api = useApi(); const { user } = useAuth();
  const [showDone, setShowDone] = useState(false);
  const waiting = api.listStockRequests({ status: "requested" });
  const done = api.listStockRequests().filter((r) => r.status !== "requested").slice(0, 10);
  if (!api.can(user.id, "inventory.write") && !waiting.some((r) => r.requestedBy === user.id)) return null;
  return <div className="card" style={{ marginBottom: 20 }}>
    <div className="card__head"><div className="card__title">Requests from the field{waiting.length ? ` · ${waiting.length} waiting` : ""}</div>
      <span className="sm muted">the team asks here or in Field mode · handing over is the check</span>
      <span className="grow" /><button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide done" : `Show done (${done.length})`}</button></div>
    <div className="card__body stack" style={{ gap: 12 }}>
      {waiting.length ? waiting.map((r) => <RequestRow key={r.id} r={r} showProject />) : <Empty title="Nothing waiting" hint="Requests from PMs and techs land here the moment they are raised." />}
      {showDone && done.map((r) => <RequestRow key={r.id} r={r} showProject />)}
    </div>
  </div>;
}

/** Ask the store for stock on this project — the desktop form. No serials, no WAC: the store decides what leaves the shelf. */
export function RequestForm({ projectId }: { projectId: string }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: api.items[0]?.id ?? "", qty: "1" }]);
  const [note, setNote] = useState(""); const [needed, setNeeded] = useState("");
  const submit = () => {
    const ok = safe(() => api.requestStock(user.id, projectId, { lines: lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })), note, neededBy: needed || undefined }),
      "Requested — the store keeper has been told");
    if (ok) { setLines([{ itemId: api.items[0]?.id ?? "", qty: "1" }]); setNote(""); setNeeded(""); }
  };
  return <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
    {lines.map((l, i) => <div key={i} className="row" style={{ gap: 8 }}>
      <select className="ns-input grow" value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))} aria-label="Item">
        {api.items.map((it) => <option key={it.id} value={it.id}>{it.name} — {api.available(it.id)} {it.unit} in store</option>)}</select>
      <input className="ns-input" style={{ width: 90 }} type="number" min={1} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} aria-label="Quantity" />
      {lines.length > 1 && <button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button>}
    </div>)}
    <div><button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setLines([...lines, { itemId: api.items[0]?.id ?? "", qty: "1" }])}>＋ Another item</button></div>
    <label className="ns-field"><span className="ns-field__label">What it is for</span><input className="ns-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Strings 1–3 on the east roof" /></label>
    <label className="ns-field" style={{ maxWidth: 200 }}><span className="ns-field__label">Needed by <span className="muted">· optional</span></span><input className="ns-input" type="date" value={needed} onChange={(e) => setNeeded(e.target.value)} /></label>
    <div className="row" style={{ gap: 10 }}><button className="ns-btn ns-btn--primary" type="submit" disabled={!lines.some((l) => l.itemId && Number(l.qty) > 0)}>Request from the store</button>
      <span className="sm muted">The store keeper hands over and the project updates itself.</span></div>
  </form>;
}

/** Requests on one project — everyone on it sees the status; the store acts from here too. */
export function ProjectRequests({ projectId }: { projectId: string }) {
  const api = useApi();
  const list = api.listStockRequests({ projectId });
  if (!list.length) return <Note tone="info">No stock requests on this project yet.</Note>;
  return <div className="stack" style={{ gap: 12 }}>{list.map((r) => <RequestRow key={r.id} r={r} />)}</div>;
}
