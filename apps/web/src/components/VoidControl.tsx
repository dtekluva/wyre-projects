import { useState } from "react";
import { VOID_KIND_LABEL, relative, type VoidFields, type VoidKind } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";

/**
 * Void a record that was entered wrongly — even one already checked. A reason is required; the record stays on
 * screen struck through with who voided it and why, and stops counting everywhere. Director or Tech Lead.
 */
export function VoidControl({ kind, id, projectId, size = "sm" }: { kind: VoidKind; id: string; projectId?: string; size?: "sm" | "xs" }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [open, setOpen] = useState(false); const [why, setWhy] = useState("");
  if (!api.can(user.id, "record.void", projectId)) return null;
  if (!open) return <button type="button" className={`ns-btn ns-btn--ghost ns-btn--${size} void__btn`} title={`Void this ${VOID_KIND_LABEL[kind]} — it stops counting but stays on record`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Void…</button>;
  return <span className="void__form" onClick={(e) => e.stopPropagation()}>
    <input className="ns-input" style={{ minHeight: 30, width: 220 }} placeholder="Reason (required)" value={why} autoFocus onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
    <button type="button" className="ns-btn ns-btn--danger ns-btn--sm" disabled={!why.trim()} onClick={() => { if (safe(() => api.voidRecord(user.id, kind, id, why), `Voided — ${VOID_KIND_LABEL[kind]} no longer counts`)) { setOpen(false); setWhy(""); } }}>Void</button>
    <button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setOpen(false)}>Cancel</button>
  </span>;
}

/** The strike-through note on a voided record. */
export function VoidedNote({ r }: { r: VoidFields }) {
  const api = useApi();
  if (!r.voidedAt) return null;
  return <span className="voided__note">Voided by {api.userName(r.voidedBy ?? "")} {relative(r.voidedAt)} — {r.voidReason}</span>;
}
