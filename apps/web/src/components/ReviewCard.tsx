import { useState } from "react";
import { Link } from "react-router-dom";
import { COST_CATEGORY_LABEL, naira, relative, type Attachment, type CostItem, type Document, type GoodsReceipt, type ReviewItem, type StockMovement } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge } from "./ui";

const KIND_LABEL: Record<ReviewItem["kind"], string> = { document: "Document", attachment: "Photo / file", goods_receipt: "Goods receipt", stock_movement: "Stock movement", cost_item: "Budget line", site_visit: "Site visit", issue: "Issue", commissioning: "Commissioning", hse: "HSE incident", warranty: "Warranty claim" };
const THUMB: Record<ReviewItem["kind"], string> = { document: "PDF", attachment: "IMG", goods_receipt: "GRN", stock_movement: "STK", cost_item: "₦", site_visit: "VIS", issue: "ISS", commissioning: "COM", hse: "HSE", warranty: "WTY" };

export function ReviewCard({ item, selected, onToggle }: { item: ReviewItem; selected?: boolean; onToggle?: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  const project = item.projectId ? api.projects.find((p) => p.id === item.projectId) : undefined;
  const att = item.kind === "attachment" ? (item.item as Attachment) : undefined;
  const doc = item.kind === "document" ? (item.item as Document) : undefined;
  const grn = item.kind === "goods_receipt" ? (item.item as GoodsReceipt) : undefined;
  const mv = item.kind === "stock_movement" ? (item.item as StockMovement) : undefined;
  const ci = item.kind === "cost_item" ? (item.item as CostItem) : undefined;
  const po = grn ? api.purchaseOrders.find((p) => p.id === grn.poId) : undefined;
  const link = !item.projectId ? "/inventory" : item.kind === "document" || item.kind === "attachment" ? `/projects/${item.projectId}/documents` : item.kind === "stock_movement" ? `/projects/${item.projectId}/assets` : ["site_visit", "issue", "commissioning", "hse", "warranty"].includes(item.kind) ? `/projects/${item.projectId}/field` : `/projects/${item.projectId}/money`;
  return (
    <article className="ns-approval ns-approval--pending">
      <div className="ns-approval__top">
        <div><div className="ns-overline">{KIND_LABEL[item.kind]} · <span className="ns-mono">{project?.code ?? "Stores"}</span></div>
          <h3 className="ns-approval__title">{item.title}</h3></div>
        {onToggle && <input type="checkbox" className="checkbox" checked={!!selected} onChange={onToggle} aria-label="Select for bulk check" />}
      </div>
      <div className="review__body">
        <div className={`review__thumb ${att ? "review__thumb--img" : ""}`}>{THUMB[item.kind]}</div>
        <div className="review__kv">
          <span>Submitted by</span><b>{api.userName(item.submittedBy)}</b>
          <span>When</span><b>{relative(item.submittedAt)} {item.overdue && <Badge variant="danger">overdue &gt; 3 d</Badge>}</b>
          <span>What</span><b>{item.subtitle}</b>
          {project && <><span>Project</span><b className="ellipsis">{project.name}</b></>}
          {item.amount !== undefined && <><span>Value</span><b className="ns-mono">{naira(item.amount)}</b></>}
          {att?.gps && <><span>GPS</span><b className="ns-mono">{att.gps.lat.toFixed(3)}, {att.gps.lng.toFixed(3)}</b></>}
          {att && <><span>sha256</span><b className="ns-mono">{att.sha256.slice(0, 12)}…</b></>}
          {doc && <><span>Version</span><b>v{doc.version} · {doc.fileName}</b></>}
          {ci && <><span>Category</span><b>{COST_CATEGORY_LABEL[ci.category]}</b></>}
          {mv && <><span>Unit cost (WAC)</span><b className="ns-mono">{naira(mv.unitCost)}</b><span>{mv.movementType === "issue" ? "From" : "To"}</span><b>{api.locationName(mv.locationFromId ?? mv.locationToId)}</b>
            {mv.serials?.length ? <><span>Serials</span><b className="ns-mono sm">{mv.serials.slice(0, 4).join(", ")}{mv.serials.length > 4 ? ` … +${mv.serials.length - 4}` : ""}</b></> : null}</>}
        </div>
      </div>
      {grn && po && <ul className="lines">{grn.lines.map((l, i) => { const it = po.items.find((x) => x.id === l.purchaseItemId); return <li key={i}><span className="grow">{l.qty} × {it?.description}{l.condition === "damaged" && <Badge variant="danger">damaged</Badge>}</span>{l.serials && <span className="sm muted">{l.serials.length} serials</span>}<b className="ns-mono">{naira(l.qty * (it?.unitCost ?? 0))}</b></li>; })}
        <li className="sm muted">Evidence: {grn.attachmentIds.length} image{grn.attachmentIds.length !== 1 ? "s" : ""} · to {api.locationName(grn.locationId)}</li></ul>}
      <div className="ns-approval__actions">
        {rejecting ? <>
          <textarea className="ns-textarea" placeholder="Reason for rejection (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="ns-btn ns-btn--danger ns-btn--sm" onClick={() => { if (safe(() => api.check(item.kind, item.id, user.id, "rejected", comment), "Rejected — sent back to maker")) setRejecting(false); }}>Confirm reject</button>
          <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setRejecting(false)}>Cancel</button>
        </> : <>
          <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => safe(() => api.check(item.kind, item.id, user.id, "checked"), "Checked")}>✓ Check</button>
          <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => setRejecting(true)}>Reject…</button>
          <Link className="ns-btn ns-btn--ghost ns-btn--sm right" to={link}>Open</Link>
        </>}
      </div>
    </article>
  );
}
