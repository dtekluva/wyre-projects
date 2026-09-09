import { naira, pct, type Project } from "@wyre/api";
import { Bar } from "./ui";
export function MoneyStrip({ p }: { p: Project }) {
  const burn = pct(p.actual, p.approvedBudget); const variance = p.approvedBudget - p.actual;
  return (
    <div className="money">
      <div className="money__cell"><div className="money__label">Contract value</div><div className="money__value">{naira(p.contractValue)}</div><div className="money__sub">Retention {p.retentionPercent}% · {naira(p.contractValue * p.retentionPercent / 100)}</div></div>
      <div className="money__cell"><div className="money__label">Approved budget</div><div className="money__value">{p.approvedBudget ? naira(p.approvedBudget) : "—"}</div><div className="money__sub">{p.approvedBudget ? `${pct(p.approvedBudget, p.contractValue)}% of contract` : "Not yet approved"}</div></div>
      <div className="money__cell"><div className="money__label">Committed (POs)</div><div className="money__value">{naira(p.committed)}</div><div className="money__sub">{pct(p.committed, p.approvedBudget)}% of budget</div></div>
      <div className="money__cell"><div className="money__label">Actual (checked)</div><div className="money__value">{naira(p.actual)}</div>
        <div className="money__sub row"><Bar pct={burn} /> {burn}% · {variance >= 0 ? `${naira(variance, true)} headroom` : `${naira(-variance, true)} over`}</div></div>
    </div>
  );
}
