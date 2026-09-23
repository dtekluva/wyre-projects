import { useState } from "react";
import { naira, pct, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Note } from "./ui";
import { VatModal } from "./VatModal";
import { CommercialsModal } from "./CommercialsModal";

/**
 * Five cells, one number each, one line beneath, at most one bar — on its own line — and no "·" chains.
 * Qualifiers ("net of VAT", "checked", "approved POs") live in hover text, not in labels, so nothing wraps.
 * Net is the number; the gross appears exactly once, under Contract. VAT leads with the figure someone acts on.
 */
export function MoneyStrip({ p }: { p: Project }) {
  const api = useApi(); const { user } = useAuth();
  const [vatOpen, setVatOpen] = useState(false); const [comOpen, setComOpen] = useState(false);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const draft = p.contractStatus === "draft";
  const exempt = p.vatTreatment === "exempt";
  const contract = (
    <button type="button" className="money__cell money__cell--btn" onClick={() => setComOpen(true)} title={`${draft ? "Draft — contract not yet received. " : ""}Net of VAT. ${exempt ? "VAT exempt / zero-rated." : `VAT ${p.vatRate}% = ${naira(p.vatAmount)}; gross ${naira(p.contractValue)}.`} Click to view or edit.`}>
      <div className="money__label">Contract (net) {draft ? <span className="money__pip">draft</span> : <span className="money__chev">›</span>}</div>
      <div className="money__value">{naira(p.contractValueNet)}</div>
      <div className="money__sub">{exempt ? "VAT exempt" : `${naira(p.contractValue, true)} incl. VAT`}</div>
    </button>
  );
  // Roles without money.read receive no cost data at all, so every other figure would render as zero.
  if (!api.can(user.id, "money.read")) {
    return <div className="money money--5">{contract}
      <div className="money__cell money__cell--wide"><Note tone="info">Budget, VAT, commitments and spend are visible to Finance, Tech Leads, Directors and Auditors.</Note></div>
      {comOpen && <CommercialsModal p={p} onClose={() => setComOpen(false)} />}</div>;
  }
  const m = api.money(p.id);
  const paidPct = m.vatDue > 0 ? Math.round(m.vatSettled / m.vatDue * 100) : 0;
  const committedPct = m.planned ? pct(m.committed, m.planned) : 0;
  const over = m.variance < 0;
  return (
    <div className="money money--5">
      {contract}

      {exempt
        ? <div className="money__cell" title="This project is VAT exempt / zero-rated"><div className="money__label">VAT</div><div className="money__value muted">—</div><div className="money__sub">exempt</div></div>
        : <button type="button" className="money__cell money__cell--btn" onClick={() => setVatOpen(true)} title={`VAT ${p.vatRate}% on the net contract${m.changeOrders ? " plus approved change orders" : ""}. Click for payments.`}>
            <div className="money__label">VAT outstanding <span className="money__chev">›</span></div>
            {m.vatOutstanding > 0
              ? <><div className="money__value money__value--warn">{naira(m.vatOutstanding)}</div><div className="money__sub">of {naira(m.vatDue, true)} due</div></>
              : <><div className="money__value money__value--ok">Settled</div><div className="money__sub">{naira(m.vatDue, true)} paid in full</div></>}
            <div className="money__track"><i style={{ width: `${Math.min(paidPct, 100)}%` }} /></div>
          </button>}

      <button type="button" className="money__cell money__cell--btn" title="Checked budget lines — click to jump to them" onClick={() => jump("budget-lines")}>
        <div className="money__label">Budget <span className="money__chev">›</span></div>
        <div className="money__value">{m.planned ? naira(m.planned) : "—"}</div>
        <div className="money__sub">{m.planned ? `${pct(m.planned, m.contractNet)}% of contract` : "no checked lines"}</div>
      </button>

      <button type="button" className="money__cell money__cell--btn" title="Approved purchase orders — click to jump to them" onClick={() => jump("purchase-orders")}>
        <div className="money__label">Committed <span className="money__chev">›</span></div>
        <div className="money__value">{naira(m.committed)}</div>
        <div className={`money__sub ${committedPct > 100 ? "money__sub--bad" : ""}`}>{m.planned ? `${committedPct}% of budget` : "—"}</div>
      </button>

      <button type="button" className="money__cell money__cell--btn" title="Checked actuals only — click to jump to the ledger" onClick={() => jump("actuals")}>
        <div className="money__label">Spent <span className="money__chev">›</span></div>
        <div className="money__value">{naira(m.actual)}</div>
        <div className={`money__sub ${over ? "money__sub--bad" : ""}`}>{m.planned ? (over ? `${naira(-m.variance, true)} over budget` : `${naira(m.variance, true)} left`) : "—"}</div>
        <div className={`money__track ${m.burnPct > 100 ? "money__track--over" : m.burnPct > 90 ? "money__track--warn" : ""}`}><i style={{ width: `${Math.min(m.burnPct, 100)}%` }} /></div>
      </button>

      {vatOpen && <VatModal p={p} onClose={() => setVatOpen(false)} />}
      {comOpen && <CommercialsModal p={p} onClose={() => setComOpen(false)} />}
    </div>
  );
}
