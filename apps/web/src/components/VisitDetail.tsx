import { useEffect, useState } from "react";
import { VISIT_TYPE_LABEL, fmtDateTime, naira, relative, type SiteVisit } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, ReviewBadge } from "./ui";
import { Thumbs } from "./Thumbs";

/** Full record behind a visit: who, when, what was found, what it cost, what stock moved, and every photo
 *  with its label. A checker can act on it here rather than hunting through the review queue. */
export function VisitDetail({ visit, onClose }: { visit: SiteVisit; onClose: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey); document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); };
  }, [onClose]);

  const v = api.listVisits(visit.projectId).find((x) => x.id === visit.id) ?? visit;
  const canCheck = v.reviewStatus === "pending" && v.submittedBy !== user.id && api.can(user.id, "visit.check", v.projectId);
  const photos = v.attachmentIds.map((id) => api.attachments.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  const parts = v.parts.map((pt) => ({ ...pt, mv: api.movements.find((m) => m.id === pt.movementId) }));
  const issues = v.issueIds.map((id) => api.listIssues({ projectId: v.projectId }).find((i) => i.id === id)).filter(Boolean);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Visit detail" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal__panel">
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <div className="ns-overline">{api.projectCode(v.projectId)} · site visit</div>
            <div className="modal__title">{VISIT_TYPE_LABEL[v.visitType]} · {v.durationHrs} h</div>
            <div className="sm muted">{fmtDateTime(v.startedAt)} → {fmtDateTime(v.endedAt)}</div>
          </div>
          <ReviewBadge status={v.reviewStatus} />
          <button className="modal__x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="modal__scroll">
          <div className="review__kv">
            <span>Technicians</span><b>{v.technicianIds.map((t) => api.userName(t)).join(", ")}</b>
            <span>Logged by</span><b>{api.userName(v.submittedBy)} · {relative(v.submittedAt)}</b>
            {v.checkedBy && <><span>Checked by</span><b>{api.userName(v.checkedBy)} · {relative(v.checkedAt!)}</b></>}
            {v.checkComment && <><span>Checker note</span><b>“{v.checkComment}”</b></>}
            <span>Findings</span><b>{v.findings}</b>
            {v.actionsTaken && <><span>Actions taken</span><b>{v.actionsTaken}</b></>}
            <span>Van / store</span><b>{api.locationName(v.locationId)}</b>
            {v.gps && <><span>GPS</span><b className="ns-mono">{v.gps.lat.toFixed(5)}, {v.gps.lng.toFixed(5)}</b></>}
            {v.offlineCapturedAt && <><span>Captured offline</span><b>{fmtDateTime(v.offlineCapturedAt)}</b></>}
          </div>

          <div className="modal__section">
            <div className="ns-overline">Costs</div>
            <div className="row row--wrap">
              <Badge variant="neutral">travel {naira(v.costTravel)}</Badge>
              <Badge variant="neutral">labour {naira(v.costLabour)}</Badge>
              <Badge variant="neutral">parts {naira(v.costParts)}</Badge>
              <b className="ns-mono">{naira(v.costTotal)}</b>
              <span className="sm muted">{v.reviewStatus === "checked" ? "posted to the project" : "posts when checked"}</span>
            </div>
          </div>

          {parts.length > 0 && <div className="modal__section">
            <div className="ns-overline">Parts used</div>
            <ul className="lines">{parts.map((pt) => <li key={pt.movementId}>
              <span className="grow">{api.itemName(pt.itemId)} × {pt.qty}{pt.serials?.length ? <span className="sm muted ns-mono"> · {pt.serials.join(", ")}</span> : null}</span>
              {pt.mv && <span className="ns-mono sm muted">@ {naira(pt.mv.unitCost)}</span>}
              {pt.mv && <b className="ns-mono">{naira(pt.mv.totalCost)}</b>}
              {pt.mv && <ReviewBadge status={pt.mv.reviewStatus} />}
            </li>)}</ul>
          </div>}

          <div className="modal__section">
            <div className="ns-overline">Photos ({photos.length})</div>
            {photos.length ? <div className="evidence">{photos.map((a) => <figure key={a.id} className="evidence__item">
              <Thumbs ids={[a.id]} size="lg" />
              <figcaption className="sm">{a.caption || a.fileName}<div className="muted">{api.userName(a.uploadedBy)} · {relative(a.uploadedAt)}{a.gps ? " · GPS" : ""}</div></figcaption>
            </figure>)}</div> : <div className="sm muted">No photos attached.</div>}
          </div>

          {v.clientSignoff && <div className="modal__section">
            <div className="ns-overline">Client sign-off</div>
            <div className="row row--wrap">
              <b>{v.clientSignoff.name}</b>
              {v.clientSignoff.rating ? <span>{"★".repeat(v.clientSignoff.rating)}</span> : null}
              {v.clientSignoff.signatureAttachmentId && <Thumbs ids={[v.clientSignoff.signatureAttachmentId]} size="lg" />}
            </div>
          </div>}

          {issues.length > 0 && <div className="modal__section">
            <div className="ns-overline">Issues raised on this visit</div>
            <ul className="lines">{issues.map((i) => i && <li key={i.id}><span className="grow">{i.title}</span><Badge variant={i.severity === "critical" ? "danger" : "warning"}>{i.severity}</Badge></li>)}</ul>
          </div>}
        </div>

        <footer className="modal__foot">
          {canCheck ? (rejecting ? <>
            <input className="ns-input grow" placeholder="Reason for rejection (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="ns-btn ns-btn--danger ns-btn--sm" onClick={() => { if (safe(() => api.check("site_visit", v.id, user.id, "rejected", comment), "Rejected — sent back")) onClose(); }}>Confirm reject</button>
            <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(false)}>Cancel</button>
          </> : <>
            <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => { if (safe(() => api.check("site_visit", v.id, user.id, "checked"), "Visit checked — costs and parts posted")) onClose(); }}>✓ Check visit</button>
            <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setRejecting(true)}>Reject…</button>
          </>) : <span className="sm muted">{v.reviewStatus === "pending" ? (v.submittedBy === user.id ? "You logged this — someone else must check it." : "You cannot check visits on this project.") : `Review complete.`}</span>}
          <button className="ns-btn ns-btn--ghost ns-btn--sm right" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
