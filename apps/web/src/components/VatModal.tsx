import { useEffect, useState } from "react";
import { VAT_PAYMENT_METHOD_LABEL, fmtDate, naira, relative, type Project, type VatPayment, type VatPaymentMethod } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { FilePick, type Pick } from "./FilePick";
import { Thumbs } from "./Thumbs";
import { Bar, Badge, ReviewBadge } from "./ui";
import { VoidControl, VoidedNote } from "./VoidControl";

/**
 * VAT on a project, from the VAT cell of the money strip: what is due, what has been paid, and the payments
 * behind that figure — each a partial or the lot, with its receipts. Recording is Finance / Director; a payment
 * counts once a Finance or Director user checks it. Nothing else settles VAT.
 */
export function VatModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const m = api.money(p.id); const payments = api.listVatPayments(p.id);
  const canBill = api.can(user.id, "billing.manage", p.id);
  const [amt, setAmt] = useState(String(m.vatOutstanding || "")); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<VatPaymentMethod>(p.vatTreatment === "withheld_by_client" ? "withheld_by_client" : "remitted");
  const [note, setNote] = useState(""); const [files, setFiles] = useState<Pick[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey); document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); };
  }, [onClose]);
  const settledPct = m.vatDue > 0 ? Math.round(m.vatSettled / m.vatDue * 100) : 0;
  const pending = payments.filter((v) => v.reviewStatus === "pending").reduce((s, v) => s + v.amount, 0);
  const upload = (picks: Pick[]) => picks.map((f) => api.addAttachment(user.id, p.id, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, kind: f.file.type.startsWith("image/") ? "image" : "document", caption: f.caption?.trim() || "VAT receipt" }).id);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="VAT" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal__panel">
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <div className="ns-overline">{p.code} · VAT {p.vatRate}%</div>
            <div className="modal__title">{naira(m.vatDue)} due on {naira(m.contractNet, true)} net{m.changeOrders ? " (incl. change orders)" : ""}</div>
            <div className="sm muted row" style={{ gap: 8 }}><Bar pct={settledPct} /> <b>{naira(m.vatSettled)}</b> paid · <b className={m.vatOutstanding > 0 ? "warn-text" : ""}>{naira(m.vatOutstanding)}</b> outstanding{pending > 0 && <span className="muted"> · {naira(pending, true)} awaiting check</span>}</div>
          </div>
          <button className="modal__x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="modal__scroll">
          {canBill && <div className="modal__section">
            <div className="ns-overline">Record a VAT payment</div>
            <div className="form">
              <label className="ns-field"><span className="ns-field__label">Amount paid (₦)</span><input className="ns-input" type="number" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={String(m.vatOutstanding)} /></label>
              <label className="ns-field"><span className="ns-field__label">Date</span><input className="ns-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="ns-field"><span className="ns-field__label">How</span><select className="ns-input" value={method} onChange={(e) => setMethod(e.target.value as VatPaymentMethod)}>{(Object.keys(VAT_PAYMENT_METHOD_LABEL) as VatPaymentMethod[]).map((k) => <option key={k} value={k}>{VAT_PAYMENT_METHOD_LABEL[k]}</option>)}</select></label>
              <label className="ns-field" style={{ gridColumn: "1 / -1" }}><span className="ns-field__label">Note <span className="muted">· optional — FIRS receipt no., which invoice, period</span></span><input className="ns-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <label className="ns-field" style={{ gridColumn: "1 / -1" }}><span className="ns-field__label">Receipts <span className="muted">· FIRS receipt, client credit note — several allowed</span></span><FilePick picks={files} onChange={setFiles} multiple captions label="Attach receipts" captionPlaceholder="What is this?" /></label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="ns-btn ns-btn--primary" disabled={!(Number(amt) > 0)} onClick={() => { if (safe(() => { api.recordVatPayment(user.id, p.id, { amount: Number(amt), paidOn: date, method, note, attachmentIds: upload(files) }); }, "VAT payment recorded — pending check by Finance or a Director")) { setAmt(""); setNote(""); setFiles([]); } }}>Record payment</button>
              <span className="sm muted">Counts towards VAT paid once Finance or a Director checks it.</span>
            </div>
          </div>}

          <div className="modal__section">
            <div className="ns-overline">Payments ({payments.length})</div>
            {payments.length ? <div className="stack" style={{ gap: 8 }}>{payments.map((v) => <PaymentRow key={v.id} v={v} canBill={canBill} upload={upload} />)}</div>
              : <div className="sm muted">No VAT payments recorded yet{canBill ? " — record the first one above." : "."}</div>}
          </div>
        </div>

        <footer className="modal__foot">
          <span className="sm muted">Due is {p.vatRate}% of the net contract{m.changeOrders ? " plus approved change orders" : ""}. Change the rate or treatment under Billing → Contract terms.</span>
          <button className="ns-btn ns-btn--ghost ns-btn--sm right" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function PaymentRow({ v, canBill, upload }: { v: VatPayment; canBill: boolean; upload: (p: Pick[]) => string[] }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [more, setMore] = useState<Pick[]>([]); const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  const canCheck = v.reviewStatus === "pending" && api.can(user.id, "billing.manage", v.projectId) && (v.submittedBy !== user.id || user.roles.some((r) => r === "finance" || r === "director"));
  return <div className={`card ${v.voidedAt ? "voided" : ""}`} style={{ padding: "10px 12px" }}>
    <div className="row row--wrap" style={{ gap: 10 }}>
      <b className="ns-mono">{naira(v.amount)}</b>
      <span className="sm">{fmtDate(v.paidOn)}</span>
      <Badge variant="neutral">{VAT_PAYMENT_METHOD_LABEL[v.method]}</Badge>
      <ReviewBadge status={v.reviewStatus} />
      <span className="sm muted grow">{api.userName(v.submittedBy)} · {relative(v.submittedAt)}{v.checkedBy && <> · checked by {api.userName(v.checkedBy)}</>}{v.checkComment && <> · “{v.checkComment}”</>}</span>
      {!v.voidedAt && <VoidControl kind="vat_payment" id={v.id} projectId={v.projectId} size="xs" what={`VAT payment · ${naira(v.amount)} · ${fmtDate(v.paidOn)}`} />}
      {canCheck && !v.voidedAt && !rejecting && <><button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => api.check("vat_payment", v.id, user.id, "checked"), "VAT payment checked")}>✓ Check</button>
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(true)}>Reject…</button></>}
    </div>
    {rejecting && <div className="row" style={{ marginTop: 6 }}><input className="ns-input grow" placeholder="Reason (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="ns-btn ns-btn--danger ns-btn--sm" onClick={() => { if (safe(() => api.check("vat_payment", v.id, user.id, "rejected", comment), "Rejected")) setRejecting(false); }}>Confirm</button>
      <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(false)}>Cancel</button></div>}
    <VoidedNote r={v} />
    {v.note && <div className="sm" style={{ marginTop: 4 }}>{v.note}</div>}
    <div className="row row--wrap" style={{ marginTop: 6, gap: 10 }}>
      <span className="sm muted">Receipts</span><Thumbs ids={v.attachmentIds} empty="none yet" size="lg" />
      {canBill && <><FilePick picks={more} onChange={setMore} multiple label="Add receipt" />
        {more.length > 0 && <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => { if (safe(() => api.addVatPaymentReceipts(user.id, v.id, { attachmentIds: upload(more) }), v.reviewStatus === "checked" ? "Receipts added — payment re-enters review" : "Receipts added")) setMore([]); }}>Add {more.length}</button>}</>}
    </div>
  </div>;
}
