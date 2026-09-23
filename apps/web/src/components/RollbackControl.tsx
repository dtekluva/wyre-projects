import { useEffect, useState } from "react";
import { STAGES, type Project, type Stage } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";

/**
 * Take a project back to an earlier stage — a schedule correction, not an undo. Actual exit dates from the target
 * stage onward are cleared so the gates can be exited again properly; planned dates, documents, money and stock stay.
 * Director or Tech Lead, with a reason, confirmed in a dialog.
 */
export function RollbackControl({ p }: { p: Project }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [open, setOpen] = useState(false); const [to, setTo] = useState<Stage>(Math.max(0, p.stage - 1) as Stage); const [why, setWhy] = useState("");
  useEffect(() => { if (open) document.body.classList.add("modal-open"); return () => { document.body.classList.remove("modal-open"); }; }, [open]);
  if (p.stage === 0 || !api.can(user.id, "stage.rollback", p.id)) return null;
  const earlier = STAGES.filter((s) => s.stage < p.stage);
  const cleared = STAGES.filter((s) => s.stage >= to && s.stage <= p.stage && p.stageActual[s.stage as Stage]);
  return <>
    <button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" title="Take this project back to an earlier stage" onClick={() => { setTo(Math.max(0, p.stage - 1) as Stage); setWhy(""); setOpen(true); }}>↶ Move back a stage…</button>
    {open && <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label="Move back a stage"
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setOpen(false); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setOpen(false); }}>
      <div className="modal__panel modal__panel--sm">
        <header className="modal__head"><div><div className="modal__title">Move {p.code} back a stage?</div><div className="sm muted">Now at {p.stage} · {STAGES[p.stage].name}</div></div></header>
        <div className="modal__scroll stack" style={{ gap: 10 }}>
          <label className="ns-field"><span className="ns-field__label">Back to</span>
            <select className="ns-input" value={to} onChange={(e) => setTo(Number(e.target.value) as Stage)}>{earlier.map((s) => <option key={s.stage} value={s.stage}>{s.stage} · {s.name}</option>)}</select></label>
          <div className="sm">The actual exit date{cleared.length === 1 ? "" : "s"} for {cleared.length ? cleared.map((s) => `${s.stage} · ${s.name}`).join(", ") : "the stages from the target onward"} will be cleared so {cleared.length === 1 ? "it" : "they"} can be re-planned and exited again. Any pending gate approval is cancelled. Planned dates, documents, money and stock are untouched.</div>
          <label className="ns-field"><span className="ns-field__label">Why? <span className="muted">· required</span></span>
            <textarea className="ns-input" rows={3} autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. gate approved before the DISCO letter actually arrived · client paused the site" /></label>
        </div>
        <footer className="modal__foot">
          <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setOpen(false)}>Cancel</button>
          <button className="ns-btn ns-btn--primary ns-btn--sm right" disabled={!why.trim()} onClick={() => { if (safe(() => api.rollbackStage(user.id, p.id, { toStage: to, reason: why }), `Moved back to stage ${to} · ${STAGES[to].name}`)) setOpen(false); }}>Move back</button>
        </footer>
      </div>
    </div>}
  </>;
}
