import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { DOC_TYPE_LABEL, ISSUE_STATUS_LABEL, MOVEMENT_LABEL, STOCK_REQUEST_STATUS_LABEL, VISIT_TYPE_LABEL,
  STAGES, buildProjectReport, fmtDate, fmtDay, inRange, installedSentence, naira, narrativeFor, type ProjectNarrative, type ProjectReport } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useWaitFor } from "../lib/useWaitFor";
import { ActivityChart, BudgetMeter, Figure, InstalledFigure, KeyMoments, MiniBar, OpenFigure, SpendBars, StageTrack } from "../components/ReportCharts";

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
  // v2 = the essay (Akanimo, 2026-11-04: "make it an essay … the list could be summarised"). A new key so the short v1
  // paragraphs already cached are not reused; the 48 h rule applies to the essay as before.
  const cacheKey = `v2:${windowKey}`;
  const [details, setDetails] = useState(false);
  const seesMoney = api.can(user.id, "money.read");
  const visible = api.listProjects(user.id);
  const active = (id: string) => api.listEvents(id).some((e) => inRange(e.occurredAt, range));
  // Every open project belongs in the summary. Ones with activity get a full section; quiet ones are listed at the end so
  // nobody reads their absence as a missing project (Akanimo, 2026-10-26: "why does it only show 2 projects?").
  const ids = only ? visible.filter((p) => p.id === only).map((p) => p.id) : visible.filter((p) => active(p.id)).map((p) => p.id);
  const quiet = only ? [] : visible.filter((p) => p.stage < 8 && !active(p.id));
  const reports: ProjectReport[] = useMemo(() => ids.map((id) => buildProjectReport(api, id, range, { money: seesMoney })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ids.join(","), range.from, range.to, seesMoney, api.events.length, api.narratives.length]);

  // Ask once for each set of projects on the page — again only if the set grows (data still arriving). The server and
  // the demo engine reuse anything written in the last 48 h, so a repeat ask never costs a second paragraph.
  const toAsk = ids.filter(active);
  const asked = useRef("");
  useEffect(() => {
    const key = `${cacheKey}|${toAsk.join(",")}`;
    if (asked.current === key || !toAsk.length || !range.from || !range.to || !user.id) return;
    asked.current = key;
    try { api.requestNarratives(user.id, { from: range.from, to: range.to, windowKey: cacheKey, items: toAsk.map((projectId) => ({ projectId })) }); } catch { /* the page still renders without the paragraph */ }
  }, [api, toAsk.join(","), range.from, range.to, cacheKey, user.id]);
  const paras = ids.map((id) => narrativeFor(api.narratives, id, cacheKey));
  useWaitFor(paras.some((p) => p && (p.status === "queued" || p.status === "running")));

  const period = windowKey === "all" ? `All time · since ${fmtDay(range.from ?? "")}`
    : range.from === range.to ? fmtDay(range.from ?? "") : `${fmtDay(range.from ?? "")} – ${fmtDay(range.to ?? "")}`;
  if (!range.from || !range.to) return <div className="report"><p>Pick a period in Activity first.</p></div>;
  return <div className="report">
    <div className="report__bar no-print">
      <span className="sm muted">Use <b>Save as PDF</b> as the printer to keep a copy.</span>
      <label className="sm report__toggle"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Include the detailed records and full activity log</label>
      <span className="grow" />
      <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => window.print()}>Save as PDF</button>
      <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => window.close()}>Close</button>
    </div>
    <header className="report__head">
      <img src="/wyre-logo.png" alt="Wyre" className="report__logo" />
      <div><div className="report__kicker">Project summary</div><h1 className="report__title">{period}</h1>
        <div className="report__meta">{only ? "1 project" : `${n(ids.length, "project")} with activity${quiet.length ? ` · ${quiet.length} with nothing recorded` : ""}`} · prepared {new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} by {user.name}{seesMoney ? "" : " · money figures not included for this role"}</div></div>
    </header>
    {!reports.length && !quiet.length && <p className="report__empty">Nothing was recorded on any project in this period.</p>}
    {reports.length > 1 && <Portfolio reports={reports} money={seesMoney} />}
    {reports.map((r, i) => <ProjectSection key={r.projectId} r={r} para={paras[i]} details={details} />)}
    {quiet.length > 0 && <section className="report__project report__quiet">
      <h2>Nothing recorded in this period</h2>
      <div className="report__meta">Open projects with no activity between these dates — listed so the summary covers the whole portfolio.</div>
      <div className="report__block"><table><thead><tr><th>Project</th><th>Stage</th><th>Status</th><th className="num">Open issues</th><th className="num">Waiting for a check</th><th>Last activity</th></tr></thead>
        <tbody>{quiet.map((p) => { const last = api.listEvents(p.id)[0]; return <tr key={p.id}>
          <td><Link to={`/projects/${p.id}`} className="report__plink">{p.name}</Link><div className="report__meta">{p.code} · {p.clientName}</div></td>
          <td>{STAGES.find((s) => s.stage === p.stage)?.short ?? p.stage}</td><td><span className={`report__rag report__rag--${p.rag}`}>{p.rag}</span></td>
          <td className="num">{api.listIssues({ projectId: p.id, openOnly: true }).length}</td><td className="num">{api.pendingChecks(p.id)}</td>
          <td>{last ? fmtDate(last.occurredAt) : "never"}</td></tr>; })}</tbody></table></div>
    </section>}
    <footer className="report__foot">Wyre Projects Tracker · tracker.wyreng.com · figures are from checked records at the time this page was opened</footer>
  </div>;
}

