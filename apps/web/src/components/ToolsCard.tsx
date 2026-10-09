import { useState } from "react";
import { TOOL_CATEGORIES, naira } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { BarChart, type BarDatum } from "./charts";
import { Badge, Empty, Note } from "./ui";

const CAT_LABEL: Record<string, string> = { tool: "Tools", ppe: "PPE" };
const MONTH = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

/**
 * The operations team's own kit — bought for the team, held by a person, not issued to a project. Spend is what
 * came in (checked receipts in the Tools / PPE categories); the register is who holds what right now. Holders are
 * optional: a tool that stays in the store is simply in the store.
 */
export function ToolsCard() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const canAssign = api.can(user.id, "tools.assign");
  const tools = api.items.filter((i) => TOOL_CATEGORIES.includes(i.category) && i.isActive !== false);
  const spend = api.toolsSpend(12); const holdings = api.toolHoldings();
  const people = api.getUsers();
  const [mode, setMode] = useState<"" | "assign" | "handover" | "return">("");
  const [item, setItem] = useState(tools[0]?.id ?? ""); const [qty, setQty] = useState("1"); const [serials, setSerials] = useState<string[]>([]);
  const [who, setWho] = useState(people[0]?.id ?? ""); const [toWho, setToWho] = useState(people[1]?.id ?? people[0]?.id ?? ""); const [note, setNote] = useState("");
  const it = tools.find((t) => t.id === item);
  const inStore = it ? api.available(it.id) : 0;
  const holderQty = (userId: string) => (it ? holdings.filter((h) => h.itemId === it.id && h.userId === userId).reduce((s, h) => s + h.qtyOnHand, 0) : 0);
  const holderSerials = (userId: string) => holdings.filter((h) => it && h.itemId === it.id && h.userId === userId).flatMap((h) => h.serials);
  const bars: BarDatum[] = spend.byMonth.map((m) => ({ key: m.month, label: MONTH(m.month), value: m.amount, tone: "brand", note: `${MONTH(m.month)} — ${naira(m.amount)}` }));
  const reset = () => { setMode(""); setQty("1"); setSerials([]); setNote(""); };
  const submit = () => {
    const n = it?.isSerialised ? serials.length : Number(qty) || 0;
    const ok = safe(() => {
      if (mode === "assign") api.assignTool(user.id, { itemId: item, qty: n, serials: it?.isSerialised ? serials : undefined, userId: who, note });
      else if (mode === "handover") api.handOverTool(user.id, { itemId: item, qty: n, serials: it?.isSerialised ? serials : undefined, fromUserId: who, toUserId: toWho, note });
      else api.returnTool(user.id, { itemId: item, qty: n, serials: it?.isSerialised ? serials : undefined, userId: who, note });
    }, mode === "assign" ? "Handed out — pending check" : mode === "handover" ? "Handed over — pending check" : "Returned to store — pending check");
    if (ok) reset();
  };
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card__head"><div className="card__title">Tools & PPE</div>
        <div className="row row--wrap sm" style={{ gap: 12 }}><span className="muted">{tools.length} item{tools.length === 1 ? "" : "s"} · bought for the team, held by a person</span>
          {canAssign && tools.length > 0 && <>
            <button className={`ns-btn ns-btn--sm ${mode === "assign" ? "ns-btn--primary" : "ns-btn--secondary"}`} onClick={() => setMode(mode === "assign" ? "" : "assign")}>Hand out</button>
            <button className={`ns-btn ns-btn--sm ${mode === "handover" ? "ns-btn--primary" : "ns-btn--secondary"}`} onClick={() => setMode(mode === "handover" ? "" : "handover")}>Hand over</button>
            <button className={`ns-btn ns-btn--sm ${mode === "return" ? "ns-btn--primary" : "ns-btn--secondary"}`} onClick={() => setMode(mode === "return" ? "" : "return")}>Return</button></>}
        </div></div>
      <div className="money money--4b">
        <div className="money__cell"><div className="money__label">This month</div><div className="money__value">{naira(spend.thisMonth)}</div><div className="money__sub">tools and PPE received</div></div>
        <div className="money__cell"><div className="money__label">This year</div><div className="money__value">{naira(spend.ytd)}</div><div className="money__sub">{spend.count} receipt{spend.count === 1 ? "" : "s"}</div></div>
        {spend.byCategory.map((c) => <div key={c.category} className="money__cell"><div className="money__label">{CAT_LABEL[c.category]} · all time</div><div className="money__value">{naira(c.amount)}</div><div className="money__sub">{tools.filter((t) => t.category === c.category).length} item{tools.filter((t) => t.category === c.category).length === 1 ? "" : "s"}</div></div>)}
      </div>
      <div className="card__body stack" style={{ gap: 16 }}>
        {mode && it && <div className="note note--info stack" style={{ gap: 8 }}>
          <b>{mode === "assign" ? "Hand out from the store" : mode === "handover" ? "Hand over between people" : "Return to the store"}</b>
          <div className="form">
            <label className="ns-field"><span className="ns-field__label">Tool</span><select className="ns-input" value={item} onChange={(e) => { setItem(e.target.value); setSerials([]); }}>{tools.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSerialised ? " · serialised" : ""}</option>)}</select></label>
            <label className="ns-field"><span className="ns-field__label">{mode === "assign" ? "To" : mode === "handover" ? "From" : "From"}</span><select className="ns-input" value={who} onChange={(e) => { setWho(e.target.value); setSerials([]); }}>{people.map((u) => <option key={u.id} value={u.id}>{u.name}{mode !== "assign" && holderQty(u.id) ? ` · holds ${holderQty(u.id)}` : ""}</option>)}</select></label>
            {mode === "handover" && <label className="ns-field"><span className="ns-field__label">To</span><select className="ns-input" value={toWho} onChange={(e) => setToWho(e.target.value)}>{people.filter((u) => u.id !== who).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
            {it.isSerialised
              ? <label className="ns-field"><span className="ns-field__label">Serials — select {serials.length}</span><select className="ns-input select-multi" multiple value={serials} onChange={(e) => setSerials(Array.from(e.target.selectedOptions).map((o) => o.value))}>{(mode === "assign" ? api.inStockSerials(it.id) : holderSerials(who)).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              : <label className="ns-field"><span className="ns-field__label">Quantity <span className="muted">· {mode === "assign" ? `${inStore} in store` : `${holderQty(who)} with ${api.userName(who)}`}</span></span><input className="ns-input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
            <label className="ns-field"><span className="ns-field__label">Note <span className="muted">· optional</span></span><input className="ns-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for the Ikeja install" /></label>
          </div>
          <div className="row"><button className="ns-btn ns-btn--primary ns-btn--sm" disabled={it.isSerialised ? !serials.length : !(Number(qty) > 0)} onClick={submit}>{mode === "assign" ? "Hand out" : mode === "handover" ? "Hand over" : "Return"}</button><button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={reset}>Cancel</button>
            <span className="sm muted">Checked by Finance, a Tech Lead or the Store Keeper; value unchanged.</span></div>
        </div>}

        {tools.length === 0 ? <Note tone="info">Nothing in the Tools or PPE categories yet. Take tools in with <b>Add stock</b> above — upload the receipt, dictate it, or type it — and name them so they land as Tools or PPE (drill, multimeter, ladder, helmet, gloves…). Spend is counted the moment the receipt is checked.</Note> : <>
          <div className="workspace" style={{ gridTemplateColumns: "3fr 2fr", gap: 16 }}>
            <div>
              <div className="ns-overline">Who holds what</div>
              {holdings.length ? <div className="table--wrap"><table className="table"><thead><tr><th>Tool</th><th>Holder</th><th className="num">Qty</th><th>Serials</th></tr></thead>
                <tbody>{holdings.sort((a, b) => api.userName(a.userId).localeCompare(api.userName(b.userId))).map((h) => <tr key={`${h.itemId}-${h.locationId}`}><td>{api.itemName(h.itemId)} <Badge variant="neutral">{CAT_LABEL[api.item(h.itemId).category] ?? api.item(h.itemId).category}</Badge></td><td>{api.userName(h.userId)}</td><td className="num ns-mono">{h.qtyOnHand}</td><td className="sm ns-mono muted">{h.serials.join(", ") || "—"}</td></tr>)}</tbody></table></div>
                : <div className="sm muted">Nothing handed out yet — everything is in the store.</div>}
              <div className="ns-overline" style={{ marginTop: 14 }}>In the store</div>
              <div className="table--wrap"><table className="table"><thead><tr><th>Tool</th><th className="num">In store</th><th className="num">Unit cost</th></tr></thead>
                <tbody>{tools.map((t) => <tr key={t.id}><td>{t.name} <Badge variant="neutral">{CAT_LABEL[t.category] ?? t.category}</Badge></td><td className="num ns-mono">{api.available(t.id)} {t.unit}</td><td className="num ns-mono">{naira(api.wacOf(t.id))}</td></tr>)}</tbody></table></div>
            </div>
            <div>
              <div className="ns-overline">Spend by month</div>
              {spend.total > 0 ? <BarChart data={bars} format={(n) => naira(n, true)} emptyLabel="No tool receipts yet" /> : <Empty title="No spend yet" hint="Counts when a tools receipt is checked." />}
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
