import { useEffect, useState } from "react";
import { ISSUE_STATUS_LABEL, fmtDate, fmtDateTime, naira, relative, type Issue } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge, ReviewBadge } from "./ui";
import { Thumbs } from "./Thumbs";
import { FilePick, type Pick } from "./FilePick";

const SEV: Record<Issue["severity"], "danger" | "warning" | "info" | "neutral"> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };

/** The full record behind an issue on the board: what was found, what has been added since, how it was fixed,
 *  and every file with its caption. Files can be added in any status; a checker can act on it here. */
export function IssueDetail({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  const [extra, setExtra] = useState<Pick[]>([]);
  const [resolving, setResolving] = useState(false); const [root, setRoot] = useState(""); const [res, setRes] = useState(""); const [cost, setCost] = useState(""); const [after, setAfter] = useState<Pick[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey); document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("modal-open"); };
  }, [onClose]);

  const i = api.issues.find((x) => x.id === issue.id) ?? issue;
  const sla = api.issueSla(i);
  const done = ["closed", "wont_fix", "resolved"].includes(i.status);
  const canUpdate = api.can(user.id, "issue.update", i.projectId);
  const canCheck = i.reviewStatus === "pending" && i.submittedBy !== user.id && api.can(user.id, "issue.check", i.projectId);
  const asset = i.assetId ? api.assets.find((a) => a.id === i.assetId) : undefined;
  const visit = i.linkedVisitId ? api.listVisits(i.projectId).find((v) => v.id === i.linkedVisitId) : undefined;
  const files = (ids: readonly string[]) => ids.map((id) => api.attachments.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  const Figures = ({ ids, empty }: { ids: readonly string[]; empty: string }) => {
    const list = files(ids);
    return list.length ? <div className="evidence">{list.map((a) => <figure key={a.id} className="evidence__item">
      <Thumbs ids={[a.id]} size="lg" />
      <figcaption className="sm">{a.caption || a.fileName}<div className="muted">{api.userName(a.uploadedBy)} · {relative(a.uploadedAt)}{a.gps ? " · GPS" : ""}</div></figcaption>
    </figure>)}</div> : <div className="sm muted">{empty}</div>;
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Issue detail" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal__panel">
        <header className="modal__head">
          <div style={{ minWidth: 0 }}>
            <div className="ns-overline">{api.projectCode(i.projectId)} · issue{i.isSnag ? " · snag" : ""}</div>
            <div className="modal__title">{i.title}</div>
            <div className="row row--wrap sm muted" style={{ gap: 8 }}>
              <Badge variant={SEV[i.severity]}>{i.severity}</Badge><span>{i.category}</span><span>·</span><b>{ISSUE_STATUS_LABEL[i.status]}</b>
              {sla.open && (sla.breached ? <Badge variant="danger">SLA breached by {Math.abs(sla.hoursLeft)} h</Badge> : <span>SLA {sla.hoursLeft} h left · due {fmtDate(i.slaDueAt)}</span>)}
            </div>
          </div>
          <ReviewBadge status={i.reviewStatus} />
          <button className="modal__x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="modal__scroll">
          <div className="review__kv">
            <span>Raised by</span><b>{api.userName(i.raisedBy)} · {fmtDateTime(i.raisedAt)}{i.source !== "manual" && <span className="muted"> · from {i.source.replace("_", " ")}</span>}</b>
            <span>Assigned to</span><b>{i.assigneeId ? api.userName(i.assigneeId) : <span className="muted">unassigned</span>}</b>
            {asset && <><span>Asset</span><b><span className="ns-mono">{asset.serial}</span> · {asset.make} {asset.model}{asset.warrantyEnd && <span className="muted"> · warranty to {fmtDate(asset.warrantyEnd)}</span>}</b></>}
            {visit && <><span>Linked visit</span><b>{fmtDate(visit.startedAt)} · {api.userName(visit.submittedBy)}</b></>}
            {i.checkedBy && <><span>Checked by</span><b>{api.userName(i.checkedBy)} · {relative(i.checkedAt!)}</b></>}
            {i.checkComment && <><span>Checker note</span><b>“{i.checkComment}”</b></>}
            <span>Description</span><b>{i.description || <span className="muted">—</span>}</b>
          </div>

          <div className="modal__section">
            <div className="ns-overline">Before ({i.beforeAttachmentIds.length})</div>
            <Figures ids={i.beforeAttachmentIds} empty="No before photo — raised from telemetry." />
          </div>

          <div className="modal__section">
            <div className="ns-overline">Files added ({i.attachmentIds.length})</div>
            <Figures ids={i.attachmentIds} empty="Nothing added yet — progress photos, a quote, a test sheet." />
            {canUpdate && <div className="stack" style={{ gap: 6, marginTop: 4 }}>
              <FilePick picks={extra} onChange={setExtra} multiple captions label="Add photos or files" captionPlaceholder="What does this show?" />
              {extra.length > 0 && <div className="row row--wrap">
                <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => {
                  if (safe(() => {
                    const ids = extra.map((f) => api.addAttachment(user.id, i.projectId, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, kind: f.file.type.startsWith("image/") ? "image" : "document", caption: f.caption?.trim() || `${i.title} — ${f.fileName}` }).id);
                    api.addIssuePhotos(user.id, i.id, { attachmentIds: ids });
                  }, i.reviewStatus === "checked" ? "Files added — the issue re-enters review" : "Files added")) setExtra([]);
                }}>Add {extra.length} file{extra.length > 1 ? "s" : ""}</button>
                {i.reviewStatus === "checked" && <span className="sm muted">this issue is already checked, so adding files sends it back for review</span>}
              </div>}
            </div>}
          </div>

          {(i.afterAttachmentIds.length > 0 || i.resolution) && <div className="modal__section">
            <div className="ns-overline">After ({i.afterAttachmentIds.length})</div>
            <Figures ids={i.afterAttachmentIds} empty="No after photo yet." />
            {i.resolution && <div className="review__kv" style={{ marginTop: 8 }}>
              {i.rootCause && <><span>Root cause</span><b>{i.rootCause}</b></>}
              <span>Resolution</span><b>{i.resolution}</b>
              <span>Extra cost</span><b className="ns-mono">{naira(i.costToResolve)}</b>
              {i.resolvedBy && <><span>Resolved by</span><b>{api.userName(i.resolvedBy)} · {relative(i.resolvedAt!)}</b></>}
            </div>}
          </div>}

          {canUpdate && !done && <div className="modal__section">
            <div className="ns-overline">Actions</div>
            {!resolving ? <div className="row row--wrap">
              {i.status === "open" && <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => safe(() => api.setIssueStatus(user.id, i.id, "in_progress", user.id), "In progress — assigned to you")}>Start work</button>}
              {i.status === "in_progress" && <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => safe(() => api.setIssueStatus(user.id, i.id, "awaiting_parts"), "Awaiting parts")}>Awaiting parts</button>}
              <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => setResolving(true)}>Resolve…</button>
            </div> : <div className="stack" style={{ gap: 6 }}>
              <input className="ns-input" placeholder="Root cause" value={root} onChange={(e) => setRoot(e.target.value)} />
              <input className="ns-input" placeholder="Resolution (required)" value={res} onChange={(e) => setRes(e.target.value)} />
              <div className="row row--wrap"><input className="ns-input" type="number" placeholder="Extra cost ₦" value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: 160 }} /><FilePick picks={after} onChange={setAfter} required label="After photo (required)" /></div>
              <div className="row">
                <button className="ns-btn ns-btn--primary ns-btn--sm" disabled={!after.length || !res.trim()} onClick={() => { if (safe(() => { const f = after[0]; const a = api.addAttachment(user.id, i.projectId, { fileName: f.fileName, sizeBytes: f.size, blob: f.file, caption: `After — ${i.title}` }); api.resolveIssue(user.id, i.id, { rootCause: root, resolution: res, afterAttachmentIds: [a.id], costToResolve: Number(cost) || 0 }); }, "Resolution submitted — pending check")) setResolving(false); }}>Submit resolution</button>
                <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setResolving(false)}>Cancel</button>
              </div>
            </div>}
          </div>}
        </div>

        <footer className="modal__foot">
          {canCheck ? (rejecting ? <>
            <input className="ns-input grow" placeholder="Reason for rejection (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="ns-btn ns-btn--danger ns-btn--sm" onClick={() => { if (safe(() => api.check("issue", i.id, user.id, "rejected", comment), "Rejected — sent back")) onClose(); }}>Confirm reject</button>
            <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(false)}>Cancel</button>
          </> : <>
            <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => { if (safe(() => api.check("issue", i.id, user.id, "checked"), i.status === "resolved" ? "Checked — issue closed" : "Issue checked")) onClose(); }}>✓ Check issue</button>
            <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setRejecting(true)}>Reject…</button>
          </>) : <span className="sm muted">{i.reviewStatus === "pending" ? (i.submittedBy === user.id ? "You submitted this — someone else must check it." : "You cannot check issues on this project.") : "Review complete."}</span>}
          <button className="ns-btn ns-btn--ghost ns-btn--sm right" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
