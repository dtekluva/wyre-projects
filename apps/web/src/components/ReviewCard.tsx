import { useState } from "react";
import { Link } from "react-router-dom";
import { COST_CATEGORY_LABEL, HSE_TYPE_LABEL, VISIT_TYPE_LABEL, naira, relative, type Attachment, type CommissioningRecord, type CostItem, type Document, type GoodsReceipt, type HseIncident, type Issue, type ReviewItem, type SiteVisit, type StockMovement, type WarrantyClaim } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useSafe } from "../lib/toast";
import { Badge } from "./ui";
import { Thumbs } from "./Thumbs";
import { FileLink } from "./FileLink";

const KIND_LABEL: Record<ReviewItem["kind"], string> = { document: "Document", attachment: "Photo / file", goods_receipt: "Goods receipt", stock_movement: "Stock movement", cost_item: "Budget line", site_visit: "Site visit", issue: "Issue", commissioning: "Commissioning", hse: "HSE incident", warranty: "Warranty claim", client_invoice: "Client invoice" };
const THUMB: Record<ReviewItem["kind"], string> = { document: "PDF", attachment: "IMG", goods_receipt: "GRN", stock_movement: "STK", cost_item: "₦", site_visit: "VIS", issue: "ISS", commissioning: "COM", hse: "HSE", warranty: "WTY", client_invoice: "INV" };

