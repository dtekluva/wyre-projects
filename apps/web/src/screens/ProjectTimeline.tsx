import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { EventType, Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { Timeline } from "../components/Timeline";

const GROUPS: Record<string, EventType[] | null> = {
  All: null,
  Evidence: ["document_added", "attachment_added", "check_passed", "check_rejected"],
  Approvals: ["gate_requested", "approval_decided", "stage_change", "po_approved"],
  Money: ["po_raised", "po_approved", "bill_received", "payment", "change_order", "delivery"],
  Field: ["visit", "issue_raised", "issue_closed"],
  People: ["role_granted", "role_revoked", "note", "project_created"],
};
export function ProjectTimeline() {
  const p = useOutletContext<Project>(); const api = useApi(); const [g, setG] = useState("All");
  const events = api.listEvents(p.id).filter((e) => !GROUPS[g] || GROUPS[g]!.includes(e.eventType));
  return (
    <div className="card">
      <div className="card__head"><div className="card__title">Chronology</div><span className="sm muted">{events.length} events · append-only</span></div>
      <div className="card__body">
        <div className="filters">{Object.keys(GROUPS).map((k) => <button key={k} className={`chip ${g === k ? "chip--on" : ""}`} onClick={() => setG(k)}>{k}</button>)}</div>
        <Timeline events={events} />
      </div>
    </div>
  );
}
