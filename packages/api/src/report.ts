import type { MockApi } from "./client";
import { groupByDay, inRange, ymd, type DateRange, type RangePreset } from "./dates";
import { STAGES } from "./gates";
import { TOOL_CATEGORIES } from "./types";
import type { ActualSource, ChronologyEvent, CostCategory, Document, EventType, Issue, ItemCategory, Stage, ProjectNarrative, PurchaseOrder, SiteVisit, StockMovement, StockRequest } from "./types";

/** The cache key for a period: the preset itself ("7d", "30d", "week"…) so "Last 7 days" reuses one paragraph for 48 h
 *  even though its dates shift daily; a custom range is keyed by its exact dates. */
export const windowKeyFor = (preset: RangePreset, r: DateRange) => preset === "custom" ? `custom:${r.from ?? ""}:${r.to ?? ""}` : preset;

export interface SpendLine { date: string; projectId: string; label: string; category: CostCategory; source: ActualSource | "expense"; amount: number; attachmentIds: string[]; status: "checked" | "pending" }
export interface SpendSummary {
  total: number; lines: SpendLine[];
  byCategory: { category: CostCategory; amount: number }[]; byProject: { projectId: string; amount: number }[];
  pending: SpendLine[]; pendingTotal: number;
}

/**
 * What was spent in a period: the checked actuals dated inside it (goods receipts count on the day they were checked,
 * expenses on the day the money left), plus — kept apart — expenses logged but not yet checked by Finance.
 */
