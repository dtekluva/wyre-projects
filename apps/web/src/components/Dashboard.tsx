import { Link, useNavigate } from "react-router-dom";
import { STAGES, daysBetween, naira, type Project } from "@wyre/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { BarChart, StatStrip, type BarDatum } from "./charts";

const DAY = 86400000;

/** Spec §7 portfolio view: what needs a person, then where the portfolio actually stands. */
export function Dashboard({ projects }: { projects: Project[] }) {
  const api = useApi(); const { user } = useAuth(); const nav = useNavigate();
  const seesMoney = api.can(user.id, "money.read");
  const seesStock = api.can(user.id, "inventory.read");
  const seesRecon = api.can(user.id, "recon.read");
  const now = Date.now(); const today = new Date().toISOString();
  const live = projects.filter((p) => p.stage < 8);

  // ---- attention: the things a person can act on today -------------------------------------------------
  const queue = api.reviewQueue(user.id);
  const overdueChecks = queue.filter((q) => q.overdue).length;
  const myApprovals = api.approvalsFor(user.id).length;
  const gatesReady = live.filter((p) => { const g = api.gateStatus(p.id); return g.ready && !g.pendingApproval; }).length;
  const expiring = projects.flatMap((p) => api.listDocuments(p.id)
    .filter((d) => d.expiresAt && d.reviewStatus === "checked" && new Date(d.expiresAt).getTime() - now < 90 * DAY)
    .map((d) => ({ p, d, days: Math.round((new Date(d.expiresAt!).getTime() - now) / DAY) })))
    .sort((a, b) => a.days - b.days);
  const breached = projects.flatMap((p) => api.listIssues({ projectId: p.id, openOnly: true })).filter((i) => api.issueSla(i).breached);
  const slipping = live.filter((p) => { const planned = p.stagePlanned[p.stage]; return planned && planned < today; })
    .map((p) => ({ p, slip: daysBetween(p.stagePlanned[p.stage]!, today) })).sort((a, b) => b.slip - a.slip);
  const belowReorder = seesStock ? api.balances().filter((b) => b.belowReorder && b.qtyOnHand <= 0 === false && b.locationId === api.mainLocationId()).length : 0;
  const unmatched = seesRecon ? api.listQbBills().filter((b) => b.confidence !== "matched").length : 0;
  // VAT the company still owes FIRS (or has not yet seen settled by a withholding client), by project.
  const vatOpen = seesMoney ? live.map((p) => ({ p, m: api.money(p.id) })).filter((x) => x.m.vatOutstanding > 0) : [];
  const vatOpenTotal = vatOpen.reduce((s, x) => s + x.m.vatOutstanding, 0);
  const drafts = live.filter((p) => p.contractStatus === "draft");

  const attention = [
    { key: "checks", n: queue.length, sub: overdueChecks ? `${overdueChecks} over 3 days` : "none overdue", label: "Awaiting my check", to: "/work/reviews", tone: overdueChecks ? "bad" : queue.length ? "warn" : undefined },
    { key: "appr", n: myApprovals, sub: "gates, POs, change orders", label: "Awaiting my approval", to: "/work/approvals", tone: myApprovals ? "warn" : undefined },
    { key: "gate", n: gatesReady, sub: "evidence complete, not yet requested", label: "Gates ready to request", to: "/", tone: gatesReady ? "good" : undefined },
    { key: "sla", n: breached.length, sub: "issues past their SLA", label: "SLA breached", to: "/", tone: breached.length ? "bad" : undefined },
    { key: "exp", n: expiring.filter((e) => e.days <= 30).length, sub: "documents, next 30 days", label: "Expiring soon", to: "/", tone: expiring.some((e) => e.days < 0) ? "bad" : expiring.length ? "warn" : undefined },
    ...(seesStock ? [{ key: "stk", n: belowReorder, sub: "items below reorder level", label: "Restock", to: "/inventory", tone: belowReorder ? "warn" : undefined }] : []),
    ...(seesMoney ? [{ key: "contracts", n: drafts.length, sub: drafts.length ? `${naira(drafts.reduce((s, p) => s + p.contractValueNet, 0), true)} provisional` : "all contracts in hand", label: "Contracts not received", to: "/", tone: drafts.length ? "warn" : undefined }] : []),
    ...(seesMoney ? [{ key: "vat", n: vatOpen.length, sub: vatOpen.length ? `${naira(vatOpenTotal, true)} not yet settled with FIRS` : "all settled", label: "VAT outstanding", to: "/?vat=open", tone: vatOpen.length ? "warn" : undefined }] : []),
    ...(seesRecon ? [{ key: "qb", n: unmatched, sub: "bills without a purchase order", label: "Unreconciled", to: "/finance/reconciliation", tone: unmatched ? "warn" : undefined }] : []),
  ];

  // ---- pipeline: how the portfolio is distributed across the lifecycle ------------------------------------
  const pipeline: BarDatum[] = STAGES.map((s) => {
    const n = projects.filter((p) => p.stage === s.stage).length;
    return { key: String(s.stage), label: `${s.stage} · ${s.short}`, value: n, tone: "brand",
             note: `${n} project${n === 1 ? "" : "s"} in ${s.name}` } satisfies BarDatum;
  }).filter((d) => d.value > 0);

  // ---- budget burn, worst first ---------------------------------------------------------------------------
  const burn: BarDatum[] = seesMoney ? live.map((p) => {
    const m = api.money(p.id);
    return { key: p.id, label: p.code, value: m.planned ? m.burnPct : 0, note: `${p.name} — ${naira(m.actual, true)} of ${naira(m.planned, true)}`,
             tone: (m.burnPct > 100 ? "bad" : m.burnPct >= 90 ? "warn" : "good") as BarDatum["tone"], href: `/projects/${p.id}/money` };
  }).filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 8) : [];

  const SEV_TONE = { critical: "bad", high: "warn", medium: "info", low: "good" } as const;
  const severity = (["critical", "high", "medium", "low"] as const).map((sev) => ({
    key: sev, label: sev, tone: SEV_TONE[sev],
    value: projects.reduce((s, p) => s + p.openIssues[sev], 0),
  }));

  return (
    <div className="dash">
      <section className="dash__attention" aria-label="Needs attention">
        {attention.map((a) => (
          <Link key={a.key} to={a.to} className={`att ${a.n ? `att--${a.tone ?? "info"}` : "att--calm"}`}>
            <span className="att__n">{a.n}</span>
            <span className="att__label">{a.label}</span>
            <span className="att__sub">{a.sub}</span>
          </Link>
        ))}
      </section>

      <div className="dash__grid">
        <section className="card dash__card">
          <div className="card__head"><div className="card__title">Pipeline</div><span className="sm muted">{projects.length} projects by stage</span></div>
          <div className="card__body"><BarChart data={pipeline} emptyLabel="No projects yet"
            onSelect={(d) => nav(`/?stage=${d.key}`)} format={(n) => String(n)} /></div>
        </section>

        {seesMoney && (
          <section className="card dash__card">
            <div className="card__head"><div className="card__title">Budget burn</div><span className="sm muted">spent against approved budget</span></div>
            <div className="card__body"><BarChart data={burn} max={Math.max(110, ...burn.map((b) => b.value))}
              format={(n) => `${n}%`} reference={{ at: 100, label: "100% of budget" }}
              emptyLabel="No checked budget lines yet" onSelect={(d) => nav(`/projects/${d.key}/money`)} /></div>
          </section>
        )}

        <section className="card dash__card">
          <div className="card__head"><div className="card__title">Open issues</div><span className="sm muted">across the portfolio</span></div>
          <div className="card__body stack">
            <StatStrip items={severity} />
            {breached.length > 0 && <div className="dash__list">
              {breached.slice(0, 4).map((i) => <Link key={i.id} to={`/projects/${i.projectId}/field`} className="dash__row">
                <span className="grow ellipsis">{i.title}</span>
                <span className="sm" style={{ color: "var(--ns-chart-bad)" }}>{Math.abs(api.issueSla(i).hoursLeft)} h over</span>
              </Link>)}
            </div>}
          </div>
        </section>

        <section className="card dash__card">
          <div className="card__head"><div className="card__title">Expiring & slipping</div><span className="sm muted">next 90 days</span></div>
          <div className="card__body stack">
            {expiring.length === 0 && slipping.length === 0
              ? <div className="chart__empty">Nothing expiring and nothing behind plan.</div>
              : <div className="dash__list">
                {expiring.slice(0, 5).map(({ p, d, days }) => (
                  <Link key={d.id} to={`/projects/${p.id}/documents`} className="dash__row">
                    <span className="grow ellipsis">{d.title}</span>
                    <span className="sm ns-mono muted">{p.code}</span>
                    <span className="sm" style={{ color: days < 0 ? "var(--ns-chart-bad)" : days <= 30 ? "var(--ns-chart-warn)" : "var(--ns-color-text-secondary)" }}>
                      {days < 0 ? `${Math.abs(days)} d ago` : `${days} d`}
                    </span>
                  </Link>
                ))}
                {slipping.slice(0, 4).map(({ p, slip }) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="dash__row">
                    <span className="grow ellipsis">{p.name}</span>
                    <span className="sm ns-mono muted">{STAGES[p.stage].short}</span>
                    <span className="sm" style={{ color: slip > 7 ? "var(--ns-chart-bad)" : "var(--ns-chart-warn)" }}>+{slip} d</span>
                  </Link>
                ))}
              </div>}
          </div>
        </section>
      </div>
    </div>
  );
}
