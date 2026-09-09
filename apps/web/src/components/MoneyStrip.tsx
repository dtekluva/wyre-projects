import { naira, pct, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { Bar } from "./ui";
export function MoneyStrip({ p }: { p: Project }) {
  const api = useApi(); const m = api.money(p.id);
  return (
    <div className="money">
      <div className="money__cell"><div className="money__label">Contract value</div><div className="money__value">{naira(p.contractValue)}</div><div className="money__sub">Retention {p.retentionPercent}%{m.retentionHeld ? ` · ${naira(m.retentionHeld, true)} held` : ""}</div></div>
      <div className="money__cell"><div className="money__label">Planned budget</div><div className="money__value">{m.planned ? naira(m.planned) : "—"}</div><div className="money__sub">{m.planned ? `${pct(m.planned, p.contractValue)}% of contract${m.changeOrders ? ` · +${naira(m.changeOrders, true)} COs` : ""}` : "No checked budget lines"}</div></div>
      <div className="money__cell"><div className="money__label">Committed (POs)</div><div className="money__value">{naira(m.committed)}</div><div className="money__sub">{m.planned ? `${pct(m.committed, m.planned)}% of budget` : "—"}</div></div>
      <div className="money__cell"><div className="money__label">Actual (checked)</div><div className="money__value">{naira(m.actual)}</div>
        <div className="money__sub row"><Bar pct={m.burnPct} /> {m.burnPct}% · {m.variance >= 0 ? `${naira(m.variance, true)} headroom` : `${naira(-m.variance, true)} over`}</div></div>
    </div>
  );
}
