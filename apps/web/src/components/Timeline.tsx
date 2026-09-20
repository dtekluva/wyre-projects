import { relative, type ChronologyEvent, type EventType } from "@wyre/api";
import { useApi } from "../lib/useApi";

const LABEL: Record<EventType, string> = {
  project_created: "Project", stage_change: "Stage", gate_requested: "Gate", approval_decided: "Approval",
  document_added: "Document", attachment_added: "Upload", check_passed: "Check", check_rejected: "Check",
  po_raised: "PO", po_approved: "PO", delivery: "Delivery", bill_received: "Bill", payment: "Payment",
  visit: "Visit", issue_raised: "Issue", issue_closed: "Issue", change_order: "Change order",
  role_granted: "Access", role_revoked: "Access", commissioning_assigned: "Assigned", note: "Note",
  stock_movement: "Stock", cost_item: "Budget", retention: "Retention", reconciliation: "Recon",
  issue: "Issue", commissioning: "Commissioning", hse: "HSE", warranty: "Warranty", stock_count: "Count",
};
export function variantOf(e: ChronologyEvent) {
  if (e.eventType === "check_rejected" || e.summary.startsWith("Rejected")) return "danger";
  if (["check_passed", "stage_change", "po_approved", "retention", "reconciliation"].includes(e.eventType) || e.summary.startsWith("Approved")) return "success";
  if (["hse", "issue"].includes(e.eventType) && !e.summary.startsWith("Resolved") && !e.summary.includes("→")) return "danger";
  if (["document_added", "attachment_added", "gate_requested", "po_raised", "delivery", "change_order", "approval_decided", "stock_movement", "cost_item", "visit", "commissioning", "commissioning_assigned", "warranty", "stock_count", "issue", "hse"].includes(e.eventType)) return "info";
  if (["note", "issue_raised", "visit"].includes(e.eventType)) return "warning";
  return "neutral";
}
export function Timeline({ events, limit }: { events: ChronologyEvent[]; limit?: number }) {
  const api = useApi();
  const list = limit ? events.slice(0, limit) : events;
  if (!list.length) return <div className="empty"><b>No activity yet</b></div>;
  return (
    <ul className="ns-timeline">
      {list.map((e) => <li key={e.id} className="ns-timeline__item">
        <span className={`ns-timeline__dot ns-timeline__dot--${variantOf(e)}`} />
        <div className="ns-timeline__row">
          <div className="ns-timeline__who"><span className="tl__type">{LABEL[e.eventType]}</span><b>{api.userName(e.actorId)}</b> · {e.summary}
            {e.detail && <div className="tl__detail">{e.detail}</div>}</div>
          <time className="ns-timeline__when" dateTime={e.occurredAt} title={new Date(e.occurredAt).toLocaleString()}>{relative(e.occurredAt)}</time>
        </div>
      </li>)}
    </ul>
  );
}
