import { Fragment, useState } from "react";
import { VAT_TREATMENT_LABEL, fmtDate, naira, relative, vatOn, type ClientInvoice, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { FilePick, type Pick } from "./FilePick";
import { Thumbs } from "./Thumbs";
import { Badge, Empty, ReviewBadge } from "./ui";

/**
 * Billing: what we billed the client and what came in against it. VAT itself is paid and tracked from the VAT cell
 * of the money strip — invoices only say what was billed.
 */
export function BillingCard({ p }: { p: Project }) {
  const api = useApi(); const { user } = useAuth();
  const m = api.money(p.id); const invs = api.listInvoices(p.id);
  const canBill = api.can(user.id, "billing.manage", p.id);
  const [mode, setMode] = useState<"" | "raise">("");
  const [open, setOpen] = useState<string | null>(null);
  const exempt = p.vatTreatment === "exempt";
  return (
    <div className="card">
      <div className="card__head">
        <div className="card__title">Billing</div>
        <div className="row row--wrap sm" style={{ gap: 12 }}>
          <span className="muted">VAT {exempt ? "exempt" : `${p.vatRate}% · ${VAT_TREATMENT_LABEL[p.vatTreatment].split(" — ")[0]}`}</span>
          {canBill && <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => setMode(mode === "raise" ? "" : "raise")}>＋ Raise invoice</button>}
        </div>
      </div>
      <div className="money money--4b">
        <div className="money__cell"><div className="money__label">VAT due</div><div className="money__value">{naira(m.vatDue)}</div><div className="money__sub">on {naira(m.contractNet, true)} net{m.changeOrders ? " incl. COs" : ""}</div></div>
        <div className="money__cell"><div className="money__label">Invoiced</div><div className="money__value">{naira(m.invoicedNet)}</div><div className="money__sub">+ {naira(m.invoicedVat, true)} VAT · {m.contractNet ? Math.round(m.invoicedNet / m.contractNet * 100) : 0}% of contract</div></div>
        <div className="money__cell"><div className="money__label">Received</div><div className="money__value">{naira(m.received)}</div><div className="money__sub">of {naira(m.invoicedNet + m.invoicedVat, true)} gross invoiced</div></div>
        <div className="money__cell"><div className="money__label">VAT outstanding</div><div className={`money__value ${m.vatOutstanding > 0 ? "warn-text" : ""}`}>{naira(m.vatOutstanding)}</div><div className="money__sub">{naira(m.vatSettled, true)} paid · record payments from the VAT cell above</div></div>
      </div>
      <div className="card__body stack">
        {mode === "raise" && <RaiseForm p={p} onDone={() => setMode("")} />}
        {invs.length ? <div className="table--wrap"><table className="table">
          <thead><tr><th>Invoice</th><th>For</th><th className="num">Net</th><th className="num">VAT</th><th className="num">Gross</th><th className="num">Received</th><th></th></tr></thead>
          <tbody>{invs.map((i) => { const got = i.receipts.reduce((s, r) => s + r.amount, 0); const isOpen = open === i.id; return <Fragment key={i.id}>
            <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : i.id)}>
              <td><b className="ns-mono">{i.invoiceNumber}</b><div className="sm muted">{fmtDate(i.issuedAt)}</div></td>
              <td>{i.description || <span className="muted">—</span>}<div style={{ marginTop: 2 }}><ReviewBadge status={i.reviewStatus} /></div></td>
              <td className="num ns-mono">{naira(i.netAmount)}</td><td className="num ns-mono">{naira(i.vatAmount)}</td><td className="num ns-mono"><b>{naira(i.grossAmount)}</b></td>
              <td className="num ns-mono">{naira(got)}{got >= i.grossAmount ? <div><Badge variant="success">paid</Badge></div> : got > 0 ? <div><Badge variant="info">part</Badge></div> : null}</td>
              <td className="sm muted">{isOpen ? "▾" : "▸"}</td>
            </tr>
            {isOpen && <tr><td colSpan={7} style={{ background: "var(--ns-color-surface-subtle)" }}><InvoiceDetail inv={i} canBill={canBill} /></td></tr>}
          </Fragment>; })}</tbody></table></div>
          : <Empty title="Nothing billed yet" hint={canBill ? "Raise the first invoice — VAT is worked out at the project rate." : "Finance raises invoices here."} />}
      </div>
    </div>
  );
}

