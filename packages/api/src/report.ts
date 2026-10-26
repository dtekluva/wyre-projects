import type { MockApi } from "./client";
import { groupByDay, inRange, type DateRange, type RangePreset } from "./dates";
import { STAGES } from "./gates";
import type { ActualSource, ChronologyEvent, CostCategory, Document, Issue, ProjectNarrative, PurchaseOrder, SiteVisit, StockMovement, StockRequest } from "./types";

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

export interface ProjectReport {
  projectId: string; name: string; code: string; client: string; location: string; stageName: string; rag: string; ragReason?: string; pmId: string;
  events: ChronologyEvent[]; days: { day: string; items: ChronologyEvent[] }[];
  progress: ChronologyEvent[];
  visits: SiteVisit[]; issuesRaised: Issue[]; issuesResolved: Issue[];
  documents: Document[]; files: number; checksPassed: number; checksRejected: number;
  stock: StockMovement[]; requests: StockRequest[];
  money?: { spend: SpendSummary; pos: PurchaseOrder[]; invoiced: number; vatPaid: number; expensesLogged: number };
  open: { issues: Issue[]; pendingChecks: number; requestsWaiting: number };
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
  };
  if (opts.money) {
    report.money = {
      spend: spendInRange(api, range, new Set([projectId])),
      pos: mine(api.purchaseOrders).filter((po) => inRange(po.raisedAt, range)),
      invoiced: mine(api.clientInvoices).filter((i) => inRange(i.issuedAt, range)).reduce((s, i) => s + i.grossAmount, 0),
      vatPaid: mine(api.vatPayments).filter((v) => v.reviewStatus === "checked" && inRange(`${v.paidOn.slice(0, 10)}T12:00:00`, range)).reduce((s, v) => s + v.amount, 0),
      expensesLogged: mine(api.expenses).filter((e) => inRange(e.createdAt, range)).length,
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
