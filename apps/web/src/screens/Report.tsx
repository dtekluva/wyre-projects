import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { COST_CATEGORY_LABEL, DOC_TYPE_LABEL, ISSUE_STATUS_LABEL, MOVEMENT_LABEL, STOCK_REQUEST_STATUS_LABEL, VISIT_TYPE_LABEL,
  buildProjectReport, fmtDate, fmtDay, inRange, naira, narrativeFor, type ProjectNarrative, type ProjectReport } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useWaitFor } from "../lib/useWaitFor";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/**
 * The period summary — Mr. Idris, 2026-10-26: "a documented summary of a project generated weekly and monthly".
 * A print-ready page: the browser's Save as PDF is the PDF. Each project opens with a short paragraph Claude writes
 * from the chronology (money removed), cached for 48 h per project and window so reopening never costs a second call.
 */
export function Report() {
  const api = useApi(); const { user } = useAuth(); const [q] = useSearchParams();
  const range = { from: q.get("from") ?? undefined, to: q.get("to") ?? undefined };
  const windowKey = q.get("w") || `custom:${range.from}:${range.to}`; const only = q.get("p") || "";
  const seesMoney = api.can(user.id, "money.read");
  const visible = api.listProjects(user.id);
  const ids = only ? visible.filter((p) => p.id === only).map((p) => p.id)
    : visible.filter((p) => api.listEvents(p.id).some((e) => inRange(e.occurredAt, range))).map((p) => p.id);
  const reports: ProjectReport[] = useMemo(() => ids.map((id) => buildProjectReport(api, id, range, { money: seesMoney })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ids.join(","), range.from, range.to, seesMoney, api.events.length, api.narratives.length]);

  // Ask once per open; the server (and the demo engine) reuse anything written in the last 48 h.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !ids.length || !range.from || !range.to || !user.id) return;
    asked.current = true;
    try { api.requestNarratives(user.id, { from: range.from, to: range.to, windowKey, items: ids.map((projectId) => ({ projectId })) }); } catch { /* the page still renders without the paragraph */ }
  }, [api, ids.join(","), range.from, range.to, windowKey, user.id]);
  const paras = ids.map((id) => narrativeFor(api.narratives, id, windowKey));
  useWaitFor(paras.some((p) => p && (p.status === "queued" || p.status === "running")));

  const period = range.from === range.to ? fmtDay(range.from ?? "") : `${fmtDay(range.from ?? "")} – ${fmtDay(range.to ?? "")}`;
  if (!range.from || !range.to) return <div className="report"><p>Pick a period in Activity first.</p></div>;
  return <div className="report">
    <div className="report__bar no-print">
      <span className="sm muted">Use <b>Save as PDF</b> as the printer to keep a copy.</span>
      <span className="grow" />
      <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => window.print()}>Save as PDF</button>
      <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => window.close()}>Close</button>
    </div>
    <header className="report__head">
      <img src="/wyre-logo.png" alt="Wyre" className="report__logo" />
      <div><div className="report__kicker">Project summary</div><h1 className="report__title">{period}</h1>
        <div className="report__meta">{n(reports.length, "project")} · prepared {new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} by {user.name}{seesMoney ? "" : " · money figures not included for this role"}</div></div>
    </header>
    {!reports.length && <p className="report__empty">Nothing was recorded on any project in this period.</p>}
    {reports.map((r, i) => <ProjectSection key={r.projectId} r={r} para={paras[i]} />)}
    <footer className="report__foot">Wyre Projects Tracker · tracker.wyreng.com · figures are from checked records at the time this page was opened</footer>
  </div>;
}

function Para({ p }: { p?: ProjectNarrative }) {
  if (!p) return null;
  if (p.status === "queued" || p.status === "running") return <p className="report__para report__para--wait">Writing the summary…</p>;
  if (p.status === "failed") return <p className="report__para report__para--wait">The written summary could not be produced this time ({p.error || "unknown error"}). The facts below are complete.</p>;
  return <div className="report__para"><p>{p.text}</p>
    <div className="report__by">{p.modelName === "demo" ? "Demo build — no Claude" : `Written by Claude from the tracker's records on ${fmtDate(p.finishedAt ?? p.requestedAt)} · refreshed at most every 48 h`}</div></div>;
}

