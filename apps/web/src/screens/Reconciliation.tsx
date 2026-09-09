import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, naira } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, Kpi, Note } from "../components/ui";

export function Reconciliation() {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  if (!api.can(user.id, "recon.read")) return <Note tone="danger">Your role cannot view reconciliation.</Note>;
  const bills = api.listQbBills(); const canWrite = api.can(user.id, "recon.write");
  const [pick, setPick] = useState<Record<string, string>>({});
  const un = bills.filter((b) => b.confidence !== "matched");
  return (
    <>
      <div className="page-head"><div><h1 className="page-title">QuickBooks reconciliation</h1><div className="page-sub">Bills synced from QB matched to approved POs — vendor + amount within 1% auto-matches; the rest need a human</div></div></div>
      <div className="kpis">
        <Kpi label="Bills synced" value={bills.length} sub={`last sync ${fmtDate(bills[0]?.syncedAt)}`} />
        <Kpi label="Unmatched / suggested" value={un.length} sub={naira(un.reduce((s, b) => s + b.totalAmount, 0), true)} tone={un.length ? "warn" : undefined} />
        <Kpi label="Matched" value={bills.length - un.length} sub={naira(bills.filter((b) => b.confidence === "matched").reduce((s, b) => s + b.totalAmount, 0), true)} />
        <Kpi label="AP outstanding" value={naira(bills.reduce((s, b) => s + b.balance, 0), true)} sub="unpaid balance" />
      </div>
      <div className="card table--wrap"><table className="table ledger"><thead><tr><th>Bill</th><th>Vendor</th><th>Project</th><th className="num">Amount</th><th className="num">Balance</th><th>Due</th><th>Match</th><th>Note</th>{canWrite && <th></th>}</tr></thead>
        <tbody>{bills.map((b) => { const pos = api.listPOs(b.projectId).filter((p) => !["pending_approval", "rejected"].includes(p.status)); return <tr key={b.id}>
          <td className="ns-mono">{b.docNumber}<div className="sm muted">{fmtDate(b.txnDate)}</div></td><td>{b.vendorName}</td><td className="sm">{b.projectId ? <Link className="link" to={`/projects/${b.projectId}/money`}>{api.projectCode(b.projectId)}</Link> : <span className="muted">—</span>}</td>
          <td className="num ns-mono">{naira(b.totalAmount)}</td><td className={`num ns-mono ${b.balance ? "" : "muted"}`}>{naira(b.balance)}</td><td className="sm">{fmtDate(b.dueDate)}</td>
          <td><Badge variant={b.confidence === "matched" ? "success" : b.confidence === "suggested" ? "warning" : "danger"}>{b.confidence}{b.poNumber ? ` · ${b.poNumber}` : ""}</Badge></td><td className="sm muted">{b.note}</td>
          {canWrite && <td className="num">{b.matchStatus === "matched" ? <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.unmatchBill(user.id, b.id), "Unmatched")}>Unmatch</button>
            : b.confidence === "matched" ? <span className="sm muted">auto</span> : <span className="row"><select className="ns-input" style={{ minHeight: 32, width: "auto" }} value={pick[b.id] ?? b.poId ?? ""} onChange={(e) => setPick({ ...pick, [b.id]: e.target.value })}><option value="">PO…</option>{pos.map((p) => <option key={p.id} value={p.id}>{p.poNumber} · {naira(p.total, true)}</option>)}</select>
              <button className="ns-btn ns-btn--primary ns-btn--sm" disabled={!(pick[b.id] ?? b.poId)} onClick={() => safe(() => api.matchBill(user.id, b.id, pick[b.id] ?? b.poId!), "Matched")}>Match</button></span>}</td>}
        </tr>; })}</tbody></table></div>
    </>
  );
}
