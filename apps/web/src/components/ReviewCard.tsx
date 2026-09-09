import { useState } from "react";
import { Link } from "react-router-dom";
import { relative, type Attachment, type Document, type ReviewItem } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge } from "./ui";

export function ReviewCard({ item, selected, onToggle }: { item: ReviewItem; selected?: boolean; onToggle?: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  const project = api.projects.find((p) => p.id === item.projectId)!;
  const att = item.kind === "attachment" ? (item.item as Attachment) : undefined;
  const doc = item.kind === "document" ? (item.item as Document) : undefined;
  return (
    <article className="ns-approval ns-approval--pending">
      <div className="ns-approval__top">
        <div><div className="ns-overline">{item.kind === "document" ? "Document" : "Photo / file"} · <span className="ns-mono">{project.code}</span></div>
          <h3 className="ns-approval__title">{item.title}</h3></div>
        {onToggle && <input type="checkbox" className="checkbox" checked={!!selected} onChange={onToggle} aria-label="Select for bulk check" />}
      </div>
      <div className="review__body">
        <div className={`review__thumb ${att ? "review__thumb--img" : ""}`}>{att ? (att.kind === "image" ? "IMG" : "FILE") : "PDF"}</div>
        <div className="review__kv">
          <span>Submitted by</span><b>{api.userName(item.submittedBy)}</b>
          <span>When</span><b>{relative(item.submittedAt)} {item.overdue && <Badge variant="danger">overdue &gt; 3 d</Badge>}</b>
          <span>What</span><b>{item.subtitle}</b>
          <span>Project</span><b className="ellipsis">{project.name}</b>
          {att?.gps && <><span>GPS</span><b className="ns-mono">{att.gps.lat.toFixed(3)}, {att.gps.lng.toFixed(3)}</b></>}
          {att && <><span>sha256</span><b className="ns-mono">{att.sha256.slice(0, 12)}…</b></>}
          {doc && <><span>Version</span><b>v{doc.version} · {doc.fileName}</b></>}
        </div>
      </div>
      <div className="ns-approval__actions">
        {rejecting ? <>
          <textarea className="ns-textarea" placeholder="Reason for rejection (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="ns-btn ns-btn--danger ns-btn--sm" onClick={() => { if (safe(() => api.check(item.kind, item.id, user.id, "rejected", comment), "Rejected — sent back to maker")) setRejecting(false); }}>Confirm reject</button>
          <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(false)}>Cancel</button>
        </> : <>
          <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => api.check(item.kind, item.id, user.id, "checked"), "Checked")}>✓ Check</button>
          <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setRejecting(true)}>Reject…</button>
          <Link className="ns-btn ns-btn--ghost ns-btn--sm right" to={`/projects/${item.projectId}/documents`}>Open project</Link>
        </>}
      </div>
    </article>
  );
}