const isEssay = (p?: ProjectNarrative) => !!p && p.status === "done" && p.modelName !== "demo";

function Para({ p, empty }: { p?: ProjectNarrative; empty?: boolean }) {
  if (empty) return <p className="report__para report__para--wait">Nothing was recorded on this project in the period.</p>;
  if (!p) return null;
  if (p.status === "queued" || p.status === "running") return <p className="report__para report__para--wait">Writing the summary… the detailed records are shown below until it is ready.</p>;
  if (p.status === "failed") return <p className="report__para report__para--wait">The written summary could not be produced this time ({p.error || "unknown error"}). The detailed records below are complete.</p>;
  return <div className="report__para report__essay">{p.text.split(/\n\s*\n/).map((t, i) => <p key={i}>{t.trim()}</p>)}
    <div className="report__by">{p.modelName === "demo" ? "Demo build — no Claude" : `Written by Claude from the tracker's records on ${fmtDate(p.finishedAt ?? p.requestedAt)} · refreshed at most every 48 h`}</div></div>;
}

/** Page one of a multi-project summary: every active project on one line, so the period reads at a glance. */
function Portfolio({ reports, money }: { reports: ProjectReport[]; money: boolean }) {
  const maxEv = Math.max(...reports.map((r) => r.events.length));
  const maxSp = money ? Math.max(...reports.map((r) => r.money?.spend.total ?? 0)) : 0;
  const totEv = reports.reduce((t, r) => t + r.events.length, 0);
  const totSp = reports.reduce((t, r) => t + (r.money?.spend.total ?? 0), 0);
  const totOpen = reports.reduce((t, r) => t + r.open.issues.length, 0);
  const totKwp = reports.reduce((t, r) => t + r.installed.panelsKwp, 0);
  return <section className="report__project report__overview">
    <h2>Portfolio at a glance</h2>
    <div className="report__tiles">
      <div className="report__tile"><b>{reports.length}</b><span>Projects with activity</span></div>
      <div className="report__tile"><b>{totEv}</b><span>Actions recorded</span></div>
      {money && <div className="report__tile"><b>{naira(totSp, true)}</b><span>Spent in the period</span></div>}
      <div className="report__tile"><b>{totOpen}</b><span>Open issues now</span></div>
      <div className="report__tile"><b>{fmtQtyKwp(totKwp)}</b><span>Panels installed to date</span></div>
    </div>
    <table className="ptable"><thead><tr><th>Project</th><th>Stage</th><th>Actions in period</th>{money && <th>Spent in period</th>}<th className="num">Open issues</th><th className="num">Installed</th></tr></thead>
      <tbody>{reports.map((r) => <tr key={r.projectId}>
        <td><b>{r.name}</b><div className="report__meta">{r.code} · <span className={`report__rag report__rag--${r.rag}`}>{r.rag}</span></div></td>
        <td><StageTrack stage={r.stage} planned={r.stagePlanned} actual={r.stageActual} compact /><div className="report__meta">{r.stageName}</div></td>
        <td><MiniBar value={r.events.length} max={maxEv} label={String(r.events.length)} /></td>
        {money && <td><MiniBar value={r.money?.spend.total ?? 0} max={maxSp} label={naira(r.money?.spend.total ?? 0, true)} /></td>}
        <td className="num">{r.open.issues.length}{r.open.issues.some((i) => i.severity === "critical") ? <div className="report__meta">{r.open.issues.filter((i) => i.severity === "critical").length} critical</div> : null}</td>
        <td className="num">{r.installed.panelsKwp ? `${fmtQtyKwp(r.installed.panelsKwp)}` : "—"}</td>
      </tr>)}</tbody></table>
    <div className="rfig__note">Bars compare projects within this summary. Stage blocks: filled = reached, outlined = current, grey = still to come. Installed = panels issued to site and checked, to date.</div>
  </section>;
}
const fmtQtyKwp = (k: number) => `${Math.round(k * 100) / 100} kWp`;

