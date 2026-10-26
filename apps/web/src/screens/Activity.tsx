import { useState } from "react";
import { RANGE_LABEL, inRange, windowKeyFor, ymd } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { Timeline } from "../components/Timeline";
import { DateRangePicker, useDateRange } from "../components/DateRange";
import { EVENT_GROUPS } from "./ProjectTimeline";
import { SpendPanel } from "../components/SpendPanel";

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
  const seesMoney = api.can(user.id, "money.read");
  const r = dr.range;
  // All time has no dates of its own: the summary runs from the first thing ever recorded to today (Akanimo, 2026-10-26).
  const firstEver = all.reduce((m, e) => (!m || e.occurredAt < m ? e.occurredAt : m), "");
  const sumRange = dr.preset === "all" ? { from: firstEver ? ymd(new Date(firstEver)) : undefined, to: ymd(new Date()) } : r;
  const complete = !!(sumRange.from && sumRange.to);
  // the summary covers every open project — active ones in full, quiet ones listed — whatever the type and person filters show
  const activeIds = new Set(all.filter((e) => inRange(e.occurredAt, r)).map((e) => e.projectId)); const inPeriod = activeIds.size;
  const quietOpen = projects.filter((p) => p.stage < 8 && !activeIds.has(p.id)).length;
  // The summary opens as a print-ready page in its own tab: the browser's "Save as PDF" is the PDF (user's choice, 2026-10-26).
  const openSummary = () => window.open(`/report?from=${sumRange.from}&to=${sumRange.to}&w=${encodeURIComponent(windowKeyFor(dr.preset, r))}${pid ? `&p=${pid}` : ""}`, "_blank");
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
            <button className="ns-btn ns-btn--primary ns-btn--sm" disabled={!complete} title={complete ? "" : "Pick both dates first"} onClick={openSummary}>
              ⤓ Summary PDF{pid ? "" : ` · ${inPeriod} active${quietOpen ? ` + ${quietOpen} quiet` : ""}`}</button>
          </div>
        </div>
        {g === "Money" && seesMoney && <SpendPanel range={r} projectIds={pid ? new Set([pid]) : visible} label={dr.preset === "custom" ? "custom period" : RANGE_LABEL[dr.preset].toLowerCase()} />}
        <Timeline events={events} grouped showProject empty="Nothing in this period" />
      </div>
    </div>
  </>;
}
