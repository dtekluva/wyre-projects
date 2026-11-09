import { ACTIVITY_GROUPS, CATEGORY_LABEL, COST_CATEGORY_LABEL, ISSUE_STATUS_LABEL, STAGES, fmtDate, fmtQty, naira,
  type ActivityBucket, type ActivityGroup, type ChronologyEvent, type Installed, type Issue, type SpendSummary, type Stage } from "@wyre/api";
import { useApi } from "../lib/useApi";

/*
 * The summary PDF's figures. Plain SVG and HTML so they print sharp into a PDF; colours are fixed light-mode values
 * because the report is a white page in print. Palette and mark rules follow the dataviz method: categorical slots in a
 * fixed order (validated on #ffffff: CVD ΔE 9.1, normal-vision 19.6 — the three light slots sit under 3:1, so every
 * coloured mark carries a printed label or count beside it), thin marks, 4px rounded data ends, 2px surface gaps,
 * hairline grids, text in ink tokens and never in a series colour, status colours only for state and always with a label.
 */
export const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", base: "#c3c2b7", surface: "#ffffff", brand: "#5b3fa0" };
export const SERIES: Record<ActivityGroup, string> = { site: "#2a78d6", evidence: "#eb6834", money: "#1baf7a", stock: "#eda100", other: "#e87ba4" };
const BLUE = { fill: "#2a78d6", pending: "#86b6ef", track: "#cde2fb" };
const STATUS = { critical: "#d03b3b", serious: "#ec835a", warning: "#fab219", good: "#0ca30c" };
const SEVERITY: { key: Issue["severity"]; label: string; color: string }[] = [
  { key: "critical", label: "critical", color: STATUS.critical }, { key: "high", label: "high", color: STATUS.serious },
  { key: "medium", label: "medium", color: STATUS.warning }, { key: "low", label: "low", color: INK.base },
];
const short = (d?: string) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

