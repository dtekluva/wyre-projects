import { useEffect, useState } from "react";
import { VOID_KIND_LABEL, relative, type VoidFields, type VoidKind } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";

/**
 * Remove a record that was entered wrongly — even one already checked. On screen the word is "Remove" and the
 * control is the trash icon everyone knows; in the books it is a void: the record stays, struck through, with
 * who removed it and why, and stops counting everywhere. Director or Tech Lead. One dialog, wherever it is used.
 */
export function VoidControl({ kind, id, projectId, size = "sm", what, onDone }:
  { kind: VoidKind; id: string; projectId?: string; size?: "sm" | "xs"; what?: string; onDone?: () => void }) {
  const api = useApi(); const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!api.can(user.id, "record.void", projectId)) return null;
  const label = VOID_KIND_LABEL[kind];
  return <>
    {size === "xs"
      ? <button type="button" className="remove-ic" title={`Remove this ${label} — kept on record`} aria-label={`Remove this ${label}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}><TrashIcon /></button>
      : <button type="button" className="ns-btn ns-btn--sm remove-btn" title={`Remove this ${label} — kept on record`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}><TrashIcon /> Remove</button>}
    {open && <VoidDialog kind={kind} id={id} what={what} onClose={() => setOpen(false)} onDone={onDone} />}
  </>;
}

function VoidDialog({ kind, id, what, onClose, onDone }: { kind: VoidKind; id: string; what?: string; onClose: () => void; onDone?: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [why, setWhy] = useState("");
  const label = VOID_KIND_LABEL[kind];
  useEffect(() => { document.body.classList.add("modal-open"); return () => { document.body.classList.remove("modal-open"); }; }, []);
  const submit = () => { if (safe(() => api.voidRecord(user.id, kind, id, why), `Removed — the ${label} no longer counts`)) { onClose(); onDone?.(); } };
  return (
    <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label={`Remove this ${label}`}
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
      <div className="modal__panel modal__panel--sm">
        <header className="modal__head"><div><div className="modal__title">Remove this {label}?</div>{what && <div className="sm muted ellipsis">{what}</div>}</div></header>
        <div className="modal__scroll stack" style={{ gap: 10 }}>
          <div className="sm">It won't be deleted. It stays on record as removed — with your name, the time and your reason — and stops counting everywhere: totals, stock, gates, the review queue.</div>
          <label className="ns-field"><span className="ns-field__label">Why is it wrong? <span className="muted">· required</span></span>
            <textarea className="ns-input" rows={3} autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. uploaded to the wrong project · duplicate of GRN-2026-011 · typed in kobo" /></label>
        </div>
        <footer className="modal__foot">
          <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onClose}>Cancel</button>
          <button className="ns-btn ns-btn--danger ns-btn--sm right" disabled={!why.trim()} onClick={submit}><TrashIcon /> Remove</button>
        </footer>
      </div>
    </div>
  );
}

const TrashIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>;

/** The strike-through note on a removed (voided) record. */
export function VoidedNote({ r }: { r: VoidFields }) {
  const api = useApi();
  if (!r.voidedAt) return null;
  return <span className="voided__note">Removed by {api.userName(r.voidedBy ?? "")} {relative(r.voidedAt)} — {r.voidReason}</span>;
}