export function ReviewCard({ item, selected, onToggle }: { item: ReviewItem; selected?: boolean; onToggle?: () => void }) {
  const api = useApi(); const { user } = useAuth(); const safe = useSafe();
  const [rejecting, setRejecting] = useState(false); const [comment, setComment] = useState("");
  const project = item.projectId ? api.projects.find((p) => p.id === item.projectId) : undefined;
  const att = item.kind === "attachment" ? (item.item as Attachment) : undefined;
  const doc = item.kind === "document" ? (item.item as Document) : undefined;
  const grn = item.kind === "goods_receipt" ? (item.item as GoodsReceipt) : undefined;
  const mv = item.kind === "stock_movement" ? (item.item as StockMovement) : undefined;
  const ci = item.kind === "cost_item" ? (item.item as CostItem) : undefined;
  const vis = item.kind === "site_visit" ? (item.item as SiteVisit) : undefined;
  const iss = item.kind === "issue" ? (item.item as Issue) : undefined;
  const com = item.kind === "commissioning" ? (item.item as CommissioningRecord) : undefined;
  const hse = item.kind === "hse" ? (item.item as HseIncident) : undefined;
  const war = item.kind === "warranty" ? (item.item as WarrantyClaim) : undefined;
  const po = grn ? api.purchaseOrders.find((p) => p.id === grn.poId) : undefined;
  const link = !item.projectId ? "/inventory" : item.kind === "document" || item.kind === "attachment" ? `/projects/${item.projectId}/documents` : item.kind === "client_invoice" ? `/projects/${item.projectId}/money` : item.kind === "stock_movement" ? `/projects/${item.projectId}/assets` : ["site_visit", "issue", "commissioning", "hse", "warranty"].includes(item.kind) ? `/projects/${item.projectId}/field` : `/projects/${item.projectId}/money`;
  return (
    <article className="ns-approval ns-approval--pending">
      <div className="ns-approval__top">
        <div><div className="ns-overline">{KIND_LABEL[item.kind]} · <span className="ns-mono">{project?.code ?? "Stores"}</span></div>
          <h3 className="ns-approval__title">{item.title}</h3></div>
        {onToggle && <input type="checkbox" className="checkbox" checked={!!selected} onChange={onToggle} aria-label="Select for bulk check" />}
      </div>
      <div className="review__body">
        {att
          ? <FileLink kind="attachment" id={att.id} className="review__thumb review__thumb--img" title={`Open ${att.fileName}`}>
              {att.url && att.kind === "image" ? <img src={att.url} alt={att.caption ?? att.fileName} loading="lazy" /> : THUMB[item.kind]}
            </FileLink>
          : doc
          ? <FileLink kind="document" id={doc.id} className="review__thumb review__thumb--img" title={`Open ${doc.fileName}`}>
              {doc.url ? <img src={doc.url} alt={doc.title} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : THUMB[item.kind]}
            </FileLink>
          : <div className="review__thumb">{THUMB[item.kind]}</div>}
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
          {vis && <><span>Type</span><b>{VISIT_TYPE_LABEL[vis.visitType]} · {vis.durationHrs} h · {vis.technicianIds.map((t) => api.userName(t)).join(", ")}</b><span>Findings</span><b>{vis.findings}</b><span>Costs</span><b className="ns-mono">travel {naira(vis.costTravel, true)} · labour {naira(vis.costLabour, true)} · parts {naira(vis.costParts, true)}</b>
            {vis.parts.length ? <><span>Parts</span><b>{vis.parts.map((pt) => `${api.itemName(pt.itemId)} × ${pt.qty}`).join(" · ")} (post on check)</b></> : null}
            <span>Photos</span><b><Thumbs ids={vis.attachmentIds} empty="none" /></b>
            {vis.clientSignoff?.signatureAttachmentId && <><span>Signature</span><b><Thumbs ids={[vis.clientSignoff.signatureAttachmentId]} /></b></>}
            {vis.gps && <><span>GPS</span><b className="ns-mono">{vis.gps.lat.toFixed(3)}, {vis.gps.lng.toFixed(3)}</b></>}{vis.clientSignoff && <><span>Sign-off</span><b>{vis.clientSignoff.name}{vis.clientSignoff.rating ? " " + "★".repeat(vis.clientSignoff.rating) : ""}</b></>}</>}
          {iss && <><span>Severity</span><b>{iss.severity} · SLA {api.issueSla(iss).breached ? "BREACHED" : `${api.issueSla(iss).hoursLeft} h`}</b><span>Description</span><b>{iss.description}</b><span>Before</span><b><Thumbs ids={iss.beforeAttachmentIds} empty="no photo" /></b>
            {iss.afterAttachmentIds.length > 0 && <><span>After</span><b><Thumbs ids={iss.afterAttachmentIds} /></b></>}
            {iss.status === "resolved" && <><span>Root cause</span><b>{iss.rootCause}</b><span>Resolution</span><b>{iss.resolution}{iss.costToResolve ? ` · ${naira(iss.costToResolve)}` : ""}</b></>}</>}
          {com && <><span>Result</span><b style={{ textTransform: "uppercase" }}>{com.result}</b><span>Checklist</span><b>{com.items.filter((i) => i.pass).length}/{com.items.length} pass{com.items.some((i) => !i.pass) ? ` — fails: ${com.items.filter((i) => !i.pass).map((i) => i.label).join(", ")}` : ""}</b>
            <span>Meter integrity</span><b>{(Object.keys(com.meter) as (keyof typeof com.meter)[]).map((k) => `${k} ${com.meter[k] ? "✓" : "✗"}`).join(" · ")}</b><span>Photos</span><b><Thumbs ids={com.attachmentIds} empty="none" /></b>{com.clientWitness && <><span>Witness</span><b>{com.clientWitness.name}</b>{com.clientWitness.signatureAttachmentId && <><span>Signature</span><b><Thumbs ids={[com.clientWitness.signatureAttachmentId]} /></b></>}</>}<span>On check</span><b>generates gate-5 evidence documents</b></>}
          {hse && <><span>Type</span><b>{HSE_TYPE_LABEL[hse.type]} · {hse.severity}</b><span>What happened</span><b>{hse.description}</b><span>Actions</span><b>{hse.actions}</b><span>Photos</span><b><Thumbs ids={hse.attachmentIds} empty="none" /></b></>}
          {war && <><span>Status</span><b>{war.status}{war.costRecovered ? ` · ${naira(war.costRecovered)} recovered (credits the project on check)` : ""}</b><span>Notes</span><b>{war.notes}</b>{war.outcome && <><span>Outcome</span><b>{war.outcome}</b></>}</>}
          {mv && <><span>Unit cost (WAC)</span><b className="ns-mono">{naira(mv.unitCost)}</b><span>{mv.movementType === "issue" ? "From" : "To"}</span><b>{api.locationName(mv.locationFromId ?? mv.locationToId)}</b>
            <span>Evidence</span><b><Thumbs ids={mv.attachmentIds} empty="none" /></b>
            {mv.serials?.length ? <><span>Serials</span><b className="ns-mono sm">{mv.serials.slice(0, 4).join(", ")}{mv.serials.length > 4 ? ` … +${mv.serials.length - 4}` : ""}</b></> : null}</>}
        </div>
      </div>
      {grn && po && <ul className="lines">{grn.lines.map((l, i) => { const it = po.items.find((x) => x.id === l.purchaseItemId); return <li key={i}><span className="grow">{l.qty} × {it?.description}{l.condition === "damaged" && <Badge variant="danger">damaged</Badge>}</span>{l.serials && <span className="sm muted">{l.serials.length} serials</span>}<b className="ns-mono">{naira(l.qty * (it?.unitCost ?? 0))}</b></li>; })}
        <li className="sm muted"><span className="grow">Delivery evidence · to {api.locationName(grn.locationId)}</span><Thumbs ids={grn.attachmentIds} empty="no image" /></li></ul>}
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
