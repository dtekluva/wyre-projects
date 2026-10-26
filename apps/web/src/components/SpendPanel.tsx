import { COST_CATEGORY_LABEL, fmtDate, naira, spendInRange, type DateRange } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { Thumbs } from "./Thumbs";
import { Badge, Empty } from "./ui";

const csvCell = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * What was spent in the chosen period — for Mr. Bidemi's spend tracking (Mr. Idris, 2026-10-26). Checked actuals only:
 * goods receipts count on the day they were checked, expenses on the day the money left. Expenses still waiting for
 * Finance are shown apart, so the total never moves under anyone's feet.
 */
export function SpendPanel({ range, projectIds, label }: { range: DateRange; projectIds: Set<string>; label: string }) {
  const api = useApi();
  const s = spendInRange(api, range, projectIds);
  const pname = (id: string) => api.projects.find((p) => p.id === id)?.name ?? api.projectCode(id);
  const download = () => {
    const rows = [["Date", "Project code", "Project", "What", "Category", "Source", "Amount (NGN)", "Status"],
      ...[...s.lines, ...s.pending].map((l) => [l.date.slice(0, 10), api.projectCode(l.projectId), pname(l.projectId), l.label, COST_CATEGORY_LABEL[l.category], l.source.replace("_", " "), l.amount, l.status === "pending" ? "pending Finance check" : "checked"])];
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `wyre-spend-${range.from ?? "start"}-to-${range.to ?? "today"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return <div className="spend">
    <div className="money money--4b">
      <div className="money__cell"><div className="money__label">Spent · {label}</div><div className="money__value">{naira(s.total)}</div><div className="money__sub">{s.lines.length} checked line{s.lines.length === 1 ? "" : "s"}</div></div>
      <div className="money__cell"><div className="money__label">Projects</div><div className="money__value">{s.byProject.length}</div><div className="money__sub">{s.byProject[0] ? `most: ${pname(s.byProject[0].projectId)}` : "none"}</div></div>
      <div className="money__cell"><div className="money__label">Biggest category</div><div className="money__value">{s.byCategory[0] ? COST_CATEGORY_LABEL[s.byCategory[0].category] : "—"}</div><div className="money__sub">{s.byCategory[0] ? naira(s.byCategory[0].amount) : "nothing spent"}</div></div>
      <div className="money__cell"><div className="money__label">Waiting for Finance</div><div className="money__value">{naira(s.pendingTotal)}</div><div className="money__sub">{s.pending.length} expense{s.pending.length === 1 ? "" : "s"} not yet counted</div></div>
    </div>
    {s.lines.length + s.pending.length === 0 ? <Empty title="Nothing spent in this period" hint="Checked goods receipts, issued stock, visits and expenses count here." /> : <>
      <div className="spend__split">
        <table className="table"><thead><tr><th>By category</th><th className="num">Spent</th></tr></thead>
          <tbody>{s.byCategory.map((c) => <tr key={c.category}><td>{COST_CATEGORY_LABEL[c.category]}</td><td className="num ns-mono">{naira(c.amount)}</td></tr>)}</tbody></table>
        <table className="table"><thead><tr><th>By project</th><th className="num">Spent</th></tr></thead>
          <tbody>{s.byProject.map((p) => <tr key={p.projectId}><td>{pname(p.projectId)}</td><td className="num ns-mono">{naira(p.amount)}</td></tr>)}</tbody></table>
      </div>
      <div className="row" style={{ justifyContent: "space-between", margin: "12px 0 6px" }}><div className="ns-overline">Every line</div>
        <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={download}>Download CSV</button></div>
      <div className="table--wrap"><table className="table ledger"><thead><tr><th>Date</th><th>Project</th><th>What</th><th>Category</th><th className="num">Amount</th><th>Receipt</th><th>Status</th></tr></thead>
        <tbody>{[...s.lines, ...s.pending].map((l, i) => <tr key={i}><td className="sm">{fmtDate(l.date)}</td><td className="sm">{pname(l.projectId)}</td><td>{l.label}<div className="sm muted">{l.source.replace("_", " ")}</div></td>
          <td className="sm">{COST_CATEGORY_LABEL[l.category]}</td><td className="num ns-mono">{naira(l.amount)}</td><td>{l.attachmentIds.length ? <Thumbs ids={l.attachmentIds} /> : <span className="sm muted">—</span>}</td>
          <td>{l.status === "pending" ? <Badge variant="warning">waiting for Finance</Badge> : <Badge variant="success">checked</Badge>}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
