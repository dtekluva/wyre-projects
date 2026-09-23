import { useEffect, useState } from "react";
import { CONTRACT_STATUS_LABEL, VAT_TREATMENT_LABEL, fmtDate, naira, netFromGross, relative, vatOn, type Project, type VatTreatment } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { FilePick, type Pick } from "./FilePick";
import { FileLink } from "./FileLink";
import { Badge } from "./ui";

/**
 * Everything commercial on a project, from the Contract cell of the money strip: the figures, editable after
 * creation, and whether the signed contract is actually in hand. A project can be opened before the contract
 * arrives — figures stay provisional until someone marks it received, ideally filing the signed copy.
 */
export function CommercialsModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const live = api.projects.find((x) => x.id === p.id) ?? p;
  const can = api.can(user.id, "contract.manage", live.id);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey); document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); };
  }, [onClose]);
  const draft = live.contractStatus === "draft";
  const doc = live.contractDocumentId ? api.documents.find((d) => d.id === live.contractDocumentId) : undefined;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Commercials" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal__panel">
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <div className="ns-overline">{live.code} · commercials</div>
            <div className="modal__title">{naira(live.contractValueNet)} <span className="sm muted" style={{ fontWeight: 400 }}>net of VAT</span></div>
            <div className="sm muted">{live.vatTreatment === "exempt" ? "VAT exempt" : `+ ${naira(live.vatAmount)} VAT ${live.vatRate}% = ${naira(live.contractValue)} gross`}</div>
          </div>
          <Badge variant={draft ? "warning" : "success"}>{draft ? "Draft" : "Received"}</Badge>
          <button className="modal__x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="modal__scroll">
          <div className="modal__section">
            <div className="ns-overline">Contract</div>
            {draft
              ? <div className="note note--warn sm">{CONTRACT_STATUS_LABEL.draft}. The figures below are provisional until the signed contract is in hand.</div>
              : <div className="sm">Received {fmtDate(live.contractReceivedOn)} by <b>{api.userName(live.contractReceivedBy ?? "")}</b>{doc && <> · <FileLink kind="document" id={doc.id}>{doc.title}</FileLink></>}</div>}
            {can && (draft ? <ReceiveForm p={live} /> : <div className="row" style={{ marginTop: 8 }}>
              <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.setContractStatus(user.id, live.id, { status: "draft" }), "Contract set back to draft")}>Set back to draft</button></div>)}
          </div>

          <div className="modal__section">
            <div className="row" style={{ justifyContent: "space-between" }}><div className="ns-overline">Figures</div>
              {can && !editing && <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setEditing(true)}>Edit</button>}</div>
            {editing ? <EditForm p={live} onDone={() => setEditing(false)} /> : <div className="review__kv">
              <span>Contract value</span><b>{naira(live.contractValueNet)} <span className="muted">net</span></b>
              <span>VAT</span><b>{live.vatTreatment === "exempt" ? "Exempt / zero-rated" : `${live.vatRate}% · ${naira(live.vatAmount)} · ${VAT_TREATMENT_LABEL[live.vatTreatment].split(" — ")[0]}`}</b>
              <span>Gross</span><b>{naira(live.contractValue)}</b>
              <span>Approved budget</span><b>{live.approvedBudget ? `${naira(live.approvedBudget)} · ${Math.round(live.approvedBudget / (live.contractValueNet || 1) * 100)}% of net` : <span className="muted">not yet approved</span>}</b>
              <span>Retention</span><b>{live.retentionPercent}% of net</b>
              <span>Last change</span><b>{api.userName(live.updatedBy)} · {relative(live.updatedAt)}</b>
            </div>}
          </div>
        </div>

        <footer className="modal__foot">
          <span className="sm muted">{can ? "Director or Finance edits these; every change is logged in the chronology." : "Only a Director or Finance can edit commercials."}</span>
          <button className="ns-btn ns-btn--ghost ns-btn--sm right" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function EditForm({ p, onDone }: { p: Project; onDone: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [haveGross, setHaveGross] = useState(false); const [val, setVal] = useState(String(p.contractValueNet));
  const [rate, setRate] = useState(String(p.vatRate)); const [treatment, setTreatment] = useState<VatTreatment>(p.vatTreatment);
  const [budget, setBudget] = useState(String(p.approvedBudget || "")); const [retention, setRetention] = useState(String(p.retentionPercent));
  const r = Number(rate) || 0; const typed = Number(val) || 0; const net = haveGross ? netFromGross(typed, r, treatment) : typed; const vat = vatOn(net, r, treatment);
  return <div className="stack" style={{ gap: 8 }}>
    <div className="form">
      <label className="ns-field"><span className="ns-field__label">Contract value (₦, {haveGross ? "gross" : "net of VAT"})</span><input className="ns-input" type="number" min="0" value={val} onChange={(e) => setVal(e.target.value)} /></label>
      <label className="ns-field"><span className="ns-field__label">VAT rate (%)</span><input className="ns-input" type="number" min="0" max="100" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} disabled={treatment === "exempt"} /></label>
      <label className="ns-field"><span className="ns-field__label">VAT treatment</span><select className="ns-input" value={treatment} onChange={(e) => setTreatment(e.target.value as VatTreatment)}>{(Object.keys(VAT_TREATMENT_LABEL) as VatTreatment[]).map((t) => <option key={t} value={t}>{VAT_TREATMENT_LABEL[t]}</option>)}</select></label>
      <label className="ns-field"><span className="ns-field__label">Approved cost budget (₦, net)</span><input className="ns-input" type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 until approved" /></label>
      <label className="ns-field"><span className="ns-field__label">Retention (%)</span><input className="ns-input" type="number" min="0" max="20" step="0.5" value={retention} onChange={(e) => setRetention(e.target.value)} /></label>
    </div>
    <label className="row sm" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={haveGross} onChange={(e) => setHaveGross(e.target.checked)} /> I only have the gross figure — work out the net</label>
    <div className="sm">Net <b className="ns-mono">{naira(net)}</b>{treatment !== "exempt" && <> + VAT {r}% <b className="ns-mono">{naira(vat)}</b> = gross <b className="ns-mono">{naira(net + vat)}</b></>}</div>
    <div className="row"><button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => { if (safe(() => api.updateCommercials(user.id, p.id, { contractValueNet: net, vatRate: r, vatTreatment: treatment, approvedBudget: Number(budget) || 0, retentionPercent: Number(retention) || 0 }), "Commercials updated")) onDone(); }}>Save</button>
      <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onDone}>Cancel</button></div>
  </div>;
}

function ReceiveForm({ p }: { p: Project }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10)); const [files, setFiles] = useState<Pick[]>([]);
  return <div className="stack" style={{ gap: 6, marginTop: 8 }}>
    <div className="row row--wrap">
      <label className="ns-field"><span className="ns-field__label">Received on</span><input className="ns-input" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      <label className="ns-field"><span className="ns-field__label">Signed contract <span className="muted">· optional, files as a Contract document</span></span><FilePick picks={files} onChange={setFiles} label="Attach signed contract" /></label>
    </div>
    <div><button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => {
      const f = files[0];
      const doc = f ? api.addDocument(user.id, p.id, { docType: "contract", title: `Signed contract — ${p.code}`, fileName: f.fileName, sizeBytes: f.size, blob: f.file }) : undefined;
      api.setContractStatus(user.id, p.id, { status: "received", receivedOn: on, documentId: doc?.id });
    }, "Contract marked received")}>Mark contract received</button></div>
  </div>;
}