function ProjectSection({ r, para, details }: { r: ProjectReport; para?: ProjectNarrative; details: boolean }) {
  const api = useApi();
  // The essay carries the story; the lists it was written from stay available behind the toolbar switch. Until the essay
  // exists (being written, failed, demo build) the lists are what the reader has, so they show.
  const show = details || !isEssay(para);
  const kit = installedSentence(r.installed);
  const lastVisit = r.visits.map((v) => v.startedAt).sort().pop();
  const unit = r.activity[0]?.unit ?? "day";
  const tiles: [string, string | number, string][] = [
    ["Actions recorded", r.events.length, `on ${n(r.activeDays, "day")}`],
    ["Site visits", r.visits.length, lastVisit ? `last ${fmtDate(lastVisit)}` : "none in the period"],
    ["Issues raised", r.issuesRaised.length, `${r.issuesResolved.length} resolved`],
    ["Documents added", r.documents.length, `+ ${n(r.files, "photo or file", "photos and files")}`],
    ["Checks passed", r.checksPassed, r.checksRejected ? `${r.checksRejected} rejected` : "none rejected"],
    ...(r.money ? [["Spent", naira(r.money.spend.total, true), r.money.spend.pendingTotal ? `+ ${naira(r.money.spend.pendingTotal, true)} awaiting Finance` : "checked, in the period"] as [string, string, string]] : []),
  ];
  return <section className="report__project">
    <div className="report__phead">
      <div><h2>{r.name}</h2><div className="report__meta">{r.code} · {r.client} · {r.location} · PM {api.userName(r.pmId)}</div></div>
      <div className="report__stage"><span className={`report__rag report__rag--${r.rag}`}>{r.rag}</span><b>{r.stageName}</b>{r.ragReason && <div className="report__meta">{r.ragReason}</div>}</div>
    </div>
    <Figure title="Where the project stands" note="Filled blocks are stages reached, with the date reached; the outlined block is the current stage; grey blocks are still to come, with their planned dates.">
      <StageTrack stage={r.stage} planned={r.stagePlanned} actual={r.stageActual} />
    </Figure>
    <Para p={para} empty={!r.events.length} />
    <div className="report__tiles">{tiles.map(([k, v, sub]) => <div key={k} className="report__tile"><b>{v}</b><span>{k}</span><em>{sub}</em></div>)}</div>
    <Figure title={`Activity in the period, per ${unit}`} note={<>Every action recorded on the project, by kind — hover a column on screen for its counts. <span className="km-diamond">◆</span> marks a stage move or gate decision.</>}>
      <ActivityChart buckets={r.activity} />
    </Figure>
    <div className="report__cols">
      <Figure title="Installed so far" note={kit ? <>To date, issued to site and checked, less returns: {kit}.</> : "Counts equipment issued to the project and checked."}>
        <InstalledFigure inst={r.installed} />
      </Figure>
      <Figure title="Still open" note="Open issues as of today, worst first.">
        <OpenFigure issues={r.open.issues} pendingChecks={r.open.pendingChecks} requestsWaiting={r.open.requestsWaiting} />
      </Figure>
    </div>
    {r.money && <div className="report__cols">
      <Figure title="Spent in the period, by category" note={<>Checked costs dated in the period · {n(r.money.pos.length, "purchase order")} raised{r.money.invoiced ? ` · invoiced ${naira(r.money.invoiced, true)} gross` : ""}{r.money.vatPaid ? ` · VAT paid ${naira(r.money.vatPaid, true)}` : ""}.</>}>
        <SpendBars spend={r.money.spend} />
      </Figure>
      <Figure title="Budget used to date" note="All checked spend on the project against its checked budget lines.">
        <BudgetMeter {...r.money.budget} />
      </Figure>
    </div>}
    {!show && r.highlights.length > 0 && <Figure title="Key moments" note="Solid dots are stage moves, gate decisions and contract events; hollow dots are other notable events.">
      <KeyMoments events={r.highlights} /></Figure>}

    {show && r.progress.length > 0 && <Block title="Progress through the stages"><ul>{r.progress.map((e) => <li key={e.id}><span className="report__d">{fmtDate(e.occurredAt)}</span>{e.summary}</li>)}</ul></Block>}
    {show && (r.visits.length > 0 || r.issuesRaised.length > 0 || r.issuesResolved.length > 0) && <Block title="On site">
      {r.visits.length > 0 && <table><thead><tr><th>Date</th><th>Visit</th><th>By</th><th>Found / did</th></tr></thead><tbody>{r.visits.map((v) => <tr key={v.id}>
        <td>{fmtDate(v.startedAt)}</td><td>{VISIT_TYPE_LABEL[v.visitType]}</td><td>{v.technicianIds.map((t) => api.userName(t)).join(", ")}</td><td>{v.findings}{v.actionsTaken ? ` — ${v.actionsTaken}` : ""}</td></tr>)}</tbody></table>}
      {r.issuesRaised.length > 0 && <><h4>Issues raised</h4><ul>{r.issuesRaised.map((i) => <li key={i.id}><span className="report__d">{fmtDate(i.raisedAt)}</span><b>{i.severity}</b> · {i.title} · {ISSUE_STATUS_LABEL[i.status]}</li>)}</ul></>}
      {r.issuesResolved.length > 0 && <><h4>Issues resolved</h4><ul>{r.issuesResolved.map((i) => <li key={i.id}><span className="report__d">{fmtDate(i.resolvedAt)}</span>{i.title}{i.resolution ? ` — ${i.resolution}` : ""}</li>)}</ul></>}
    </Block>}
    {show && (r.documents.length > 0 || r.files > 0) && <Block title="Documents and evidence">
      {r.documents.length > 0 && <ul>{r.documents.map((d) => <li key={d.id}><span className="report__d">{fmtDate(d.submittedAt)}</span>{DOC_TYPE_LABEL[d.docType]} — {d.title} · {d.reviewStatus}</li>)}</ul>}
    </Block>}
    {show && (r.stock.length > 0 || r.requests.length > 0) && <Block title="Stock">
      {r.stock.length > 0 && <ul>{r.stock.map((m) => <li key={m.id}><span className="report__d">{fmtDate(m.createdAt)}</span>{MOVEMENT_LABEL[m.movementType]} · {api.itemName(m.itemId)} × {m.qty} · {m.reviewStatus}</li>)}</ul>}
      {r.requests.length > 0 && <><h4>Requests to the store</h4><ul>{r.requests.map((q) => <li key={q.id}><span className="report__d">{fmtDate(q.requestedAt)}</span>{q.lines.map((l) => `${api.itemName(l.itemId)} × ${l.qty}`).join(", ")} · {STOCK_REQUEST_STATUS_LABEL[q.status]}</li>)}</ul></>}
    </Block>}
    {show && r.money && r.money.pos.length > 0 && <Block title="Purchase orders raised"><ul>{r.money.pos.map((po) => <li key={po.id}><span className="report__d">{fmtDate(po.raisedAt)}</span>{po.poNumber} · {api.vendorName(po.vendorId)} · {naira(po.total)} · {po.status.replace(/_/g, " ")}</li>)}</ul></Block>}
    {details && r.days.length > 0 && <Block title="Full activity log">{r.days.map((g) => <div key={g.day} className="report__day"><h4>{fmtDay(g.day)}</h4>
      <ul>{g.items.slice().reverse().map((e) => <li key={e.id}><span className="report__d">{time(e.occurredAt)}</span><b>{api.userName(e.actorId)}</b> · {e.summary}</li>)}</ul></div>)}</Block>}
  </section>;
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="report__block"><h3>{title}</h3>{children}</div>;