function ProjectSection({ r, para }: { r: ProjectReport; para?: ProjectNarrative }) {
  const api = useApi();
  const tiles: [string, string | number][] = [["Events", r.events.length], ["Site visits", r.visits.length], ["Issues raised", r.issuesRaised.length], ["Issues resolved", r.issuesResolved.length],
    ["Documents", r.documents.length], ["Checks passed", r.checksPassed], ...(r.money ? [["Spent", naira(r.money.spend.total, true)] as [string, string]] : [])];
  return <section className="report__project">
    <div className="report__phead">
      <div><h2>{r.name}</h2><div className="report__meta">{r.code} · {r.client} · {r.location} · PM {api.userName(r.pmId)}</div></div>
      <div className="report__stage"><span className={`report__rag report__rag--${r.rag}`}>{r.rag}</span><b>{r.stageName}</b>{r.ragReason && <div className="report__meta">{r.ragReason}</div>}</div>
    </div>
    <Para p={para} />
    <div className="report__tiles">{tiles.map(([k, v]) => <div key={k} className="report__tile"><b>{v}</b><span>{k}</span></div>)}</div>

    {r.progress.length > 0 && <Block title="Progress through the stages"><ul>{r.progress.map((e) => <li key={e.id}><span className="report__d">{fmtDate(e.occurredAt)}</span>{e.summary}</li>)}</ul></Block>}
    {(r.visits.length > 0 || r.issuesRaised.length > 0 || r.issuesResolved.length > 0) && <Block title="On site">
      {r.visits.length > 0 && <table><thead><tr><th>Date</th><th>Visit</th><th>By</th><th>Found / did</th></tr></thead><tbody>{r.visits.map((v) => <tr key={v.id}>
        <td>{fmtDate(v.startedAt)}</td><td>{VISIT_TYPE_LABEL[v.visitType]}</td><td>{v.technicianIds.map((t) => api.userName(t)).join(", ")}</td><td>{v.findings}{v.actionsTaken ? ` — ${v.actionsTaken}` : ""}</td></tr>)}</tbody></table>}
      {r.issuesRaised.length > 0 && <><h4>Issues raised</h4><ul>{r.issuesRaised.map((i) => <li key={i.id}><span className="report__d">{fmtDate(i.raisedAt)}</span><b>{i.severity}</b> · {i.title} · {ISSUE_STATUS_LABEL[i.status]}</li>)}</ul></>}
      {r.issuesResolved.length > 0 && <><h4>Issues resolved</h4><ul>{r.issuesResolved.map((i) => <li key={i.id}><span className="report__d">{fmtDate(i.resolvedAt)}</span>{i.title}{i.resolution ? ` — ${i.resolution}` : ""}</li>)}</ul></>}
    </Block>}
    {(r.documents.length > 0 || r.files > 0 || r.checksPassed + r.checksRejected > 0) && <Block title="Documents and evidence">
      <p>{n(r.documents.length, "document")} and {n(r.files, "photo or file", "photos and files")} added · {n(r.checksPassed, "check")} passed{r.checksRejected ? `, ${r.checksRejected} rejected` : ""}.</p>
      {r.documents.length > 0 && <ul>{r.documents.map((d) => <li key={d.id}><span className="report__d">{fmtDate(d.submittedAt)}</span>{DOC_TYPE_LABEL[d.docType]} — {d.title} · {d.reviewStatus}</li>)}</ul>}
    </Block>}
    {(r.stock.length > 0 || r.requests.length > 0) && <Block title="Stock">
      {r.stock.length > 0 && <ul>{r.stock.map((m) => <li key={m.id}><span className="report__d">{fmtDate(m.createdAt)}</span>{MOVEMENT_LABEL[m.movementType]} · {api.itemName(m.itemId)} × {m.qty} · {m.reviewStatus}</li>)}</ul>}
      {r.requests.length > 0 && <><h4>Requests to the store</h4><ul>{r.requests.map((q) => <li key={q.id}><span className="report__d">{fmtDate(q.requestedAt)}</span>{q.lines.map((l) => `${api.itemName(l.itemId)} × ${l.qty}`).join(", ")} · {STOCK_REQUEST_STATUS_LABEL[q.status]}</li>)}</ul></>}
    </Block>}
    {r.money && <Block title="Money in the period">
      <p>Spent <b>{naira(r.money.spend.total)}</b>{r.money.spend.pendingTotal ? `, plus ${naira(r.money.spend.pendingTotal)} in expenses waiting for Finance` : ""} · {n(r.money.pos.length, "purchase order")} raised{r.money.invoiced ? ` · invoiced ${naira(r.money.invoiced)} gross` : ""}{r.money.vatPaid ? ` · VAT paid ${naira(r.money.vatPaid)}` : ""}.</p>
      {r.money.spend.byCategory.length > 0 && <table><thead><tr><th>Category</th><th className="num">Spent</th></tr></thead><tbody>{r.money.spend.byCategory.map((c) => <tr key={c.category}><td>{COST_CATEGORY_LABEL[c.category]}</td><td className="num">{naira(c.amount)}</td></tr>)}</tbody></table>}
      {r.money.pos.length > 0 && <ul>{r.money.pos.map((po) => <li key={po.id}><span className="report__d">{fmtDate(po.raisedAt)}</span>{po.poNumber} · {api.vendorName(po.vendorId)} · {naira(po.total)} · {po.status.replace(/_/g, " ")}</li>)}</ul>}
    </Block>}
    <Block title="Still open">
      <p>{n(r.open.issues.length, "open issue")}{r.open.issues.length ? ` (${["critical", "high", "medium", "low"].map((s) => [s, r.open.issues.filter((i) => i.severity === s).length] as const).filter(([, k]) => k).map(([s, k]) => `${k} ${s}`).join(", ")})` : ""} · {n(r.open.pendingChecks, "item")} waiting for a check · {n(r.open.requestsWaiting, "stock request")} waiting at the store.</p>
    </Block>
    {r.days.length > 0 && <Block title="Day by day">{r.days.map((g) => <div key={g.day} className="report__day"><h4>{fmtDay(g.day)}</h4>
      <ul>{g.items.slice().reverse().map((e) => <li key={e.id}><span className="report__d">{time(e.occurredAt)}</span><b>{api.userName(e.actorId)}</b> · {e.summary}</li>)}</ul></div>)}</Block>}
  </section>;
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="report__block"><h3>{title}</h3>{children}</div>;
