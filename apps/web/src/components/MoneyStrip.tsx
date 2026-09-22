import { VAT_TREATMENT_LABEL, naira, pct, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Bar, Note } from "./ui";

/**
 * The rule that keeps money legible: NET is the number, always. The gross appears once, labelled, beneath it.
 * VAT has its own cell — due, settled, outstanding — so the liability is never a mystery hidden inside a total.
 * Budget percentage is against the net contract, which is the only base on which margin means anything.
 */
export function MoneyStrip({ p }: { p: Project }) {
  const api = useApi(); const { user } = useAuth();
  const exempt = p.vatTreatment === "exempt";
  const contract = (
    <div className="money__cell"><div className="money__label">Contract (net of VAT)</div><div className="money__value">{naira(p.contractValueNet)}</div>
      <div className="money__sub">{exempt ? "VAT exempt / zero-rated" : <>+ {naira(p.vatAmount, true)} VAT {p.vatRate}% = <b>{naira(p.contractValue, true)}</b> gross</>}</div></div>
  );
  // Roles without money.read receive no cost data at all, so every figure here would render as zero.
  // Say so plainly rather than showing a budget that looks untouched.
  if (!api.can(user.id, "money.read")) {
    return <div className="money money--5">{contract}
      <div className="money__cell money__cell--wide"><Note tone="info">Budget, VAT, commitments and actuals are visible to Finance, Tech Leads, Directors and Auditors.</Note></div></div>;
  }
  const m = api.money(p.id);
  const settledPct = m.vatDue > 0 ? Math.round(m.vatSettled / m.vatDue * 100) : 0;
  return (
    <div className="money money--5">
      {contract}
      <div className="money__cell"><div className="money__label">VAT {exempt ? "" : `${p.vatRate}%`}</div>
        {exempt ? <><div className="money__value muted">—</div><div className="money__sub">{VAT_TREATMENT_LABEL[p.vatTreatment]}</div></> : <>
          <div className="money__value">{naira(m.vatDue)} <span className="sm muted" style={{ fontWeight: 400 }}>due</span></div>
          <div className="money__sub row" style={{ gap: 6 }}><Bar pct={settledPct} /> {naira(m.vatSettled, true)} settled · <b className={m.vatOutstanding > 0 ? "warn-text" : ""}>{naira(m.vatOutstanding, true)} outstanding</b></div>
          {m.vatCollected > 0 && <div className="money__sub">{naira(m.vatCollected, true)} collected from client — still to remit</div>}
          {p.vatTreatment === "withheld_by_client" && <div className="money__sub">client withholds and remits to FIRS</div>}
        </>}
      </div>
      <div className="money__cell"><div className="money__label">Planned budget</div><div className="money__value">{m.planned ? naira(m.planned) : "—"}</div><div className="money__sub">{m.planned ? `${pct(m.planned, m.contractNet)}% of net contract${m.changeOrders ? ` · +${naira(m.changeOrders, true)} COs` : ""}` : "No checked budget lines"}</div></div>
      <div className="money__cell"><div className="money__label">Committed (POs)</div><div className="money__value">{naira(m.committed)}</div><div className="money__sub">{m.planned ? `${pct(m.committed, m.planned)}% of budget` : "—"}</div></div>
      <div className="money__cell"><div className="money__label">Actual (checked)</div><div className="money__value">{naira(m.actual)}</div>
        <div className="money__sub row"><Bar pct={m.burnPct} /> {m.burnPct}% · {m.variance >= 0 ? `${naira(m.variance, true)} headroom` : `${naira(-m.variance, true)} over`}</div>
        <div className="money__sub">Retention {p.retentionPercent}% of net{m.retentionHeld ? ` · ${naira(m.retentionHeld, true)} held` : ""}</div></div>
    </div>
  );
}