function RaiseForm({ p, onDone }: { p: Project; onDone: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [no, setNo] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [desc, setDesc] = useState("");
  const [net, setNet] = useState(""); const [vatOverride, setVatOverride] = useState(""); const [files, setFiles] = useState<Pick[]>([]);
  const n = Number(net) || 0; const vat = vatOverride.trim() === "" ? vatOn(n, p.vatRate, p.vatTreatment) : Number(vatOverride) || 0;
  return <div className="note note--info stack" style={{ gap: 8 }}>
    <b>Raise an invoice</b> <span className="sm muted">Enters the review queue as <b>pending check</b>; receipts and VAT can be recorded once it is checked.</span>
    <div className="form">
      <label className="ns-field"><span className="ns-field__label">Invoice number</span><input className="ns-input" value={no} onChange={(e) => setNo(e.target.value)} placeholder="e.g. WYR-INV-2026-032" /></label>
      <label className="ns-field"><span className="ns-field__label">Date</span><input className="ns-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="ns-field" style={{ gridColumn: "1 / -1" }}><span className="ns-field__label">For</span><input className="ns-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Installation complete — 40% of contract" /></label>
      <label className="ns-field"><span className="ns-field__label">Net amount (₦)</span><input className="ns-input" type="number" min="0" value={net} onChange={(e) => setNet(e.target.value)} /></label>
      <label className="ns-field"><span className="ns-field__label">VAT (₦) <span className="muted">· {p.vatRate}% unless you say otherwise</span></span><input className="ns-input" type="number" min="0" value={vatOverride} onChange={(e) => setVatOverride(e.target.value)} placeholder={String(vatOn(n, p.vatRate, p.vatTreatment))} /></label>
      <label className="ns-field"><span className="ns-field__label">Invoice file</span><FilePick picks={files} onChange={setFiles} label="Attach invoice PDF" /></label>
    </div>
    <div className="sm">Net <b className="ns-mono">{naira(n)}</b> + VAT <b className="ns-mono">{naira(vat)}</b> = gross <b className="ns-mono">{naira(n + vat)}</b></div>
    <div className="row"><button className="ns-btn ns-btn--primary ns-btn--sm" disabled={!no.trim() || n <= 0} onClick={() => { if (safe(() => {
        const ids = files.map((f) => api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, kind: "document", caption: `Invoice ${no.trim()}` }).id);
        api.raiseInvoice(user.id, p.id, { invoiceNumber: no, issuedAt: date, description: desc, netAmount: n, vatAmount: vatOverride.trim() === "" ? undefined : vat, attachmentIds: ids });
      }, "Invoice raised — pending check")) onDone(); }}>Raise</button>
      <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onDone}>Cancel</button></div>
  </div>;
}

function InvoiceDetail({ inv, canBill }: { inv: ClientInvoice; canBill: boolean }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const got = inv.receipts.reduce((s, r) => s + r.amount, 0); const left = Math.max(0, inv.grossAmount - got);
  const [rAmt, setRAmt] = useState(String(left || "")); const [rDate, setRDate] = useState(new Date().toISOString().slice(0, 10)); const [rNote, setRNote] = useState(""); const [rFiles, setRFiles] = useState<Pick[]>([]);
  const checked = inv.reviewStatus === "checked";
  const canCheck = inv.reviewStatus === "pending" && api.can(user.id, "billing.manage", inv.projectId) && (inv.submittedBy !== user.id || user.roles.some((r) => r === "finance" || r === "director"));
  return <div className="stack" style={{ gap: 12, padding: "6px 0" }}>
    <div className="row row--wrap sm muted" style={{ gap: 12 }}>
      <span>Raised by <b>{api.userName(inv.submittedBy)}</b> {relative(inv.submittedAt)}</span>
      {inv.checkedBy && <span>· checked by <b>{api.userName(inv.checkedBy)}</b></span>}
      {inv.checkComment && <span>· “{inv.checkComment}”</span>}
      {inv.attachmentIds.length > 0 && <span className="row" style={{ gap: 6 }}>· invoice <Thumbs ids={inv.attachmentIds} /></span>}
      {canCheck && <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => api.check("client_invoice", inv.id, user.id, "checked"), "Invoice checked")}>✓ Check invoice</button>}
    </div>
    <div className="workspace" style={{ gridTemplateColumns: "2fr 1fr", gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="ns-overline">Receipts · {naira(got)} of {naira(inv.grossAmount)}</div>
        {inv.receipts.length ? <ul className="lines">{inv.receipts.map((r) => <li key={r.id}><span className="grow">{fmtDate(r.date)}{r.note ? ` · ${r.note}` : ""}</span><b className="ns-mono">{naira(r.amount)}</b>{r.attachmentIds.length > 0 && <Thumbs ids={r.attachmentIds} />}</li>)}</ul> : <div className="sm muted">Nothing received yet.</div>}
        {canBill && checked && left > 0 && <div className="stack" style={{ gap: 6 }}>
          <div className="row row--wrap"><input className="ns-input" style={{ width: 150 }} type="number" min="0" value={rAmt} onChange={(e) => setRAmt(e.target.value)} placeholder="Amount ₦" /><input className="ns-input" style={{ width: 150 }} type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} /><input className="ns-input grow" value={rNote} onChange={(e) => setRNote(e.target.value)} placeholder="Note, e.g. net paid, VAT withheld" /></div>
          <div className="row row--wrap"><FilePick picks={rFiles} onChange={setRFiles} label="Remittance advice" />
            <button className="ns-btn ns-btn--secondary ns-btn--sm" disabled={!(Number(rAmt) > 0)} onClick={() => { if (safe(() => { const ids = rFiles.map((f) => api.addAttachment(user.id, inv.projectId, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, kind: f.file.type.startsWith("image/") ? "image" : "document", caption: `Receipt · ${inv.invoiceNumber}` }).id);
              api.recordReceipt(user.id, inv.id, { date: rDate, amount: Number(rAmt), note: rNote, attachmentIds: ids }); }, "Receipt recorded")) { setRNote(""); setRFiles([]); } }}>Record receipt</button></div>
        </div>}
        {!checked && <div className="sm muted">Receipts can be recorded once the invoice is checked.</div>}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="ns-overline">VAT on this invoice · {naira(inv.vatAmount)}</div>
        <div className="sm muted">VAT is paid and tracked per project, not per invoice — use the VAT cell in the money strip to record a payment and its receipts.</div>
      </div>
    </div>
  </div>;
}
