import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { inRange, type EventType, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { Timeline } from "../components/Timeline";
import { DateRangePicker, useDateRange } from "../components/DateRange";

export const EVENT_GROUPS: Record<string, EventType[] | null> = {
  All: null,
  Evidence: ["document_added", "attachment_added", "check_passed", "check_rejected"],
  Approvals: ["gate_requested", "approval_decided", "stage_change", "stage_rollback", "po_approved"],
  Money: ["po_raised", "po_approved", "bill_received", "payment", "change_order", "delivery", "invoice", "contract_updated", "contract_received", "cost_item", "retention"],
  Stock: ["stock_movement", "stock_request", "stock_count", "delivery"],
  Field: ["visit", "issue_raised", "issue_closed", "issue", "commissioning", "hse", "warranty"],
  People: ["role_granted", "role_revoked", "note", "project_created", "project_updated", "plan_updated", "commissioning_assigned"],
};
export function ProjectTimeline() {
  const p = useOutletContext<Project>(); const api = useApi(); const [g, setG] = useState("All");
  const dr = useDateRange("all");
  const events = api.listEvents(p.id).filter((e) => (!EVENT_GROUPS[g] || EVENT_GROUPS[g]!.includes(e.eventType)) && inRange(e.occurredAt, dr.range));
  return (
    <div className="card">
      <div className="card__head"><div className="card__title">Chronology</div><span className="sm muted">{events.length} event{events.length === 1 ? "" : "s"} · append-only</span></div>
      <div className="card__body">
        <div className="filters filters--stack">
          <DateRangePicker state={dr} />
          <div className="chips">{Object.keys(EVENT_GROUPS).map((k) => <button key={k} className={`chip ${g === k ? "chip--on" : ""}`} onClick={() => setG(k)}>{k}</button>)}</div>
        </div>
        <Timeline events={events} grouped={dr.preset !== "all"} empty={dr.preset === "all" ? "No activity yet" : "Nothing in this period"} />
      </div>
    </div>
  );
}