/** A titled, captioned figure — every graphic says what it shows. */
export function Figure({ title, note, children, className = "" }: { title: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <figure className={`rfig ${className}`}><figcaption className="rfig__title">{title}</figcaption>{children}{note && <div className="rfig__note">{note}</div>}</figure>;
}

/** The nine stages as one track: reached (dated), current, and still to come (with its planned date, flagged when late). */
export function StageTrack({ stage, planned, actual, compact = false }: { stage: Stage; planned: Partial<Record<Stage, string>>; actual: Partial<Record<Stage, string>>; compact?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className={`stg ${compact ? "stg--mini" : ""}`} role="img" aria-label={`Stage ${stage} of 8 — ${STAGES[stage]?.name}`}>
    {STAGES.map((s) => {
      const state = s.stage < stage ? "done" : s.stage === stage ? "now" : "next";
      const when = state === "next" ? planned[s.stage] : actual[s.stage];
      const late = state === "next" && !!when && when.slice(0, 10) < today;
      const date = state === "now" ? (when ? `since ${short(when)}` : "now") : when ? (state === "next" ? `plan ${short(when)}` : short(when)) : "";
      return <div key={s.stage} className={`stg__cell stg__cell--${state}`} title={`${s.name}${date ? ` · ${date}` : ""}${late ? " · late" : ""}`}>
        <span className="stg__bar" />
        {!compact && <><span className="stg__name">{s.short}</span><span className={`stg__date ${late ? "stg__date--late" : ""}`}>{date}{late ? " · late" : ""}</span></>}
      </div>;
    })}
  </div>;
}

const niceTop = (v: number) => [2, 4, 6, 10, 20, 40, 60, 100, 200, 400, 600, 1000, 2000].find((c) => c >= v) ?? Math.ceil(v / 1000) * 1000;
const target = (e: ChronologyEvent) => { const m = /now in (.+)$/.exec(e.summary); return m ? STAGES.find((s) => s.name === m[1].trim())?.short ?? m[1] : ""; };

/** Recorded actions per day / week / month, stacked by kind; diamonds mark stage moves and gate decisions. */
export function ActivityChart({ buckets }: { buckets: ActivityBucket[] }) {
  const W = 720, H = 196, L = 30, R = 8, T = 30, B = 24;
  const pw = W - L - R, ph = H - T - B, n = Math.max(1, buckets.length), slot = pw / n;
  const col = Math.min(24, Math.max(3, slot * 0.66));
  const top = niceTop(Math.max(1, ...buckets.map((b) => b.total)));
  const y = (v: number) => T + ph * (1 - v / top);
  const every = n <= 8 ? 1 : Math.ceil(n / 6);
  const totals = ACTIVITY_GROUPS.map((g) => ({ ...g, count: buckets.reduce((s, b) => s + b.counts[g.key], 0) })).filter((g) => g.count > 0);
  const labelled = buckets.map((b, i) => ({ b, i })).filter(({ b }) => b.milestones.some((e) => e.eventType === "stage_change")).slice(-3);
  const unit = buckets[0]?.unit ?? "day";
  return <div className="actv">
    <div className="legend">{totals.map((g) => <span key={g.key} className="legend__item"><i style={{ background: SERIES[g.key] }} />{g.label} <b>{g.count}</b></span>)}</div>
    <svg viewBox={`0 0 ${W} ${H}`} className="actv__svg" role="img" aria-label={`Recorded actions per ${unit}`}>
      {[0, top / 2, top].map((v) => <g key={v}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? INK.base : INK.grid} strokeWidth={1} />
        <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={INK.muted}>{v}</text></g>)}
      {buckets.map((b, i) => {
        const x = L + slot * i + (slot - col) / 2;
        let base = y(0); const segs: React.ReactNode[] = [];
        const present = ACTIVITY_GROUPS.filter((g) => b.counts[g.key] > 0);
        present.forEach((g, k) => {
          const h = (b.counts[g.key] / top) * ph; const last = k === present.length - 1;
          const hh = Math.max(1, h - (last ? 0 : 2)); const yt = base - h + (last ? 0 : 2);
          const r = last ? Math.min(4, hh / 2, col / 2) : 0;
          const d = `M${x},${base}V${yt + r}${r ? `Q${x},${yt} ${x + r},${yt}` : ""}H${x + col - r}${r ? `Q${x + col},${yt} ${x + col},${yt + r}` : ""}V${base}Z`;
          segs.push(<path key={g.key} d={d} fill={SERIES[g.key]}><title>{`${b.label}${b.unit !== "day" ? ` (${b.unit})` : ""} · ${g.label} ${b.counts[g.key]}`}</title></path>);
          base -= h;
        });
        return <g key={b.start}>{segs}
          {b.milestones.length > 0 && <path d={`M${x + col / 2},${y(b.total) - 13}l4,4l-4,4l-4,-4z`} fill={INK.brand}><title>{b.milestones.map((e) => e.summary).join(" · ")}</title></path>}
          {i % every === 0 || i === n - 1 ? <text x={x + col / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={INK.muted}>{b.label}</text> : null}
        </g>;
      })}
      {labelled.map(({ b, i }) => { const cx = Math.min(W - R - 40, Math.max(L + 40, L + slot * i + slot / 2)); const t = target(b.milestones.find((e) => e.eventType === "stage_change")!);
        return t ? <text key={`m${i}`} x={cx} y={Math.max(11, y(b.total) - 17)} textAnchor="middle" fontSize={10} fill={INK.secondary}>→ {t}</text> : null; })}
    </svg>
  </div>;
}

/** Installed capacity against the plan (meter), then one tile per equipment type. */
export function InstalledFigure({ inst }: { inst: Installed }) {
  if (!inst.lines.length) return <p className="rfig__empty">Nothing has been issued to site yet.</p>;
  const pendKwp = inst.lines.reduce((s, l) => s + (l.watts ? l.pending * l.watts : 0), 0) / 1000;
  const scale = inst.capacityKwp || inst.panelsKwp + pendKwp || 1;
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return <>
    {inst.panelsKwp > 0 && <div className="meter">
      <div className="meter__head">Panels: <b>{fmtQty(inst.panelsKwp)} kWp</b> installed{inst.capacityKwp ? <> · {fmtQty(inst.capacityKwp)} kWp planned · <b>{inst.pct}%</b> done</> : ""}</div>
      <div className="meter__track" style={{ background: inst.capacityKwp ? BLUE.track : "transparent" }} role="img" aria-label={`${fmtQty(inst.panelsKwp)} kWp installed`}>
        <span style={{ width: pct(inst.panelsKwp), background: BLUE.fill }} />
        {pendKwp > 0 && <span style={{ width: pct(pendKwp), background: BLUE.pending }} />}
      </div>
      <div className="legend legend--sm"><span className="legend__item"><i style={{ background: BLUE.fill }} />Installed</span>
        {pendKwp > 0 && <span className="legend__item"><i style={{ background: BLUE.pending }} />Waiting for a check ({fmtQty(Math.round(pendKwp * 100) / 100)} kWp)</span>}
        {inst.capacityKwp ? <span className="legend__item"><i style={{ background: BLUE.track }} />Still to install</span> : null}</div>
    </div>}
    <div className="kit">{inst.byCategory.map((c) => <div key={c.category} className="kit__tile">
      <span className="kit__value">{fmtQty(c.net)}<small> {c.unit}</small></span><span className="kit__label">{CATEGORY_LABEL[c.category] ?? c.category}</span>
      {c.pending > 0 && <span className="kit__sub">+{fmtQty(c.pending)} waiting</span>}</div>)}</div>
  </>;
}

/** Open issues by severity (status colours, always labelled), the oldest few, and the other loose ends. */
export function OpenFigure({ issues, pendingChecks, requestsWaiting }: { issues: Issue[]; pendingChecks: number; requestsWaiting: number }) {
  const api = useApi();
  const counts = SEVERITY.map((s) => ({ ...s, n: issues.filter((i) => i.severity === s.key).length })).filter((s) => s.n > 0);
  const total = issues.length;
  return <>
    {total === 0 ? <p className="rfig__ok"><span style={{ color: STATUS.good }}>✓</span> No open issues.</p> : <>
      <div className="segbar" role="img" aria-label={counts.map((c) => `${c.n} ${c.label}`).join(", ")}>
        {counts.map((c) => <span key={c.key} style={{ width: `${(c.n / total) * 100}%`, background: c.color }} title={`${c.n} ${c.label}`} />)}</div>
      <div className="legend legend--sm">{counts.map((c) => <span key={c.key} className="legend__item"><i style={{ background: c.color }} /><b>{c.n}</b> {c.label}</span>)}</div>
      <ul className="openlist">{issues.slice().sort((a, b) => SEVERITY.findIndex((s) => s.key === a.severity) - SEVERITY.findIndex((s) => s.key === b.severity) || a.raisedAt.localeCompare(b.raisedAt)).slice(0, 5).map((i) => {
        const sla = api.issueSla(i);
        return <li key={i.id}><span className={`sev sev--${i.severity}`}>{i.severity}</span>{i.title}
          <span className="openlist__meta">raised {short(i.raisedAt)} · {ISSUE_STATUS_LABEL[i.status]}{sla.open && sla.breached ? ` · past SLA by ${Math.abs(sla.hoursLeft)} h` : ""}</span></li>; })}
        {issues.length > 5 && <li className="openlist__more">and {issues.length - 5} more</li>}</ul>
    </>}
    <p className="rfig__line">{pendingChecks} item{pendingChecks === 1 ? "" : "s"} waiting for a check · {requestsWaiting} stock request{requestsWaiting === 1 ? "" : "s"} waiting at the store</p>
  </>;
}

/** Spend in the period by category: one series, so no legend — the title names it; value at each bar's tip. */
export function SpendBars({ spend }: { spend: SpendSummary }) {
  if (!spend.byCategory.length) return <p className="rfig__empty">Nothing was spent in this period.</p>;
  const max = Math.max(...spend.byCategory.map((c) => c.amount));
  return <div className="hbars">{spend.byCategory.map((c) => <div key={c.category} className="hbars__row" title={`${COST_CATEGORY_LABEL[c.category]} · ${naira(c.amount)}`}>
    <span className="hbars__label">{COST_CATEGORY_LABEL[c.category]}</span>
    <span className="hbars__track"><span className="hbars__bar" style={{ width: `${Math.max(1.5, (c.amount / max) * 100)}%` }} /><span className="hbars__value">{naira(c.amount, true)}</span></span>
  </div>)}</div>;
}

/** Budget used to date: blue while comfortable; status warning from 90 %, critical past 100 % — each with an icon and words. */
export function BudgetMeter({ planned, actual, burnPct }: { planned: number; actual: number; burnPct: number }) {
  if (!planned) return <p className="rfig__empty">No budget lines checked yet.</p>;
  const state = burnPct > 100 ? { c: STATUS.critical, t: "▲ over budget", track: INK.grid } : burnPct >= 90 ? { c: STATUS.warning, t: "⚠ close to budget", track: INK.grid } : { c: BLUE.fill, t: "", track: BLUE.track };
  return <div className="meter">
    <div className="meter__head"><b>{naira(actual, true)}</b> spent of {naira(planned, true)} budget · <b>{burnPct}%</b>{state.t && <span className="meter__state"> {state.t}</span>}</div>
    <div className="meter__track" style={{ background: state.track }} role="img" aria-label={`${burnPct}% of budget used`}><span style={{ width: `${Math.min(100, burnPct)}%`, background: state.c }} /></div>
    {burnPct > 100 && <div className="rfig__line">{naira(actual - planned)} over the checked budget.</div>}
  </div>;
}

/** A short vertical timeline: milestones solid, other notable events hollow. */
export function KeyMoments({ events }: { events: ChronologyEvent[] }) {
  const solid = new Set(["project_created", "stage_change", "approval_decided", "stage_rollback", "contract_received"]);
  return <ol className="km">{events.map((e) => <li key={e.id} className={solid.has(e.eventType) ? "km--solid" : ""}>
    <span className="km__date">{fmtDate(e.occurredAt)}</span><span className="km__dot" /><span className="km__text">{e.summary}</span></li>)}</ol>;
}

/** A thin proportional bar for the portfolio table. */
export const MiniBar = ({ value, max, label }: { value: number; max: number; label: string }) =>
  <span className="mini"><span className="mini__bar" style={{ width: `${max ? Math.max(value ? 3 : 0, (value / max) * 100) : 0}%` }} /><span className="mini__v">{label}</span></span>;
