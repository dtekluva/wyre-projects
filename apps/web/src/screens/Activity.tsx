import { useState } from "react";
import { inRange } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Timeline } from "../components/Timeline";
import { DateRangePicker, useDateRange } from "../components/DateRange";
import { EVENT_GROUPS } from "./ProjectTimeline";

/**
 * Everything that happened, across every project you can see, by day. The demo question was "what was done
 * daily and weekly" — this answers it on one screen instead of a tab on each of eight projects.
 */
export function Activity() {
  const api = useApi(); const { user } = useAuth();
  const dr = useDateRange("week");
  const [g, setG] = useState("All"); const [pid, setPid] = useState(""); const [who, setWho] = useState("");
  const projects = api.listProjects(user.id); const visible = new Set(projects.map((p) => p.id));
  const all = api.listEvents().filter((e) => visible.has(e.projectId));
  const events = all.filter((e) => inRange(e.occurredAt, dr.range) && (!EVENT_GROUPS[g] || EVENT_GROUPS[g]!.includes(e.eventType)) && (!pid || e.projectId === pid) && (!who || e.actorId === who));
  const touched = new Set(events.map((e) => e.projectId)); const people = new Set(events.map((e) => e.actorId));
  const actors = Array.from(new Set(all.map((e) => e.actorId))).map((id) => ({ id, name: api.userName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  const byGroup = Object.entries(EVENT_GROUPS).filter(([k, v]) => k !== "All" && v).map(([k, v]) => ({ k, n: events.filter((e) => v!.includes(e.eventType)).length })).filter((x) => x.n > 0);
  return <>
    <div className="page-head"><div><h1 className="page-title">Activity</h1><div className="page-sub">what was done, by day · every project you can see</div></div></div>
    <div className="card">
      <div className="card__head"><div className="card__title">{events.length} event{events.length === 1 ? "" : "s"}</div>
        <span className="sm muted">{touched.size} project{touched.size === 1 ? "" : "s"} · {people.size} {people.size === 1 ? "person" : "people"}{byGroup.length ? " · " + byGroup.map((x) => `${x.n} ${x.k.toLowerCase()}`).join(" · ") : ""}</span></div>
      <div className="card__body">
        <div className="filters filters--stack">
          <DateRangePicker state={dr} />
          <div className="row row--wrap" style={{ gap: 8 }}>
            <div className="chips">{Object.keys(EVENT_GROUPS).map((k) => <button key={k} className={`chip ${g === k ? "chip--on" : ""}`} onClick={() => setG(k)}>{k}</button>)}</div>
            <select className="ns-input" style={{ width: "auto", minHeight: 32 }} value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project">
              <option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
            <select className="ns-input" style={{ width: "auto", minHeight: 32 }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
              <option value="">Everyone</option>{actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
        </div>
        <Timeline events={events} grouped showProject empty="Nothing in this period" />
      </div>
    </div>
  </>;
}