export function spendInRange(api: MockApi, range: DateRange, projectIds?: Set<string>): SpendSummary {
  const keep = (pid: string) => !projectIds || projectIds.has(pid);
  const lines: SpendLine[] = api.actuals.filter((a) => keep(a.projectId) && inRange(a.date, range))
    .map((a) => ({ date: a.date, projectId: a.projectId, label: a.sourceRef.label, category: a.category, source: a.source, amount: a.amount, attachmentIds: a.attachmentIds, status: "checked" as const }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const pending: SpendLine[] = api.expenses.filter((e) => keep(e.projectId) && e.reviewStatus === "pending" && !e.voidedAt && inRange(`${e.date}T12:00:00`, range))
    .map((e) => ({ date: `${e.date}T12:00:00`, projectId: e.projectId, label: e.description, category: e.category, source: "expense" as const, amount: e.amount, attachmentIds: e.attachmentIds, status: "pending" as const }));
  const sum = (xs: SpendLine[]) => Math.round(xs.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const group = <K extends string>(key: (l: SpendLine) => K) => {
    const m = new Map<K, number>(); for (const l of lines) m.set(key(l), (m.get(key(l)) ?? 0) + l.amount);
    return [...m].map(([k, amount]) => ({ k, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
  };
  return { total: sum(lines), lines, byCategory: group((l) => l.category).map((x) => ({ category: x.k, amount: x.amount })),
    byProject: group((l) => l.projectId).map((x) => ({ projectId: x.k, amount: x.amount })), pending, pendingTotal: sum(pending) };
}

/** Panel wattage from its name — "Jinko solar panels, 650 W", "Tiger Neo 615W", "580Wp", "400 Watt". Mirrors stock.watts_of. */
export const wattsOf = (name: string) => { const m = /(\d{2,4})\s*W(?:p|att|atts)?\b/i.exec(name ?? ""); return m ? Number(m[1]) : undefined; };

/** Panels first — they are what a director asks about — then the rest of a solar system in build order. Mirrors stock.INSTALLED_ORDER. */
export const INSTALLED_ORDER = ["panel", "inverter", "battery", "meter", "ct", "ats", "cable", "mounting", "consumable", "other"];

export interface InstalledLine { itemId: string; name: string; category: ItemCategory; unit: string; issued: number; returned: number; net: number; pending: number; watts?: number }
export interface Installed {
  lines: InstalledLine[];
  byCategory: { category: ItemCategory; net: number; pending: number; unit: string }[];
  panelsKwp: number; capacityKwp?: number; pct?: number;
}

/**
 * What has gone into a project: stock issued to it and checked, less checked returns, per item — the tracker's record of
 * "installed" (Akanimo, 2026-11-04). Issues still waiting for their check are counted apart. Tools and PPE are the team's
 * kit, not the project's, and are left out. Mirrors backend stock.installed_on.
 */
export function installedOn(api: MockApi, projectId: string): Installed {
  const rows = new Map<string, InstalledLine>();
  for (const m of api.movements) {
    if (m.projectId !== projectId || m.voidedAt || !["issue", "return"].includes(m.movementType)) continue;
    const it = api.items.find((i) => i.id === m.itemId); if (!it || TOOL_CATEGORIES.includes(it.category)) continue;
    const r = rows.get(it.id) ?? { itemId: it.id, name: it.name, category: it.category, unit: it.unit, issued: 0, returned: 0, net: 0, pending: 0, watts: it.category === "panel" ? wattsOf(it.name) : undefined };
    if (m.reviewStatus === "checked") { if (m.movementType === "issue") r.issued += m.qty; else r.returned += m.qty; }
    else if (m.reviewStatus === "pending" && m.movementType === "issue") r.pending += m.qty;
    rows.set(it.id, r);
  }
  const rank = (c: string) => { const i = INSTALLED_ORDER.indexOf(c); return i < 0 ? INSTALLED_ORDER.length : i; };
  const lines = [...rows.values()].map((r) => ({ ...r, net: r.issued - r.returned }))
    .sort((a, b) => rank(a.category) - rank(b.category) || b.net - a.net);
  const cats = new Map<ItemCategory, { category: ItemCategory; net: number; pending: number; unit: string }>();
  for (const l of lines) {
    const c = cats.get(l.category) ?? { category: l.category, net: 0, pending: 0, unit: l.unit };
    c.net += l.net; c.pending += l.pending; if (c.unit !== l.unit) c.unit = "";
    cats.set(l.category, c);
  }
  const panelsKwp = Math.round(lines.reduce((s, l) => s + (l.watts ? l.net * l.watts : 0), 0) / 10) / 100;
  const capacityKwp = api.projects.find((p) => p.id === projectId)?.systemCapacityKwp || undefined;
  return { lines, byCategory: [...cats.values()], panelsKwp, capacityKwp, pct: capacityKwp ? Math.round((panelsKwp / capacityKwp) * 100) : undefined };
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
/** "13 pcs Jinko solar panels, 650 W; 2 pcs Deye inverters — panels 8.45 kWp of 40 kWp (21%)" */
export function installedSentence(i: Installed): string {
  const parts = i.lines.filter((l) => l.net > 0).map((l) => `${qty(l.net)} ${l.unit} ${l.name}`);
  if (!parts.length) return "";
  const kwp = i.panelsKwp ? ` — panels ${qty(i.panelsKwp)} kWp${i.capacityKwp ? ` of ${qty(i.capacityKwp)} kWp (${i.pct}%)` : ""}` : "";
  return parts.join("; ") + kwp;
}
export const fmtQty = qty;

/** The few events worth a line each in a summary — stage moves, gates, issues opened and closed, deliveries, hand-overs. */
export const HIGHLIGHT_TYPES = ["project_created", "stage_change", "gate_requested", "approval_decided", "stage_rollback", "contract_received", "issue_raised", "issue_closed", "delivery", "stock_request", "commissioning", "hse"];

/** The five kinds of work the activity chart stacks, in fixed colour order (dataviz: hues by slot, never by rank). */
export type ActivityGroup = "site" | "evidence" | "money" | "stock" | "other";
export const ACTIVITY_GROUPS: { key: ActivityGroup; label: string }[] = [
  { key: "site", label: "Site work" }, { key: "evidence", label: "Documents & checks" }, { key: "money", label: "Money" },
  { key: "stock", label: "Stock" }, { key: "other", label: "Other" },
];
const GROUP_OF: Partial<Record<EventType, ActivityGroup>> = {
  visit: "site", issue_raised: "site", issue_closed: "site", issue: "site", commissioning: "site", hse: "site", warranty: "site", commissioning_assigned: "site",
  document_added: "evidence", attachment_added: "evidence", check_passed: "evidence", check_rejected: "evidence",
  po_raised: "money", po_approved: "money", bill_received: "money", payment: "money", change_order: "money", invoice: "money", contract_updated: "money",
  contract_received: "money", cost_item: "money", retention: "money", expense: "money", reconciliation: "money",
  stock_movement: "stock", stock_request: "stock", stock_count: "stock", delivery: "stock",
};
export const activityGroupOf = (t: EventType): ActivityGroup => GROUP_OF[t] ?? "other";
/** Marked with a diamond on the activity chart. */
export const MILESTONE_TYPES: EventType[] = ["project_created", "stage_change", "approval_decided", "stage_rollback", "contract_received"];

export interface ActivityBucket { start: string; end: string; label: string; unit: "day" | "week" | "month"; counts: Record<ActivityGroup, number>; total: number; milestones: ChronologyEvent[] }

const dayOf = (s: string) => new Date(`${s}T00:00:00`);
const plusDays = (d: Date, k: number) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
/** Events counted per day (periods up to 45 days), per Monday-start week (up to a year), or per month — by kind. */
export function activityBuckets(events: ChronologyEvent[], range: DateRange): ActivityBucket[] {
  const oldest = events.length ? ymd(new Date(events[events.length - 1].occurredAt)) : ymd(new Date());
  const a = dayOf(range.from ?? oldest), b = dayOf(range.to ?? ymd(new Date()));
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const unit: ActivityBucket["unit"] = days <= 45 ? "day" : days <= 366 ? "week" : "month";
  const label = (d: Date) => d.toLocaleDateString("en-GB", unit === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  const out: ActivityBucket[] = [];
  const push = (s: Date, e: Date) => out.push({ start: ymd(s < a ? a : s), end: ymd(e > b ? b : e), label: label(s < a ? a : s), unit,
    counts: { site: 0, evidence: 0, money: 0, stock: 0, other: 0 }, total: 0, milestones: [] });
  if (unit === "day") for (let d = a; d <= b; d = plusDays(d, 1)) push(d, d);
  else if (unit === "week") for (let d = plusDays(a, -((a.getDay() + 6) % 7)); d <= b; d = plusDays(d, 7)) push(d, plusDays(d, 6));
  else for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) push(d, new Date(d.getFullYear(), d.getMonth() + 1, 0));
  for (const ev of events) {
    const day = ymd(new Date(ev.occurredAt));
    const bk = out.find((x) => x.start <= day && day <= x.end); if (!bk) continue;
    bk.counts[activityGroupOf(ev.eventType)]++; bk.total++;
    if (MILESTONE_TYPES.includes(ev.eventType)) bk.milestones.push(ev);
  }
  return out;
}

export interface ProjectReport {
  projectId: string; name: string; code: string; client: string; location: string; stageName: string; rag: string; ragReason?: string; pmId: string;
  events: ChronologyEvent[]; days: { day: string; items: ChronologyEvent[] }[];
  progress: ChronologyEvent[];
  visits: SiteVisit[]; issuesRaised: Issue[]; issuesResolved: Issue[];
  documents: Document[]; files: number; checksPassed: number; checksRejected: number;
  stock: StockMovement[]; requests: StockRequest[];
  money?: { spend: SpendSummary; pos: PurchaseOrder[]; invoiced: number; vatPaid: number; expensesLogged: number; budget: { planned: number; actual: number; burnPct: number } };
  open: { issues: Issue[]; pendingChecks: number; requestsWaiting: number };
  installed: Installed; highlights: ChronologyEvent[];
  stage: Stage; stagePlanned: Partial<Record<Stage, string>>; stageActual: Partial<Record<Stage, string>>;
  activity: ActivityBucket[]; activeDays: number;
}

/** Everything the period summary says about one project, from records only — the same facts the paragraph is written from. */
export function buildProjectReport(api: MockApi, projectId: string, range: DateRange, opts: { money: boolean }): ProjectReport {
  const p = api.projects.find((x) => x.id === projectId);
  if (!p) throw new Error(`Unknown project ${projectId}`);
  const mine = <T extends { projectId: string; voidedAt?: string }>(xs: T[]) => xs.filter((x) => x.projectId === projectId && !x.voidedAt);
  const events = api.listEvents(projectId).filter((e) => inRange(e.occurredAt, range));
  const report: ProjectReport = {
    projectId, name: p.name, code: p.code, client: p.clientName, location: p.location, pmId: p.pmId,
    stageName: STAGES.find((s) => s.stage === p.stage)?.name ?? `Stage ${p.stage}`, rag: p.rag, ragReason: p.ragReason,
    events, days: groupByDay(events, (e) => e.occurredAt),
    progress: events.filter((e) => ["stage_change", "gate_requested", "approval_decided", "stage_rollback"].includes(e.eventType)),
    visits: mine(api.visits).filter((v) => inRange(v.startedAt, range)),
    issuesRaised: mine(api.issues).filter((i) => inRange(i.raisedAt, range)),
    issuesResolved: mine(api.issues).filter((i) => i.resolvedAt && inRange(i.resolvedAt, range)),
    documents: mine(api.documents).filter((d) => inRange(d.submittedAt, range)),
    files: mine(api.attachments).filter((a) => inRange(a.uploadedAt, range)).length,
    checksPassed: events.filter((e) => e.eventType === "check_passed").length,
    checksRejected: events.filter((e) => e.eventType === "check_rejected").length,
    stock: api.movements.filter((m) => m.projectId === projectId && !m.voidedAt && ["issue", "return"].includes(m.movementType) && inRange(m.createdAt, range)),
    requests: api.stockRequests.filter((r) => r.projectId === projectId && inRange(r.requestedAt, range)),
    open: { issues: api.listIssues({ projectId, openOnly: true }), pendingChecks: api.pendingChecks(projectId),
      requestsWaiting: api.stockRequests.filter((r) => r.projectId === projectId && r.status === "requested").length },
    installed: installedOn(api, projectId),
    highlights: events.filter((e) => HIGHLIGHT_TYPES.includes(e.eventType)).slice(0, 12).reverse(),
    stage: p.stage, stagePlanned: p.stagePlanned ?? {}, stageActual: p.stageActual ?? {},
    activity: activityBuckets(events, range), activeDays: new Set(events.map((e) => ymd(new Date(e.occurredAt)))).size,
  };
  if (opts.money) {
    report.money = {
      spend: spendInRange(api, range, new Set([projectId])),
      pos: mine(api.purchaseOrders).filter((po) => inRange(po.raisedAt, range)),
      invoiced: mine(api.clientInvoices).filter((i) => inRange(i.issuedAt, range)).reduce((s, i) => s + i.grossAmount, 0),
      vatPaid: mine(api.vatPayments).filter((v) => v.reviewStatus === "checked" && inRange(`${v.paidOn.slice(0, 10)}T12:00:00`, range)).reduce((s, v) => s + v.amount, 0),
      expensesLogged: mine(api.expenses).filter((e) => inRange(e.createdAt, range)).length,
      budget: (({ planned, actual, burnPct }) => ({ planned, actual, burnPct }))(api.money(projectId)),
    };
  }
  return report;
}

/** The demo build has no Claude: say what the records say, plainly, and say it was not written by Claude. */
export function demoNarrative(r: ProjectReport): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (!r.events.length) return "Demo build, written without Claude: nothing was recorded on this project in the period.";
  return `Demo build, written without Claude: ${n(r.events.length, "event")} recorded — ${n(r.visits.length, "site visit")}, ${n(r.issuesRaised.length, "issue")} raised and ${r.issuesResolved.length} resolved, ${n(r.documents.length, "document")} added. ${r.open.issues.length ? `${n(r.open.issues.length, "issue")} still open.` : "No issues open."}`;
}

export const narrativeFor = (list: ProjectNarrative[], projectId: string, windowKey: string) =>
  list.filter((n) => n.projectId === projectId && n.windowKey === windowKey).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
