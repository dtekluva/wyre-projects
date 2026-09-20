// In-memory API for the frontend-first phases. Same surface the Django backend will implement.
// Enforces: RBAC (§2), stage gates (§3), actor capture (§4), maker-checker + segregation of duties (§4.13, §5),
// money & stock rules (§0, §4.4, §4.10, §4.15, §11).
import { can as canFn, rolesOn as rolesOnFn, type Permission } from "./rbac";
import { STAGES } from "./gates";
import * as seed from "./mock/data";
import * as seed2 from "./mock/data2";
import * as seed3 from "./mock/data3";
import {
  DOC_TYPE_LABEL, COST_CATEGORY_LABEL, MOVEMENT_LABEL, PROJECT_TYPE_LABEL, type ProjectType,
  type User, type InviteInput, type Project, type ProjectMembership, type Document, type Attachment, type ChronologyEvent, type Approval, type Threshold,
  type Stage, type GateStatus, type DocType, type RoleCode, type EventType, type ReviewStatus,
  type Vendor, type InventoryItem, type StockLocation, type CostItem, type PurchaseOrder, type PurchaseItem, type GoodsReceipt, type Asset,
  type StockMovement, type StockBalance, type Actual, type ChangeOrder, type Retention, type QbBill, type CostCategory, type ProjectMoney, type AssetType,
  type AppNotification, type SiteVisit, type Issue, type CommissioningRecord, type HseIncident, type WarrantyClaim, type StockCount, type VisitType, type IssueCategory, type IssueSeverity,
  type IssueStatus, type HseType, type WarrantyStatus, type MeterIntegrity, VISIT_TYPE_LABEL, HSE_TYPE_LABEL, COMMISSIONING_TEMPLATE,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, public code: "forbidden" | "invalid" | "not_found" | "conflict") { super(message); }
}

export type ReviewKind = "document" | "attachment" | "goods_receipt" | "stock_movement" | "cost_item" | "site_visit" | "issue" | "commissioning" | "hse" | "warranty";
export interface ReviewItem {
  kind: ReviewKind; id: string; projectId?: string; title: string; subtitle: string; amount?: number;
  submittedBy: string; submittedAt: string; ageDays: number; overdue: boolean;
  item: Document | Attachment | GoodsReceipt | StockMovement | CostItem | SiteVisit | Issue | CommissioningRecord | HseIncident | WarrantyClaim;
}

/** Spec §4.1 — fields captured when a project is opened (stage 0, RAG green, nothing committed yet) */
export interface NewProjectInput {
  name: string; clientName: string; branchName: string; location: string;
  projectType: ProjectType; systemCapacityKwp?: number;
  contractValue: number; approvedBudget?: number; retentionPercent?: number;
  pmId: string; leadEngineerId: string;
  /** planned completion date of stage 0 (proposal sign-off), YYYY-MM-DD */
  proposalDueDate?: string;
}

type Listener = () => void;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const round = (n: number) => Math.round(n * 100) / 100;
const GLOBAL: RoleCode[] = ["director", "finance", "store_keeper", "auditor"];
const CATS: CostCategory[] = ["equipment", "civil", "labour", "logistics", "permits", "contingency", "om"];

export class MockApi {
  users: User[] = clone(seed.users);
  projects: Project[] = clone(seed.projects);
  memberships: ProjectMembership[] = clone(seed.memberships);
  documents: Document[] = clone(seed.documents);
  attachments: Attachment[] = clone([...seed.attachments, ...seed3.attachments]);
  events: ChronologyEvent[] = clone(seed.events);
  approvals: Approval[] = clone(seed.approvals);
  thresholds: Threshold[] = clone(seed.thresholds);
  // phase 2
  vendors: Vendor[] = clone(seed2.vendors);
  locations: StockLocation[] = clone([...seed2.locations, ...seed3.locations]);
  items: InventoryItem[] = clone(seed2.items);
  costItems: CostItem[] = clone(seed2.costItems);
  purchaseOrders: PurchaseOrder[] = clone(seed2.purchaseOrders);
  goodsReceipts: GoodsReceipt[] = clone(seed2.goodsReceipts);
  assets: Asset[] = clone(seed2.assets);
  movements: StockMovement[] = clone([...seed2.movements, ...seed3.movements]);
  actuals: Actual[] = clone(seed2.actuals);
  changeOrders: ChangeOrder[] = clone(seed2.changeOrders);
  retentions: Retention[] = clone(seed2.retentions);
  qbBills: QbBill[] = clone(seed2.qbBills);
  // phase 3
  visits: SiteVisit[] = clone(seed3.visits);
  issues: Issue[] = clone(seed3.issues);
  commissionings: CommissioningRecord[] = clone(seed3.commissionings);
  hseIncidents: HseIncident[] = clone(seed3.hseIncidents);
  warrantyClaims: WarrantyClaim[] = clone(seed3.warrantyClaims);
  stockCounts: StockCount[] = clone(seed3.stockCounts);

  private listeners = new Set<Listener>();
  private seq = 1000;
  private static KEY = "wyre.tracker.state.v3";
  private static PERSISTED = ["projects","memberships","documents","attachments","events","approvals","thresholds",
    "vendors","locations","items","costItems","purchaseOrders","goodsReceipts","assets","movements","actuals","changeOrders","retentions","qbBills","visits","issues","commissionings","hseIncidents","warrantyClaims","stockCounts","seq"] as const;

  /** Synchronous key-value storage (web: localStorage). Native apps hydrate asynchronously via serialize()/hydrate() instead. */
  private storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null =
    typeof localStorage !== "undefined" ? localStorage : null;
  setStorage(s: MockApi["storage"]) { this.storage = s; this.load(); }
  constructor() { this.load(); }
  private load() {
    try {
      const raw = this.storage?.getItem(MockApi.KEY) ?? null;
      if (!raw) return;
      this.hydrate(raw);
    } catch { /* ignore corrupt state */ }
  }
  /** Full state as JSON (for async persistence, e.g. AsyncStorage on native). */
  serialize(): string {
    const st: Record<string, unknown> = {};
    for (const k of MockApi.PERSISTED) st[k] = (this as unknown as Record<string, unknown>)[k];
    return JSON.stringify(st);
  }
  /** Replace state from serialize() output. Notifies listeners. */
  hydrate(json: string | Record<string, unknown>) {
    const st = typeof json === "string" ? JSON.parse(json) : json;
    for (const k of MockApi.PERSISTED) if (st[k] !== undefined) (this as unknown as Record<string, unknown>)[k] = st[k];
    this.listeners.forEach((fn) => fn());
  }
  private persist() {
    try { this.storage?.setItem(MockApi.KEY, this.serialize()); } catch { /* quota / private mode */ }
  }
  /** Restore the seed data set. */
  reset() {
    try { this.storage?.removeItem(MockApi.KEY); } catch { /* ignore */ }
    Object.assign(this, { projects: clone(seed.projects), memberships: clone(seed.memberships), documents: clone(seed.documents), attachments: clone([...seed.attachments, ...seed3.attachments]),
      events: clone(seed.events), approvals: clone(seed.approvals), thresholds: clone(seed.thresholds),
      vendors: clone(seed2.vendors), locations: clone([...seed2.locations, ...seed3.locations]), items: clone(seed2.items), costItems: clone(seed2.costItems), purchaseOrders: clone(seed2.purchaseOrders),
      goodsReceipts: clone(seed2.goodsReceipts), assets: clone(seed2.assets), movements: clone([...seed2.movements, ...seed3.movements]), actuals: clone(seed2.actuals),
      changeOrders: clone(seed2.changeOrders), retentions: clone(seed2.retentions), qbBills: clone(seed2.qbBills),
      visits: clone(seed3.visits), issues: clone(seed3.issues), commissionings: clone(seed3.commissionings), hseIncidents: clone(seed3.hseIncidents), warrantyClaims: clone(seed3.warrantyClaims), stockCounts: clone(seed3.stockCounts), seq: 1000 });
    this.emit();
  }
  isDirty() { try { return (this.storage?.getItem(MockApi.KEY) ?? null) !== null; } catch { return false; } }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.persist(); this.listeners.forEach((fn) => fn()); }
  /** `${prefix}_${8 hex}` — same format the backend accepts as a client-supplied id (optimistic apply / offline replay). */
  protected id = (p: string) => { this.seq++; const r = (typeof crypto !== "undefined" && "getRandomValues" in crypto) ? Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("") : Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0"); return `${p}_${r}`; };
  private now = () => new Date().toISOString();
  thresholdNum(key: string, fallback: number) { const t = this.thresholds.find((x) => x.key === key); return t ? Number(t.value) : fallback; }

  // ---------- users & access ----------
  getUsers() { return this.users; }
  getUser(id: string) { const u = this.users.find((x) => x.id === id); if (!u) throw new ApiError("User not found", "not_found"); return u; }
  /** Display-safe lookup: returns a placeholder instead of throwing when the store has not hydrated yet
   *  (remote sign-out, or the first render before the snapshot lands). Use in render paths; `getUser` in rules. */
  userOrStub(id?: string): User {
    const u = id ? this.users.find((x) => x.id === id) : undefined;
    return u ?? { id: id ?? "", name: id ?? "—", email: "", roles: [], initials: "—" };
  }
  userName(id?: string) { return id ? this.users.find((x) => x.id === id)?.name ?? id : "—"; }
  rolesOn(userId: string, projectId?: string): RoleCode[] {
    const u = this.users.find((x) => x.id === userId);
    return u ? rolesOnFn(u, projectId, this.memberships) : [];
  }
  /** Permission follows the role, on every project — see rbac.rolesOn. An unknown user has no permissions
   *  rather than being an error: the store is briefly empty while a remote session signs out, and a render
   *  then must not throw. */
  can(userId: string, perm: Permission, projectId?: string) {
    const u = this.users.find((x) => x.id === userId);
    if (!u) return false;
    if (canFn(u, perm, projectId, this.memberships)) return true;
    // A project may delegate one permission to one named person — mirrors rbac.DELEGATED on the server.
    // A techlead assigns commissioning per site so the tech who did the install records their own readings.
    if (perm === "commissioning.create" && projectId) {
      return this.projects.some((p) => p.id === projectId && p.commissioningAssigneeId === userId);
    }
    return false;
  }
  /** can the user do this on ANY project they belong to (for nav / listing) */
  canAnywhere(userId: string, perm: Permission) { return this.can(userId, perm) || this.projects.some((p) => this.can(userId, perm, p.id)); }
  private require(userId: string, perm: Permission, projectId?: string) {
    if (!this.can(userId, perm, projectId)) throw new ApiError(`Your role does not allow "${perm}" here`, "forbidden");
  }
  hasGlobal(userId: string) { return this.getUser(userId).roles.some((r) => GLOBAL.includes(r)); }

  // ---------- lookups ----------
  vendorName(id?: string) { return id ? this.vendors.find((v) => v.id === id)?.name ?? id : "—"; }
  item(id: string) { const it = this.items.find((i) => i.id === id); if (!it) throw new ApiError("Item not found", "not_found"); return it; }
  itemName(id: string) { return this.items.find((i) => i.id === id)?.name ?? id; }
  locationName(id?: string) { return id ? this.locations.find((l) => l.id === id)?.name ?? id : "—"; }
  projectCode(id?: string) { return id ? this.projects.find((p) => p.id === id)?.code ?? id : "—"; }

  // ---------- projects ----------
  /** The portfolio is company-wide: any signed-in member of staff sees every project. Membership decides what
   *  you may DO on a project, which `can()` still enforces — not whether you may look at it. */
  listProjects(_userId: string): Project[] { return this.projects; }
  /** Projects this user is assigned to — for "my work" views and for pickers that must not offer a project
   *  the user would be refused on. */
  myProjects(userId: string): Project[] {
    const mine = new Set(this.memberships.filter((m) => m.userId === userId && !m.revokedAt).map((m) => m.projectId));
    return this.projects.filter((p) => mine.has(p.id));
  }
  /** Projects where this user may actually perform `perm` (membership or a global role). */
  projectsFor(userId: string, perm: Permission): Project[] { return this.projects.filter((p) => this.can(userId, perm, p.id)); }
  private raw(id: string) { const p = this.projects.find((x) => x.id === id); if (!p) throw new ApiError("Project not found", "not_found"); return p; }
  getProject(_userId: string, id: string): Project { return this.raw(id); }
  listMemberships(projectId: string) { return this.memberships.filter((m) => m.projectId === projectId && !m.revokedAt); }

  /** project.create is granted by base role (Admin, PM) — there is no project to be a member of yet */
  canCreateProject(userId: string) { return canFn(this.getUser(userId), "project.create", undefined, this.memberships); }
  nextProjectCode() {
    const year = new Date().getFullYear();
    const used = this.projects.map((p) => p.code.match(/^WYR-(\d{4})-(\d+)$/)).filter((m): m is RegExpMatchArray => !!m && Number(m[1]) === year).map((m) => Number(m[2]));
    return `WYR-${year}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
  }
  createProject(actorId: string, input: NewProjectInput): Project {
    if (!this.canCreateProject(actorId)) throw new ApiError('Your role does not allow "project.create"', "forbidden");
    const req = (v: string | undefined, label: string) => { const t = (v ?? "").trim(); if (!t) throw new ApiError(`${label} is required`, "invalid"); return t; };
    const name = req(input.name, "Project name"), clientName = req(input.clientName, "Client"), branchName = req(input.branchName, "Branch / site"), location = req(input.location, "Location");
    if (!(input.projectType in PROJECT_TYPE_LABEL)) throw new ApiError("Unknown project type", "invalid");
    const money = (v: number | undefined, label: string, fallback = 0) => { const n = v === undefined || v === null || Number.isNaN(v) ? fallback : Number(v); if (!Number.isFinite(n) || n < 0) throw new ApiError(`${label} must be zero or more`, "invalid"); return round(n); };
    const contractValue = money(input.contractValue, "Contract value"); const approvedBudget = money(input.approvedBudget, "Approved budget");
    if (approvedBudget > contractValue && contractValue > 0) throw new ApiError("Approved budget cannot exceed contract value", "invalid");
    const retentionPercent = input.retentionPercent === undefined ? this.thresholdNum("retention.percent", 5) : Number(input.retentionPercent);
    if (!Number.isFinite(retentionPercent) || retentionPercent < 0 || retentionPercent > 20) throw new ApiError("Retention must be between 0 and 20 %", "invalid");
    if (input.systemCapacityKwp !== undefined && !(Number(input.systemCapacityKwp) > 0)) throw new ApiError("System capacity must be a positive number of kWp", "invalid");
    if (input.proposalDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.proposalDueDate)) throw new ApiError("Proposal due date must be YYYY-MM-DD", "invalid");
    const pm = this.getUser(input.pmId); if (!pm.roles.includes("techlead")) throw new ApiError(`${pm.name} is not a Tech Lead`, "invalid");
    const le = this.getUser(input.leadEngineerId); if (!le.roles.includes("techlead")) throw new ApiError(`${le.name} is not a Tech Lead`, "invalid");
    if (this.projects.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) throw new ApiError("A project with that name already exists", "conflict");
    const at = this.now();
    const p: Project = {
      id: this.id("p"), code: this.nextProjectCode(), name, clientName, branchName, location,
      projectType: input.projectType, systemCapacityKwp: input.systemCapacityKwp ? Number(input.systemCapacityKwp) : undefined,
      stage: 0, rag: "green", pmId: pm.id, leadEngineerId: le.id,
      contractValue, approvedBudget, committed: 0, actual: 0,
      stagePlanned: input.proposalDueDate ? { 0: input.proposalDueDate } : {}, stageActual: {},
      retentionPercent, openIssues: { critical: 0, high: 0, medium: 0, low: 0 },
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId,
    };
    this.projects.push(p);
    this.log(p.id, actorId, "project_created", `Project created — ${p.code} · ${PROJECT_TYPE_LABEL[p.projectType]} · ${this.fmt(contractValue)}`, undefined, { model: "Project", id: p.id });
    for (const [uid, role] of [[pm.id, "techlead"], [le.id, "techlead"]] as const) {
      this.memberships.push({ id: this.id("m"), projectId: p.id, userId: uid, role, grantedBy: actorId, grantedAt: at });
      this.log(p.id, actorId, "role_granted", `${this.userName(uid)} granted ${role}`);
    }
    this.emit();
    return p;
  }

  // ---------- chronology ----------
  listEvents(projectId?: string): ChronologyEvent[] {
    const ev = projectId ? this.events.filter((e) => e.projectId === projectId) : this.events;
    return [...ev].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  private log(projectId: string | undefined, actorId: string, eventType: EventType, summary: string, detail?: string, ref?: ChronologyEvent["ref"]) {
    if (!projectId) return;
    this.events.push({ id: this.id("ev"), projectId, occurredAt: this.now(), actorId, eventType, summary, detail, ref });
    const p = this.raw(projectId); p.updatedAt = this.now(); p.updatedBy = actorId;
  }

  // ---------- documents & attachments ----------
  listDocuments(projectId: string) { return this.documents.filter((d) => d.projectId === projectId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)); }
  listAttachments(projectId: string) { return this.attachments.filter((a) => a.projectId === projectId).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)); }

  addDocument(actorId: string, projectId: string, input: { docType: DocType; title: string; fileName?: string; sizeBytes?: number; issuer?: string; expiresAt?: string; blob?: Blob }): Document {
    this.require(actorId, "document.create", projectId);
    const at = this.now();
    const prior = this.documents.filter((d) => d.projectId === projectId && d.docType === input.docType).length;
    const doc: Document = {
      id: this.id("doc"), projectId, docType: input.docType, title: input.title, status: "submitted",
      issuedAt: at, expiresAt: input.expiresAt, issuer: input.issuer, version: prior + 1,
      fileName: input.fileName ?? input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".pdf", sizeBytes: input.sizeBytes ?? input.blob?.size ?? 320_000,
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1,
    };
    this.documents.push(doc);
    this.log(projectId, actorId, "document_added", `${DOC_TYPE_LABEL[doc.docType]} — "${doc.title}" submitted (pending check)`, undefined, { model: "Document", id: doc.id });
    this.emit(); return doc;
  }

  addAttachment(actorId: string, projectId: string, input: { fileName: string; caption?: string; kind?: "image" | "document"; linkedTo?: Attachment["linkedTo"]; gps?: Attachment["gps"]; blob?: Blob; sizeBytes?: number }): Attachment {
    this.require(actorId, "attachment.create", projectId);
    const at = this.now();
    const att: Attachment = {
      id: this.id("att"), projectId, fileName: input.fileName, mime: input.kind === "document" ? "application/pdf" : "image/jpeg",
      sizeBytes: input.sizeBytes ?? input.blob?.size ?? 1_400_000, kind: input.kind ?? "image", capturedAt: at,
      sha256: Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
      uploadedBy: actorId, uploadedAt: at, linkedTo: input.linkedTo, caption: input.caption, gps: input.gps,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1,
    };
    this.attachments.push(att);
    this.log(projectId, actorId, "attachment_added", `Uploaded ${att.fileName}${att.caption ? " — " + att.caption : ""} (pending check)`, undefined, { model: "Attachment", id: att.id });
    this.emit(); return att;
  }

  /** Evidence attached to an approval-bearing object (e.g. a write-off): the Approval is its four-eyes check (§4.13), so it is not queued separately. */
  addEvidence(actorId: string, input: { fileName: string; caption?: string; projectId?: string; linkedTo?: Attachment["linkedTo"]; blob?: Blob; sizeBytes?: number }): Attachment {
    this.require(actorId, "attachment.create", input.projectId);
    const at = this.now();
    const att: Attachment = { id: this.id("att"), projectId: input.projectId ?? "", fileName: input.fileName, mime: "image/jpeg", sizeBytes: input.sizeBytes ?? input.blob?.size ?? 1_200_000, kind: "image", capturedAt: at,
      sha256: Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""), uploadedBy: actorId, uploadedAt: at, linkedTo: input.linkedTo, caption: input.caption,
      reviewStatus: "checked", submittedBy: actorId, submittedAt: at, reviewVersion: 1, checkComment: "Verified through the linked approval" };
    this.attachments.push(att); return att;
  }

  // ---------- maker-checker ----------
  private checkPerm(kind: ReviewKind): Permission {
    return ({ document: "document.check", attachment: "attachment.check", goods_receipt: "goods_receipt.check", stock_movement: "inventory.check", cost_item: "cost.check",
      site_visit: "visit.check", issue: "issue.check", commissioning: "commissioning.check", hse: "hse.check", warranty: "warranty.check" } as const)[kind];
  }
  private findReviewable(kind: ReviewKind, id: string) {
    const list = ({ document: this.documents, attachment: this.attachments, goods_receipt: this.goodsReceipts, stock_movement: this.movements, cost_item: this.costItems,
      site_visit: this.visits, issue: this.issues, commissioning: this.commissionings, hse: this.hseIncidents, warranty: this.warrantyClaims } as Record<ReviewKind, { id: string }[]>)[kind];
    const it = list.find((x) => x.id === id); if (!it) throw new ApiError("Item not found", "not_found");
    return it as ReviewItem["item"];
  }
  reviewQueue(userId: string): ReviewItem[] {
    const nowMs = Date.now(); const items: ReviewItem[] = [];
    const escalation = this.thresholdNum("check.escalation_days", 3);
    const push = (kind: ReviewKind, it: ReviewItem["item"], projectId: string | undefined, title: string, subtitle: string, amount?: number) => {
      if (it.reviewStatus !== "pending") return;
      if (it.submittedBy === userId) return; // segregation of duties
      if (!this.can(userId, this.checkPerm(kind), projectId)) return;
      const ageDays = Math.floor((nowMs - new Date(it.submittedAt).getTime()) / 86400000);
      items.push({ kind, id: it.id, projectId, title, subtitle, amount, submittedBy: it.submittedBy, submittedAt: it.submittedAt, ageDays, overdue: ageDays > escalation, item: it });
    };
    this.documents.forEach((d) => push("document", d, d.projectId, d.title, DOC_TYPE_LABEL[d.docType]));
    this.attachments.forEach((a) => push("attachment", a, a.projectId, a.caption ?? a.fileName, a.linkedTo ? `${a.linkedTo.model}: ${a.linkedTo.label}` : a.kind === "image" ? "Photo" : "File"));
    this.goodsReceipts.forEach((g) => { const po = this.purchaseOrders.find((p) => p.id === g.poId);
      push("goods_receipt", g, g.projectId, `${g.grnNumber} · ${this.vendorName(po?.vendorId)}`, `${g.lines.length} line${g.lines.length > 1 ? "s" : ""} against ${po?.poNumber}`, this.grnValue(g)); });
    this.movements.filter((m) => (m.movementType === "issue" || m.movementType === "return" || m.movementType === "transfer") && m.sourceRef?.model !== "SiteVisit").forEach((m) =>
      push("stock_movement", m, m.projectId, `${MOVEMENT_LABEL[m.movementType]} · ${this.itemName(m.itemId)} × ${m.qty}`, m.sourceRef?.label ?? "", m.totalCost));
    this.costItems.forEach((c) => push("cost_item", c, c.projectId, c.label, `Budget line · ${COST_CATEGORY_LABEL[c.category]}`, c.plannedAmount));
    this.visits.forEach((v) => push("site_visit", v, v.projectId, `${VISIT_TYPE_LABEL[v.visitType]} visit · ${v.startedAt.slice(0, 10)}`, `${v.technicianIds.map((t) => this.userName(t)).join(", ")} · ${v.parts.length} part line${v.parts.length === 1 ? "" : "s"} · ${v.attachmentIds.length} photo${v.attachmentIds.length === 1 ? "" : "s"}`, v.costTotal));
    this.issues.forEach((i) => push("issue", i, i.projectId, `${i.status === "resolved" ? "Resolution" : "Issue report"} · ${i.title}`, `${i.severity} · ${i.category}${i.status === "resolved" ? " · after photo attached" : ""}`, i.costToResolve || undefined));
    this.commissionings.forEach((c) => push("commissioning", c, c.projectId, `Commissioning record · ${c.result}`, `${c.items.filter((i) => i.pass).length}/${c.items.length} checklist pass · meter integrity ${Object.values(c.meter).every(Boolean) ? "pass" : "FAIL"}`));
    this.hseIncidents.forEach((h) => push("hse", h, h.projectId, `HSE · ${HSE_TYPE_LABEL[h.type]}`, `${h.severity} · ${h.description.slice(0, 70)}`));
    this.warrantyClaims.forEach((w) => push("warranty", w, w.projectId, `Warranty claim · ${this.assets.find((a) => a.id === w.assetId)?.serial ?? w.assetId}`, `${w.status} · ${this.vendorName(w.vendorId)}`, w.costRecovered || undefined));
    return items.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  }
  pendingChecks(projectId: string) {
    return this.documents.filter((d) => d.projectId === projectId && d.reviewStatus === "pending").length
      + this.attachments.filter((a) => a.projectId === projectId && a.reviewStatus === "pending").length
      + this.goodsReceipts.filter((g) => g.projectId === projectId && g.reviewStatus === "pending").length
      + this.movements.filter((m) => m.projectId === projectId && m.reviewStatus === "pending" && m.movementType !== "write_off").length
      + this.costItems.filter((c) => c.projectId === projectId && c.reviewStatus === "pending").length
      + this.visits.filter((v) => v.projectId === projectId && v.reviewStatus === "pending").length
      + this.issues.filter((i) => i.projectId === projectId && i.reviewStatus === "pending").length
      + this.commissionings.filter((c) => c.projectId === projectId && c.reviewStatus === "pending").length
      + this.hseIncidents.filter((h) => h.projectId === projectId && h.reviewStatus === "pending").length
      + this.warrantyClaims.filter((w) => w.projectId === projectId && w.reviewStatus === "pending").length;
  }

  check(kind: ReviewKind, id: string, actorId: string, decision: Exclude<ReviewStatus, "pending">, comment?: string) {
    const item = this.findReviewable(kind, id);
    const projectId = "projectId" in item ? (item as { projectId?: string }).projectId : undefined;
    if (item.reviewStatus !== "pending") throw new ApiError("Already reviewed", "conflict");
    if (item.submittedBy === actorId) throw new ApiError("You cannot check your own submission (segregation of duties)", "forbidden");
    this.require(actorId, this.checkPerm(kind), projectId);
    if (decision === "rejected" && !comment?.trim()) throw new ApiError("A comment is required to reject", "invalid");
    const at = this.now();
    item.reviewStatus = decision; item.checkedBy = actorId; item.checkedAt = at; item.checkComment = comment?.trim() || undefined;
    const ok = decision === "checked";
    let label = "";
    switch (kind) {
      case "document": { const d = item as Document; d.status = ok ? "approved" : "submitted"; d.updatedAt = at; d.updatedBy = actorId; label = d.title; break; }
      case "attachment": { const a = item as Attachment; label = a.caption ?? a.fileName; break; }
      case "cost_item": { const c = item as CostItem; c.updatedAt = at; c.updatedBy = actorId; label = `budget line ${c.label}`; break; }
      case "goods_receipt": { const g = item as GoodsReceipt; label = g.grnNumber; if (ok) this.postGoodsReceipt(g, actorId); break; }
      case "stock_movement": { const m = item as StockMovement; label = `${MOVEMENT_LABEL[m.movementType]} ${this.itemName(m.itemId)} × ${m.qty}`; if (ok) this.postMovementEffects(m, actorId); break; }
      case "site_visit": { const v = item as SiteVisit; v.updatedAt = at; v.updatedBy = actorId; label = `${VISIT_TYPE_LABEL[v.visitType]} visit ${v.startedAt.slice(0, 10)}`;
        for (const part of v.parts) { const m = this.movements.find((x) => x.id === part.movementId); if (!m || m.reviewStatus !== "pending") continue;
          m.reviewStatus = decision; m.checkedBy = actorId; m.checkedAt = at; if (ok) this.postMovementEffects(m, actorId); }
        if (ok && v.costTravel + v.costLabour > 0) this.actuals.push({ id: this.id("act"), projectId: v.projectId, category: "om", source: "visit", sourceRef: { model: "SiteVisit", id: v.id, label: `${VISIT_TYPE_LABEL[v.visitType]} visit — travel + labour` },
          amount: v.costTravel + v.costLabour, date: at, attachmentIds: v.attachmentIds, createdBy: actorId });
        break; }
      case "issue": { const i = item as Issue; i.updatedAt = at; i.updatedBy = actorId; label = i.title;
        if (i.status === "resolved") { if (ok) { i.status = "closed"; if (i.costToResolve > 0) this.actuals.push({ id: this.id("act"), projectId: i.projectId, category: "om", source: "issue", sourceRef: { model: "Issue", id: i.id, label: `Issue resolved — ${i.title}` }, amount: i.costToResolve, date: at, attachmentIds: i.afterAttachmentIds, createdBy: actorId }); }
          else { i.status = "in_progress"; i.resolvedAt = undefined; i.resolvedBy = undefined; } }
        else if (!ok) i.status = "wont_fix";
        break; }
      case "commissioning": { const c = item as CommissioningRecord; c.updatedAt = at; c.updatedBy = actorId; label = `commissioning record (${c.result})`;
        if (ok && c.result !== "fail") this.emitCommissioningEvidence(c, actorId); break; }
      case "hse": { const h = item as HseIncident; h.updatedAt = at; h.updatedBy = actorId; label = `HSE ${HSE_TYPE_LABEL[h.type]}`; break; }
      case "warranty": { const w = item as WarrantyClaim; w.updatedAt = at; w.updatedBy = actorId; label = `warranty claim ${this.assets.find((a) => a.id === w.assetId)?.serial ?? ""}`;
        if (ok && w.costRecovered > 0 && ["accepted", "refunded", "replaced"].includes(w.status) && !this.actuals.some((a) => a.sourceRef.id === w.id))
          this.actuals.push({ id: this.id("act"), projectId: w.projectId, category: "om", source: "warranty", sourceRef: { model: "WarrantyClaim", id: w.id, label: `Warranty recovery — ${this.vendorName(w.vendorId)}` }, amount: -w.costRecovered, date: at, attachmentIds: [], createdBy: actorId });
        break; }
    }
    const model = { document: "Document", attachment: "Attachment", goods_receipt: "GoodsReceipt", stock_movement: "StockMovement", cost_item: "CostItem", site_visit: "SiteVisit", issue: "Issue", commissioning: "CommissioningRecord", hse: "HseIncident", warranty: "WarrantyClaim" }[kind];
    this.log(projectId, actorId, ok ? "check_passed" : "check_rejected", `${ok ? "Checked" : "Rejected"}: ${label}`, comment?.trim() || undefined, { model, id });
    this.emit();
  }

  // ---------- stage gates ----------
  gateStatus(projectId: string): GateStatus {
    const p = this.raw(projectId); const def = STAGES[p.stage];
    if (def.terminal) return { stage: p.stage, name: def.name, items: [], ready: false, approverRoles: [], terminal: true };
    const items = def.evidence.map((docType) => {
      const doc = this.documents.filter((d) => d.projectId === projectId && d.docType === docType).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
      const state = !doc ? "missing" : doc.reviewStatus === "checked" ? "ok" : doc.reviewStatus === "pending" ? "pending" : "rejected";
      return { docType, label: DOC_TYPE_LABEL[docType], state, document: doc } as const;
    });
    const pendingApproval = this.approvals.find((a) => a.projectId === projectId && a.kind === "gate" && a.status === "pending");
    return { stage: p.stage, name: def.name, nextStage: (p.stage + 1) as Stage, items: [...items], ready: items.every((i) => i.state === "ok"),
      approverRoles: def.approverRoles, pendingApproval, terminal: false };
  }
  requestGate(projectId: string, actorId: string): Approval {
    this.require(actorId, "gate.request", projectId);
    const g = this.gateStatus(projectId);
    if (g.terminal) throw new ApiError("Project is closed", "conflict");
    if (g.pendingApproval) throw new ApiError("A gate approval is already pending", "conflict");
    if (!g.ready) throw new ApiError("Gate evidence is not complete — every item must be checked", "invalid");
    const next = STAGES[g.nextStage!];
    const ap: Approval = {
      id: this.id("ap"), projectId, kind: "gate", title: `Gate ${g.stage} → ${g.nextStage} · ${STAGES[g.stage].short} → ${next.short}`,
      description: `All gate-${g.stage} evidence checked: ${g.items.map((i) => i.label).join(", ")}.`,
      requestedBy: actorId, requestedAt: this.now(), requiredRoles: g.approverRoles, decisions: [], status: "pending", targetStage: g.nextStage,
    };
    this.approvals.push(ap);
    this.log(projectId, actorId, "gate_requested", `${ap.title} — approval requested`, undefined, { model: "Approval", id: ap.id });
    this.emit(); return ap;
  }

  // ---------- approvals ----------
  listApprovals(f: { projectId?: string; status?: Approval["status"]; kind?: Approval["kind"] } = {}) {
    return this.approvals.filter((a) => (!f.projectId || a.projectId === f.projectId) && (!f.status || a.status === f.status) && (!f.kind || a.kind === f.kind))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }
  approvalsFor(userId: string) { return this.listApprovals({ status: "pending" }).filter((a) => this.canDecide(userId, a).ok); }
  canDecide(userId: string, a: Approval): { ok: boolean; reason?: string; role?: RoleCode } {
    if (a.status !== "pending") return { ok: false, reason: "Already decided" };
    if (a.requestedBy === userId) return { ok: false, reason: "You raised this — segregation of duties" };
    const perm: Permission = a.kind === "gate" ? "gate.approve" : a.kind === "write_off" ? "writeoff.approve" : "po.approve";
    if (!this.can(userId, perm, a.projectId)) return { ok: false, reason: "Your role cannot approve this" };
    const mine = this.rolesOn(userId, a.projectId ?? "__global__");
    const decided = new Set(a.decisions.map((d) => d.role));
    const role = a.requiredRoles.find((r) => mine.includes(r) && !decided.has(r));
    if (!role) return { ok: false, reason: decided.size ? "Your role has already decided" : "Not one of the required approver roles" };
    return { ok: true, role };
  }
  decide(approvalId: string, actorId: string, decision: "approved" | "rejected", comment?: string) {
    const a = this.approvals.find((x) => x.id === approvalId); if (!a) throw new ApiError("Approval not found", "not_found");
    const c = this.canDecide(actorId, a); if (!c.ok) throw new ApiError(c.reason!, "forbidden");
    if (decision === "rejected" && !comment?.trim()) throw new ApiError("A comment is required to reject", "invalid");
    const note = comment?.trim() || undefined; const at = this.now();
    a.decisions.push({ approverId: actorId, role: c.role!, decision, at, comment: note });
    const ref = { model: "Approval", id: a.id };
    if (decision === "rejected") {
      a.status = "rejected";
      this.applyApprovalOutcome(a, actorId, false);
      this.log(a.projectId, actorId, "approval_decided", `Rejected: ${a.title}`, note, ref);
    } else {
      const done = a.requiredRoles.every((r) => a.decisions.some((d) => d.role === r && d.decision === "approved"));
      if (done) {
        a.status = "approved";
        this.applyApprovalOutcome(a, actorId, true);
        if (a.kind === "gate" && a.targetStage !== undefined && a.projectId) {
          const p = this.raw(a.projectId); const from = p.stage; p.stage = a.targetStage; p.stageActual[a.targetStage] = at;
          this.log(a.projectId, actorId, "stage_change", `Stage ${from} → ${a.targetStage} · now in ${STAGES[a.targetStage].name}`, undefined, ref);
        } else {
          this.log(a.projectId, actorId, a.kind === "po" ? "po_approved" : a.kind === "change_order" ? "change_order" : a.kind === "write_off" ? "stock_movement" : a.kind === "retention" ? "retention" : "approval_decided",
            `Approved: ${a.title}`, note, ref);
        }
      } else {
        const waiting = a.requiredRoles.filter((r) => !a.decisions.some((d) => d.role === r));
        this.log(a.projectId, actorId, "approval_decided", `${a.title} — approved by ${c.role}; awaiting ${waiting.join(", ")}`, note, ref);
      }
    }
    this.emit();
  }
  /** side effects of an approval reaching a terminal state */
  private applyApprovalOutcome(a: Approval, actorId: string, approved: boolean) {
    const at = this.now();
    if (a.kind === "po") { const po = this.purchaseOrders.find((p) => p.approvalId === a.id); if (po) { po.status = approved ? "approved" : "rejected"; po.updatedAt = at; po.updatedBy = actorId; } }
    if (a.kind === "change_order") {
      const co = this.changeOrders.find((x) => x.approvalId === a.id);
      if (co) { co.status = approved ? "approved" : "rejected"; co.updatedAt = at; co.updatedBy = actorId; if (approved) { const p = this.raw(co.projectId); p.approvedBudget += co.costDelta; } }
    }
    if (a.kind === "write_off") {
      const m = this.movements.find((x) => x.approvalId === a.id);
      if (m) { m.reviewStatus = approved ? "checked" : "rejected"; m.checkedBy = actorId; m.checkedAt = at;
        if (approved) (m.serials ?? []).forEach((s) => { const as = this.assets.find((x) => x.serial === s); if (as) { as.status = "decommissioned"; as.updatedAt = at; as.updatedBy = actorId; } }); }
    }
    if (a.kind === "retention" && approved && a.projectId) { const r = this.retentions.find((x) => x.projectId === a.projectId); if (r) { r.releasedAt = at; r.releasedBy = actorId; r.approvalId = a.id; } }
    if (a.kind === "stock_count") {
      const sc = this.stockCounts.find((x) => x.approvalId === a.id); if (!sc) return;
      sc.status = approved ? "approved" : "rejected"; sc.updatedAt = at; sc.updatedBy = actorId;
      if (approved) for (const l of sc.lines) {
        if (!l.variance) continue; const wac = this.wacOf(l.itemId); const up = l.variance > 0;
        this.movements.push({ id: this.id("mv"), itemId: l.itemId, movementType: "adjustment", qty: Math.abs(l.variance), locationFromId: up ? undefined : sc.locationId, locationToId: up ? sc.locationId : undefined,
          unitCost: wac, totalCost: Math.abs(l.variance) * wac, reason: `Stock count ${sc.countDate}: ${l.note ?? "variance"}`, sourceRef: { model: "StockCount", id: sc.id, label: `Count ${sc.countDate}` }, attachmentIds: l.attachmentId ? [l.attachmentId] : [],
          createdBy: sc.countedBy, createdAt: at, approvalId: a.id, reviewStatus: "checked", submittedBy: sc.countedBy, submittedAt: at, checkedBy: actorId, checkedAt: at, reviewVersion: 1 });
      }
    }
  }

  // ---------- memberships ----------
  grantMembership(actorId: string, projectId: string, userId: string, role: RoleCode) {
    this.require(actorId, "membership.manage", projectId);
    if (this.memberships.some((m) => m.projectId === projectId && m.userId === userId && m.role === role && !m.revokedAt)) throw new ApiError("Already a member with that role", "conflict");
    this.memberships.push({ id: this.id("m"), projectId, userId, role, grantedBy: actorId, grantedAt: this.now() });
    this.log(projectId, actorId, "role_granted", `${this.userName(userId)} granted ${role}`);
    this.emit();
  }
  /** Delegate (or clear, with userId undefined) who records commissioning on this project. */
  assignCommissioning(actorId: string, projectId: string, userId?: string) {
    this.require(actorId, "membership.manage", projectId);
    const p = this.raw(projectId);
    if (userId) {
      if (p.commissioningAssigneeId === userId) throw new ApiError(`${this.userName(userId)} is already assigned`, "conflict");
      p.commissioningAssigneeId = userId;
      this.log(projectId, actorId, "commissioning_assigned", `${this.userName(userId)} assigned to commission this site`);
    } else {
      if (!p.commissioningAssigneeId) throw new ApiError("Nobody is assigned", "conflict");
      const was = this.userName(p.commissioningAssigneeId);
      p.commissioningAssigneeId = undefined;
      this.log(projectId, actorId, "commissioning_assigned", `${was} unassigned from commissioning`);
    }
    this.emit();
    return p;
  }
  /** Demo-mode invite: creates the user locally. The live build sends an email — see RemoteApi. */
  inviteUser(actorId: string, input: InviteInput) {
    this.require(actorId, "users.manage");
    const name = input.name.trim(), email = input.email.trim().toLowerCase(), username = input.username.trim().toLowerCase();
    if (!name) throw new ApiError("Name is required", "invalid");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError("A valid email address is required", "invalid");
    if (!/^[a-z0-9]+(?:\.[a-z0-9]+)+$/.test(username)) throw new ApiError("Username must be firstname.lastname", "invalid");
    if (!input.roles.length) throw new ApiError("Pick at least one role", "invalid");
    if (this.users.some((u) => u.username === username)) throw new ApiError(`${username} is already taken`, "conflict");
    if (this.users.some((u) => u.email.toLowerCase() === email)) throw new ApiError(`${email} already has an account`, "conflict");
    const u: User = { id: this.id("u"), name, email, username, roles: input.roles, initials: name.split(" ").map((x: string) => x[0]).slice(0, 2).join("").toUpperCase(), status: "invited" };
    this.users.push(u);
    this.emit();
    return { user: u, emailed: false };
  }
  resendInvite(actorId: string, userId: string) {
    this.require(actorId, "users.manage");
    const u = this.users.find((x) => x.id === userId); if (!u) throw new ApiError("Not found", "not_found");
    if (u.status !== "invited") throw new ApiError(`${u.name} has already set a password`, "conflict");
    return { user: u, emailed: false };
  }
  revokeInvite(actorId: string, userId: string) {
    this.require(actorId, "users.manage");
    const i = this.users.findIndex((x) => x.id === userId); if (i < 0) throw new ApiError("Not found", "not_found");
    if (this.users[i].status !== "invited") throw new ApiError(`${this.users[i].name} has already signed in — deactivate the account instead`, "conflict");
    this.users.splice(i, 1);
    this.emit();
  }
  revokeMembership(actorId: string, membershipId: string) {
    const m = this.memberships.find((x) => x.id === membershipId); if (!m) throw new ApiError("Not found", "not_found");
    this.require(actorId, "membership.manage", m.projectId);
    m.revokedAt = this.now();
    this.log(m.projectId, actorId, "role_revoked", `${this.userName(m.userId)} revoked ${m.role}`);
    this.emit();
  }
  // ---------- notifications (§8) ----------
  /** Live mode replaces this from the server; the mock derives nothing, so the bell is simply empty. */
  notifications: AppNotification[] = [];
  listNotifications(): AppNotification[] { return this.notifications; }
  unreadCount(): number { return this.notifications.filter((n) => !n.readAt).length; }
  async markRead(_ids?: string[]): Promise<void> {
    const at = this.now();
    this.notifications = this.notifications.map((n) => (!_ids || _ids.includes(n.id) ? { ...n, readAt: n.readAt ?? at } : n));
    this.emit();
  }
  async refreshNotifications(): Promise<void> { /* mock has no server */ }

  listThresholds() { return this.thresholds; }

  /** Resolve a download link for a stored file. The mock has no server, so it returns what the record carries. */
  async fileUrl(kind: "document" | "attachment", id: string): Promise<string | null> {
    const row = kind === "document" ? this.documents.find((d) => d.id === id) : this.attachments.find((a) => a.id === id);
    return row?.url ?? null;
  }

  // ======================================================================
  // Phase 2 — money
  // ======================================================================
  listCostItems(projectId: string) { return this.costItems.filter((c) => c.projectId === projectId); }
  addCostItem(actorId: string, projectId: string, input: { category: CostCategory; label: string; plannedAmount: number }): CostItem {
    this.require(actorId, "cost.create", projectId);
    if (!(input.plannedAmount > 0) || !input.label.trim()) throw new ApiError("Label and a positive amount are required", "invalid");
    const at = this.now();
    const c: CostItem = { id: this.id("ci"), projectId, category: input.category, label: input.label.trim(), plannedAmount: input.plannedAmount,
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.costItems.push(c);
    this.log(projectId, actorId, "cost_item", `Budget line "${c.label}" ${this.fmt(c.plannedAmount)} submitted (pending Finance check)`, undefined, { model: "CostItem", id: c.id });
    this.emit(); return c;
  }
  private fmt(n: number) { return "₦" + Math.round(n).toLocaleString("en-NG"); }

  listPOs(projectId?: string) { return this.purchaseOrders.filter((p) => !projectId || p.projectId === projectId).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)); }
  poRemaining(item: PurchaseItem, poId: string) {
    const pendingQty = this.goodsReceipts.filter((g) => g.poId === poId && g.reviewStatus === "pending").flatMap((g) => g.lines).filter((l) => l.purchaseItemId === item.id).reduce((s, l) => s + l.qty, 0);
    return item.qty - item.qtyReceived - pendingQty;
  }
  createPO(actorId: string, projectId: string, input: { vendorId: string; notes?: string; items: { inventoryItemId?: string; costItemId?: string; description: string; qty: number; unitCost: number }[] }): PurchaseOrder {
    this.require(actorId, "po.create", projectId);
    const lines = input.items.filter((i) => i.description.trim() && i.qty > 0 && i.unitCost > 0);
    if (!lines.length) throw new ApiError("Add at least one line with quantity and unit cost", "invalid");
    if (!this.vendors.some((v) => v.id === input.vendorId)) throw new ApiError("Choose a vendor", "invalid");
    const at = this.now();
    const items: PurchaseItem[] = lines.map((l) => ({ id: this.id("pi"), inventoryItemId: l.inventoryItemId || undefined, costItemId: l.costItemId || undefined, description: l.description.trim(), qty: l.qty, unitCost: l.unitCost, lineTotal: l.qty * l.unitCost, qtyReceived: 0 }));
    const total = items.reduce((s, i) => s + i.lineTotal, 0);
    const requiredRoles: RoleCode[] = total >= this.thresholdNum("po.director_threshold", 5_000_000) ? ["finance", "director"] : ["finance"];
    const poNumber = `PO-${new Date().getFullYear()}-${String(this.purchaseOrders.length + 27).padStart(3, "0")}`;
    const ap: Approval = { id: this.id("ap"), projectId, kind: "po", title: `${poNumber} · ${this.vendorName(input.vendorId)}`,
      description: `${items.map((i) => `${i.qty} × ${i.description}`).join("; ")}. ${requiredRoles.length > 1 ? "≥ director threshold → Finance + Director." : "Finance approval."}`,
      requestedBy: actorId, requestedAt: at, requiredRoles, decisions: [], status: "pending", amount: total };
    this.approvals.push(ap);
    const po: PurchaseOrder = { id: this.id("po"), projectId, poNumber, vendorId: input.vendorId, status: "pending_approval", raisedBy: actorId, raisedAt: at, items, total, notes: input.notes?.trim() || undefined,
      approvalId: ap.id, createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId };
    this.purchaseOrders.push(po);
    this.log(projectId, actorId, "po_raised", `${poNumber} raised — ${this.vendorName(input.vendorId)}, ${this.fmt(total)} (awaiting ${requiredRoles.join(" + ")})`, undefined, { model: "PurchaseOrder", id: po.id });
    this.emit(); return po;
  }

  listGRNs(projectId?: string) { return this.goodsReceipts.filter((g) => !projectId || g.projectId === projectId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)); }
  grnValue(g: GoodsReceipt) { const po = this.purchaseOrders.find((p) => p.id === g.poId); return g.lines.reduce((s, l) => s + l.qty * (po?.items.find((i) => i.id === l.purchaseItemId)?.unitCost ?? 0), 0); }
  receiveGoods(actorId: string, poId: string, input: { lines: { purchaseItemId: string; qty: number; serials?: string[]; condition?: "good" | "damaged" }[]; attachmentIds: string[]; notes?: string; locationId?: string }): GoodsReceipt {
    const po = this.purchaseOrders.find((p) => p.id === poId); if (!po) throw new ApiError("PO not found", "not_found");
    this.require(actorId, "goods_receipt.create", po.projectId);
    if (!["approved", "partially_delivered"].includes(po.status)) throw new ApiError(`PO is ${po.status.replace("_", " ")} — only approved POs can be received`, "conflict");
    if (!input.attachmentIds.length) throw new ApiError("A delivery note / receipt image is required", "invalid");
    const lines = input.lines.filter((l) => l.qty > 0);
    if (!lines.length) throw new ApiError("Enter a received quantity", "invalid");
    for (const l of lines) {
      const it = po.items.find((i) => i.id === l.purchaseItemId); if (!it) throw new ApiError("Unknown PO line", "invalid");
      const rem = this.poRemaining(it, po.id); if (l.qty > rem) throw new ApiError(`${it.description}: only ${rem} outstanding on this PO`, "invalid");
      if (it.inventoryItemId && this.item(it.inventoryItemId).isSerialised) {
        const ser = (l.serials ?? []).map((s) => s.trim()).filter(Boolean);
        if (ser.length !== l.qty) throw new ApiError(`${it.description}: ${l.qty} serial number${l.qty > 1 ? "s" : ""} required (got ${ser.length})`, "invalid");
        if (new Set(ser).size !== ser.length) throw new ApiError("Duplicate serials in the same line", "invalid");
        const dup = ser.find((s) => this.assets.some((a) => a.serial === s)); if (dup) throw new ApiError(`Serial ${dup} already exists in the asset register`, "conflict");
        if (ser.some((s) => /[^\x20-\x7E]/.test(s))) throw new ApiError("Serials must be plain ASCII (hidden characters found)", "invalid");
        l.serials = ser;
      }
    }
    const at = this.now();
    const g: GoodsReceipt = { id: this.id("grn"), projectId: po.projectId, poId, grnNumber: `GRN-${new Date().getFullYear()}-${String(this.goodsReceipts.length + 10).padStart(3, "0")}`,
      receivedAt: at, receivedBy: actorId, lines: lines.map((l) => ({ purchaseItemId: l.purchaseItemId, qty: l.qty, serials: l.serials, condition: l.condition ?? "good" })),
      attachmentIds: input.attachmentIds, locationId: input.locationId ?? "loc_wh", notes: input.notes?.trim() || undefined,
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.goodsReceipts.push(g);
    this.log(po.projectId, actorId, "delivery", `${g.grnNumber} — ${lines.map((l) => `${l.qty} × ${po.items.find((i) => i.id === l.purchaseItemId)!.description}`).join(", ")} received against ${po.poNumber} (pending check)`, undefined, { model: "GoodsReceipt", id: g.id });
    this.emit(); return g;
  }
  /** On GRN check: stock lines → receipt movements + assets; service lines → actuals; PO status. */
  private postGoodsReceipt(g: GoodsReceipt, actorId: string) {
    const po = this.purchaseOrders.find((p) => p.id === g.poId)!; const at = this.now();
    for (const l of g.lines) {
      const it = po.items.find((i) => i.id === l.purchaseItemId)!; it.qtyReceived += l.qty;
      if (it.inventoryItemId) {
        const inv = this.item(it.inventoryItemId);
        const m: StockMovement = { id: this.id("mv"), itemId: inv.id, movementType: "receipt", qty: l.qty, locationToId: g.locationId, unitCost: it.unitCost, totalCost: l.qty * it.unitCost, projectId: g.projectId,
          sourceRef: { model: "GoodsReceipt", id: g.id, label: g.grnNumber }, serials: l.serials, attachmentIds: g.attachmentIds, createdBy: g.receivedBy, createdAt: at,
          reviewStatus: "checked", submittedBy: g.receivedBy, submittedAt: g.receivedAt, checkedBy: actorId, checkedAt: at, reviewVersion: 1 };
        this.movements.push(m);
        (l.serials ?? []).forEach((s) => this.assets.push({ id: this.id("as"), inventoryItemId: inv.id, assetType: (["panel","inverter","battery","meter","ct","ats","cable","mounting"].includes(inv.category) ? inv.category : "other") as AssetType,
          make: inv.make ?? "", model: inv.model ?? inv.name, serial: s, unitCost: it.unitCost, vendorId: po.vendorId, purchaseItemId: it.id, grnId: g.id, status: l.condition === "damaged" ? "faulty" : "in_stock",
          locationId: g.locationId, createdAt: at, createdBy: g.receivedBy, updatedAt: at, updatedBy: actorId }));
      } else {
        const cat = this.costItems.find((c) => c.id === it.costItemId)?.category ?? "equipment";
        this.actuals.push({ id: this.id("act"), projectId: g.projectId, costItemId: it.costItemId, category: cat, source: "goods_receipt", sourceRef: { model: "GoodsReceipt", id: g.id, label: `${g.grnNumber} · ${it.description}` },
          amount: l.qty * it.unitCost, date: at, vendorId: po.vendorId, attachmentIds: g.attachmentIds, createdBy: actorId });
      }
    }
    po.status = po.items.every((i) => i.qtyReceived >= i.qty) ? "delivered" : "partially_delivered"; po.updatedAt = at; po.updatedBy = actorId;
  }

  listActuals(projectId: string) { return this.actuals.filter((a) => a.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date)); }
  listChangeOrders(projectId: string) { return this.changeOrders.filter((c) => c.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  raiseChangeOrder(actorId: string, projectId: string, input: { title: string; reason: string; scopeDelta: string; costDelta: number; timeDeltaDays: number }): ChangeOrder {
    this.require(actorId, "change_order.create", projectId);
    if (!input.title.trim() || !input.reason.trim()) throw new ApiError("Title and reason are required", "invalid");
    const p = this.raw(projectId); const at = this.now();
    const big = Math.abs(input.costDelta) >= this.thresholdNum("co.director_threshold", 2_000_000) || Math.abs(input.costDelta) >= p.contractValue * this.thresholdNum("co.director_pct", 10) / 100;
    const requiredRoles: RoleCode[] = big ? ["finance", "director"] : ["finance"];
    const coNumber = `CO-${String(this.changeOrders.filter((c) => c.projectId === projectId).length + 1).padStart(2, "0")}`;
    const ap: Approval = { id: this.id("ap"), projectId, kind: "change_order", title: `${coNumber} · ${input.title.trim()}`, description: `${input.scopeDelta.trim() || "—"}. ${input.reason.trim()} ${big ? "Above director threshold → Finance + Director." : "Finance only."}`,
      requestedBy: actorId, requestedAt: at, requiredRoles, decisions: [], status: "pending", amount: input.costDelta };
    this.approvals.push(ap);
    const co: ChangeOrder = { id: this.id("co"), projectId, coNumber, title: input.title.trim(), reason: input.reason.trim(), scopeDelta: input.scopeDelta.trim(), costDelta: input.costDelta, timeDeltaDays: input.timeDeltaDays,
      status: "pending_approval", approvalId: ap.id, createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId };
    this.changeOrders.push(co);
    this.log(projectId, actorId, "change_order", `${coNumber} raised — ${co.title}, ${this.fmt(co.costDelta)}, ${co.timeDeltaDays} d (awaiting ${requiredRoles.join(" + ")})`, undefined, { model: "ChangeOrder", id: co.id });
    this.emit(); return co;
  }
  retention(projectId: string): Retention {
    const p = this.raw(projectId);
    return this.retentions.find((r) => r.projectId === projectId) ?? { projectId, percent: p.retentionPercent, amountHeld: p.stage >= 6 ? Math.round(p.contractValue * p.retentionPercent / 100) : 0, releaseConditions: `Held from handover · released after ${this.thresholdNum("dlp.months", 12)}-month DLP` };
  }
  requestRetentionRelease(actorId: string, projectId: string) {
    this.require(actorId, "retention.request", projectId);
    const r = this.retention(projectId);
    if (r.releasedAt) throw new ApiError("Retention already released", "conflict");
    if (!r.amountHeld) throw new ApiError("No retention is held on this project yet", "conflict");
    if (this.approvals.some((a) => a.projectId === projectId && a.kind === "retention" && a.status === "pending")) throw new ApiError("Release already requested", "conflict");
    if (!this.retentions.some((x) => x.projectId === projectId)) this.retentions.push(r);
    const requesterIsFinance = this.rolesOn(actorId, projectId).includes("finance");
    const ap: Approval = { id: this.id("ap"), projectId, kind: "retention", title: `Retention release · ${this.fmt(r.amountHeld)}`, description: r.releaseConditions,
      requestedBy: actorId, requestedAt: this.now(), requiredRoles: requesterIsFinance ? ["director"] : ["finance", "director"], decisions: [], status: "pending", amount: r.amountHeld };
    this.approvals.push(ap);
    this.log(projectId, actorId, "retention", `Retention release requested — ${this.fmt(r.amountHeld)}`, undefined, { model: "Approval", id: ap.id });
    this.emit(); return ap;
  }

  money(projectId: string): ProjectMoney {
    const p = this.raw(projectId);
    const ci = this.costItems.filter((c) => c.projectId === projectId && c.reviewStatus === "checked");
    const planned = ci.length ? ci.reduce((s, c) => s + c.plannedAmount, 0) : p.approvedBudget;
    const pos = this.purchaseOrders.filter((o) => o.projectId === projectId && ["approved", "partially_delivered", "delivered", "closed"].includes(o.status));
    const committed = pos.reduce((s, o) => s + o.total, 0);
    const acts = this.actuals.filter((a) => a.projectId === projectId);
    const actual = acts.reduce((s, a) => s + a.amount, 0);
    const changeOrders = this.changeOrders.filter((c) => c.projectId === projectId && c.status === "approved").reduce((s, c) => s + c.costDelta, 0);
    const byCategory = Object.fromEntries(CATS.map((c) => [c, { planned: 0, committed: 0, actual: 0 }])) as ProjectMoney["byCategory"];
    ci.forEach((c) => { byCategory[c.category].planned += c.plannedAmount; });
    pos.forEach((o) => o.items.forEach((i) => { const cat = this.costItems.find((c) => c.id === i.costItemId)?.category ?? "equipment"; byCategory[cat].committed += i.lineTotal; }));
    acts.forEach((a) => { byCategory[a.category].actual += a.amount; });
    return { planned, committed, actual, variance: planned - actual, burnPct: planned > 0 ? Math.round(actual / planned * 100) : 0, forecast: Math.max(committed, actual), byCategory, changeOrders, retentionHeld: this.retention(projectId).amountHeld };
  }

  // ======================================================================
  // Phase 2 — stock & assets
  // ======================================================================
  balances(): StockBalance[] {
    const wac = new Map<string, { qty: number; wac: number }>(); const loc = new Map<string, number>(); const last = new Map<string, string>();
    const mv = this.movements.filter((m) => m.reviewStatus === "checked").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const m of mv) {
      const w = wac.get(m.itemId) ?? { qty: 0, wac: 0 };
      const add = (l: string | undefined, q: number) => { if (!l) return; const k = `${m.itemId}|${l}`; loc.set(k, (loc.get(k) ?? 0) + q); };
      switch (m.movementType) {
        case "receipt": case "return": { const nq = w.qty + m.qty; w.wac = nq > 0 ? (w.qty * w.wac + m.qty * m.unitCost) / nq : m.unitCost; w.qty = nq; add(m.locationToId, m.qty); break; }
        case "issue": case "write_off": { w.qty -= m.qty; add(m.locationFromId, -m.qty); break; }
        case "adjustment": { if (m.locationToId) { w.qty += m.qty; add(m.locationToId, m.qty); } else { w.qty -= m.qty; add(m.locationFromId, -m.qty); } break; }
        case "transfer": { add(m.locationFromId, -m.qty); add(m.locationToId, m.qty); break; }
      }
      wac.set(m.itemId, w); last.set(m.itemId, m.createdAt);
    }
    const out: StockBalance[] = [];
    for (const [k, qty] of loc) { const [itemId, locationId] = k.split("|"); const w = wac.get(itemId)!; const it = this.item(itemId);
      out.push({ itemId, locationId, qtyOnHand: qty, wacUnitCost: round(w.wac), value: round(qty * w.wac), lastMovementAt: last.get(itemId), belowReorder: qty <= it.reorderLevel }); }
    for (const it of this.items) if (!out.some((b) => b.itemId === it.id)) out.push({ itemId: it.id, locationId: "loc_wh", qtyOnHand: 0, wacUnitCost: 0, value: 0, belowReorder: 0 <= it.reorderLevel });
    return out;
  }
  balanceOf(itemId: string, locationId = "loc_wh") { return this.balances().find((b) => b.itemId === itemId && b.locationId === locationId) ?? { itemId, locationId, qtyOnHand: 0, wacUnitCost: 0, value: 0, belowReorder: true }; }
  wacOf(itemId: string) { const b = this.balances().find((x) => x.itemId === itemId); return b?.wacUnitCost ?? 0; }
  stockValue() { const bs = this.balances(); const byCat: Record<string, number> = {}; bs.forEach((b) => { const c = this.item(b.itemId).category; byCat[c] = (byCat[c] ?? 0) + b.value; }); return { total: round(bs.reduce((s, b) => s + b.value, 0)), byCategory: byCat }; }
  /** available = checked on-hand minus quantities reserved by pending issues / write-offs */
  available(itemId: string, locationId = "loc_wh") {
    const pend = this.movements.filter((m) => m.itemId === itemId && m.reviewStatus === "pending" && ["issue", "write_off", "transfer"].includes(m.movementType) && m.locationFromId === locationId).reduce((s, m) => s + m.qty, 0);
    return this.balanceOf(itemId, locationId).qtyOnHand - pend;
  }
  inStockSerials(itemId: string, locationId = "loc_wh") {
    const reserved = new Set(this.movements.filter((m) => m.reviewStatus === "pending" && m.itemId === itemId).flatMap((m) => m.serials ?? []));
    return this.assets.filter((a) => a.inventoryItemId === itemId && a.status === "in_stock" && a.locationId === locationId && !reserved.has(a.serial)).map((a) => a.serial);
  }
  listMovements(f: { itemId?: string; projectId?: string; type?: StockMovement["movementType"]; status?: ReviewStatus } = {}) {
    return this.movements.filter((m) => (!f.itemId || m.itemId === f.itemId) && (!f.projectId || m.projectId === f.projectId) && (!f.type || m.movementType === f.type) && (!f.status || m.reviewStatus === f.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  listAssets(f: { projectId?: string; itemId?: string; status?: Asset["status"] } = {}) {
    return this.assets.filter((a) => (!f.projectId || a.projectId === f.projectId) && (!f.itemId || a.inventoryItemId === f.itemId) && (!f.status || a.status === f.status));
  }

  private validateSerials(itemId: string, qty: number, serials: string[] | undefined, locationId: string) {
    const it = this.item(itemId); if (!it.isSerialised) return undefined;
    const ser = (serials ?? []).map((s) => s.trim()).filter(Boolean);
    if (ser.length !== qty) throw new ApiError(`${it.name} is serialised — ${qty} serial${qty > 1 ? "s" : ""} required (got ${ser.length})`, "invalid");
    const ok = new Set(this.inStockSerials(itemId, locationId));
    const bad = ser.find((s) => !ok.has(s)); if (bad) throw new ApiError(`Serial ${bad} is not in stock at ${this.locationName(locationId)} (or already reserved)`, "invalid");
    return ser;
  }
  issueStock(actorId: string, input: { itemId: string; qty: number; projectId: string; serials?: string[]; label?: string; locationId?: string }): StockMovement {
    if (!this.can(actorId, "inventory.write") && !this.can(actorId, "inventory.request", input.projectId)) throw new ApiError("Only a Store Keeper (or a PM / Field Tech on the project) can issue stock", "forbidden");
    const loc = input.locationId ?? "loc_wh"; const it = this.item(input.itemId);
    if (!(input.qty > 0)) throw new ApiError("Quantity must be positive", "invalid");
    const avail = this.available(it.id, loc); if (input.qty > avail) throw new ApiError(`Only ${avail} ${it.unit} of ${it.name} available at ${this.locationName(loc)} — no negative stock`, "invalid");
    const serials = this.validateSerials(it.id, input.qty, input.serials, loc);
    const wac = this.wacOf(it.id); const at = this.now();
    const m: StockMovement = { id: this.id("mv"), itemId: it.id, movementType: "issue", qty: input.qty, locationFromId: loc, unitCost: wac, totalCost: round(input.qty * wac), projectId: input.projectId,
      sourceRef: { model: "PickList", id: this.id("pl"), label: input.label?.trim() || "Pick list" }, serials, createdBy: actorId, createdAt: at,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.movements.push(m);
    this.log(input.projectId, actorId, "stock_movement", `Issue requested — ${it.name} × ${input.qty} @ ${this.fmt(wac)} (pending check)`, undefined, { model: "StockMovement", id: m.id });
    this.emit(); return m;
  }
  returnStock(actorId: string, input: { itemId: string; qty: number; projectId: string; serials?: string[]; reason?: string }): StockMovement {
    if (!this.can(actorId, "inventory.write") && !this.can(actorId, "inventory.request", input.projectId)) throw new ApiError("Not allowed", "forbidden");
    const it = this.item(input.itemId); if (!(input.qty > 0)) throw new ApiError("Quantity must be positive", "invalid");
    let serials: string[] | undefined;
    if (it.isSerialised) { serials = (input.serials ?? []).map((s) => s.trim()).filter(Boolean); if (serials.length !== input.qty) throw new ApiError(`${input.qty} serials required`, "invalid");
      const bad = serials.find((s) => !this.assets.some((a) => a.serial === s && a.projectId === input.projectId && a.status === "installed")); if (bad) throw new ApiError(`Serial ${bad} is not installed on this project`, "invalid"); }
    const wac = this.wacOf(it.id); const at = this.now();
    const m: StockMovement = { id: this.id("mv"), itemId: it.id, movementType: "return", qty: input.qty, locationToId: "loc_wh", unitCost: wac, totalCost: round(input.qty * wac), projectId: input.projectId,
      sourceRef: { model: "Return", id: this.id("rt"), label: input.reason?.trim() || "Unused parts returned" }, serials, createdBy: actorId, createdAt: at, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.movements.push(m);
    this.log(input.projectId, actorId, "stock_movement", `Return requested — ${it.name} × ${input.qty} (pending check)`, undefined, { model: "StockMovement", id: m.id });
    this.emit(); return m;
  }
  /** On check of an issue / return: assets move, project actual posts (issue = cost, return = credit). */
  private postMovementEffects(m: StockMovement, actorId: string) {
    const at = this.now(); const it = this.item(m.itemId);
    if (m.movementType === "issue") {
      const p = m.projectId ? this.raw(m.projectId) : undefined;
      (m.serials ?? []).forEach((s) => { const a = this.assets.find((x) => x.serial === s); if (!a) return; a.status = "installed"; a.projectId = m.projectId; a.installDate = at; a.locationId = undefined; a.updatedAt = at; a.updatedBy = actorId;
        if (it.warrantyMonths) { a.warrantyStart = at.slice(0, 10); const e = new Date(at); e.setMonth(e.getMonth() + it.warrantyMonths); a.warrantyEnd = e.toISOString().slice(0, 10); } });
      if (m.projectId) this.actuals.push({ id: this.id("act"), projectId: m.projectId, category: p && p.stage >= 7 ? "om" : "equipment", source: "issue", sourceRef: { model: "StockMovement", id: m.id, label: `${it.name} × ${m.qty}` },
        amount: m.totalCost, date: at, attachmentIds: m.attachmentIds ?? [], createdBy: actorId });
    }
    if (m.movementType === "transfer") {
      (m.serials ?? []).forEach((s) => { const a = this.assets.find((x) => x.serial === s); if (a && a.status === "in_stock") { a.locationId = m.locationToId; a.updatedAt = at; a.updatedBy = actorId; } });
    }
    if (m.movementType === "return") {
      (m.serials ?? []).forEach((s) => { const a = this.assets.find((x) => x.serial === s); if (!a) return; a.status = "in_stock"; a.projectId = undefined; a.locationId = m.locationToId; a.updatedAt = at; a.updatedBy = actorId; });
      if (m.projectId) this.actuals.push({ id: this.id("act"), projectId: m.projectId, category: "equipment", source: "return", sourceRef: { model: "StockMovement", id: m.id, label: `${it.name} × ${m.qty} returned` },
        amount: -m.totalCost, date: at, attachmentIds: [], createdBy: actorId });
    }
  }
  writeOff(actorId: string, input: { itemId: string; qty: number; reason: string; serials?: string[]; attachmentIds: string[]; projectId?: string }): StockMovement {
    this.require(actorId, "inventory.write");
    const it = this.item(input.itemId); if (!(input.qty > 0)) throw new ApiError("Quantity must be positive", "invalid");
    if (!input.reason.trim()) throw new ApiError("A reason is required", "invalid");
    if (!input.attachmentIds.length) throw new ApiError("A photo of the damaged / lost goods is required", "invalid");
    const avail = this.available(it.id); if (input.qty > avail) throw new ApiError(`Only ${avail} available`, "invalid");
    const serials = this.validateSerials(it.id, input.qty, input.serials, "loc_wh");
    const wac = this.wacOf(it.id); const amount = round(input.qty * wac); const at = this.now();
    const requiredRoles: RoleCode[] = amount >= this.thresholdNum("writeoff.director_threshold", 500_000) ? ["finance", "director"] : ["finance"];
    const ap: Approval = { id: this.id("ap"), projectId: input.projectId, kind: "write_off", title: `Write-off · ${input.qty} × ${it.name} (${this.fmt(amount)})`, description: `${input.reason.trim()} ${requiredRoles.length > 1 ? "Above director threshold → Finance + Director." : "Below ₦500k → Finance only."}`,
      requestedBy: actorId, requestedAt: at, requiredRoles, decisions: [], status: "pending", amount };
    this.approvals.push(ap);
    const m: StockMovement = { id: this.id("mv"), itemId: it.id, movementType: "write_off", qty: input.qty, locationFromId: "loc_wh", unitCost: wac, totalCost: amount, projectId: input.projectId, reason: input.reason.trim(), serials,
      attachmentIds: input.attachmentIds, createdBy: actorId, createdAt: at, approvalId: ap.id, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.movements.push(m);
    this.log(input.projectId, actorId, "stock_movement", `Write-off requested — ${it.name} × ${input.qty}, ${this.fmt(amount)} (awaiting ${requiredRoles.join(" + ")})`, input.reason.trim(), { model: "StockMovement", id: m.id });
    this.emit(); return m;
  }

  // ======================================================================
  // Phase 2 — QuickBooks reconciliation (nightly job in the backend; on-demand here)
  // ======================================================================
  listQbBills(): (QbBill & { poId?: string; poNumber?: string; confidence: "matched" | "suggested" | "unmatched"; note?: string })[] {
    return this.qbBills.map((b) => {
      if (b.matchStatus === "matched" && b.matchedPoId) { const po = this.purchaseOrders.find((p) => p.id === b.matchedPoId); return { ...b, poId: po?.id, poNumber: po?.poNumber, confidence: "matched" as const, note: "Matched manually" }; }
      const cands = this.purchaseOrders.filter((p) => p.projectId === b.projectId && !["pending_approval", "rejected"].includes(p.status) && this.vendorName(p.vendorId).toLowerCase() === b.vendorName.toLowerCase());
      const exact = cands.find((p) => Math.abs(p.total - b.totalAmount) <= Math.max(1, p.total * 0.01));
      if (exact) return { ...b, poId: exact.id, poNumber: exact.poNumber, confidence: "matched" as const, note: "Vendor + amount within 1%" };
      if (cands.length) { const c = cands[0]; return { ...b, poId: c.id, poNumber: c.poNumber, confidence: "suggested" as const, note: `Vendor matches ${c.poNumber} but amount differs by ${this.fmt(Math.abs(c.total - b.totalAmount))}` }; }
      return { ...b, confidence: "unmatched" as const, note: b.projectId ? "No PO from this vendor on the project" : "Bill has no project" };
    }).sort((a, b) => (a.confidence === "unmatched" ? 0 : a.confidence === "suggested" ? 1 : 2) - (b.confidence === "unmatched" ? 0 : b.confidence === "suggested" ? 1 : 2));
  }
  matchBill(actorId: string, billId: string, poId: string) {
    this.require(actorId, "recon.write");
    const b = this.qbBills.find((x) => x.id === billId); const po = this.purchaseOrders.find((p) => p.id === poId);
    if (!b || !po) throw new ApiError("Bill or PO not found", "not_found");
    b.matchedPoId = po.id; b.matchStatus = "matched"; if (!b.projectId) b.projectId = po.projectId;
    this.log(po.projectId, actorId, "reconciliation", `QB bill ${b.docNumber} (${this.fmt(b.totalAmount)}) matched to ${po.poNumber}`, undefined, { model: "QbBill", id: b.id });
    this.emit();
  }
  unmatchBill(actorId: string, billId: string) {
    this.require(actorId, "recon.write");
    const b = this.qbBills.find((x) => x.id === billId); if (!b) throw new ApiError("Bill not found", "not_found");
    b.matchedPoId = undefined; b.matchStatus = "unmatched"; this.emit();
  }

  // ======================================================================
  // Phase 3 — locations, transfers, stock counts
  // ======================================================================
  listLocations() { return this.locations.filter((l) => l.isActive); }
  addLocation(actorId: string, input: { name: string; type: StockLocation["type"]; custodianId?: string }): StockLocation {
    this.require(actorId, "inventory.write");
    if (!input.name.trim()) throw new ApiError("Name is required", "invalid");
    const l: StockLocation = { id: this.id("loc"), name: input.name.trim(), type: input.type, custodianId: input.custodianId, isActive: true };
    this.locations.push(l); this.emit(); return l;
  }
  transferStock(actorId: string, input: { itemId: string; qty: number; fromId: string; toId: string; serials?: string[]; label?: string }): StockMovement {
    this.require(actorId, "inventory.write");
    const it = this.item(input.itemId); if (!(input.qty > 0)) throw new ApiError("Quantity must be positive", "invalid");
    if (input.fromId === input.toId) throw new ApiError("Choose two different locations", "invalid");
    const avail = this.available(it.id, input.fromId); if (input.qty > avail) throw new ApiError(`Only ${avail} available at ${this.locationName(input.fromId)}`, "invalid");
    const serials = this.validateSerials(it.id, input.qty, input.serials, input.fromId);
    const wac = this.wacOf(it.id); const at = this.now();
    const m: StockMovement = { id: this.id("mv"), itemId: it.id, movementType: "transfer", qty: input.qty, locationFromId: input.fromId, locationToId: input.toId, unitCost: wac, totalCost: round(input.qty * wac), serials,
      sourceRef: { model: "Transfer", id: this.id("tr"), label: input.label?.trim() || `${this.locationName(input.fromId)} → ${this.locationName(input.toId)}` }, createdBy: actorId, createdAt: at,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.movements.push(m); this.emit(); return m;
  }
  listCounts() { return [...this.stockCounts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  startCount(actorId: string, locationId: string): StockCount {
    this.require(actorId, "stockcount.create");
    if (this.stockCounts.some((c) => c.locationId === locationId && ["open", "submitted"].includes(c.status))) throw new ApiError("A count is already open for this location", "conflict");
    const at = this.now(); const bal = this.balances().filter((b) => b.locationId === locationId);
    const lines = this.items.filter((i) => i.isActive).map((i) => ({ itemId: i.id, expectedQty: bal.find((b) => b.itemId === i.id)?.qtyOnHand ?? 0, countedQty: null, variance: 0 }));
    const sc: StockCount = { id: this.id("sc"), locationId, countDate: at.slice(0, 10), countedBy: actorId, status: "open", lines, varianceValue: 0, createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId };
    this.stockCounts.push(sc); this.emit(); return sc;
  }
  enterCount(actorId: string, countId: string, lines: { itemId: string; countedQty: number | null; note?: string; attachmentId?: string }[]) {
    this.require(actorId, "stockcount.create");
    const sc = this.stockCounts.find((c) => c.id === countId); if (!sc) throw new ApiError("Count not found", "not_found");
    if (sc.status !== "open") throw new ApiError("Count is not open", "conflict");
    for (const l of lines) { const row = sc.lines.find((x) => x.itemId === l.itemId); if (!row) continue;
      row.countedQty = l.countedQty; row.variance = l.countedQty === null ? 0 : l.countedQty - row.expectedQty; if (l.note !== undefined) row.note = l.note; if (l.attachmentId) row.attachmentId = l.attachmentId; }
    sc.updatedAt = this.now(); sc.updatedBy = actorId; this.emit();
  }
  /** Submit for Finance approval. Lines outside tolerance (or any variance on serialised items) need a note. */
  submitCount(actorId: string, countId: string): Approval {
    this.require(actorId, "stockcount.create");
    const sc = this.stockCounts.find((c) => c.id === countId); if (!sc) throw new ApiError("Count not found", "not_found");
    if (sc.status !== "open") throw new ApiError("Count is not open", "conflict");
    const missing = sc.lines.filter((l) => l.countedQty === null); if (missing.length) throw new ApiError(`${missing.length} line${missing.length > 1 ? "s" : ""} not counted yet`, "invalid");
    const tol = this.thresholdNum("stockcount.tolerance_pct", 2) / 100; let value = 0;
    for (const l of sc.lines) { if (!l.variance) continue; const it = this.item(l.itemId); value += Math.abs(l.variance) * this.wacOf(l.itemId);
      const over = it.isSerialised ? true : Math.abs(l.variance) > Math.max(1, l.expectedQty * tol);
      if (over && !l.note?.trim()) throw new ApiError(`${it.name}: variance ${l.variance > 0 ? "+" : ""}${l.variance} is outside tolerance — a note is required`, "invalid"); }
    sc.varianceValue = round(value); const at = this.now();
    const ap: Approval = { id: this.id("ap"), kind: "stock_count", title: `Stock count ${sc.countDate} · ${this.locationName(sc.locationId)}`, description: `${sc.lines.filter((l) => l.variance).length} variance line${sc.lines.filter((l) => l.variance).length === 1 ? "" : "s"}, ${this.fmt(sc.varianceValue)} absolute value at WAC. Approval posts adjustments to the ledger.`,
      requestedBy: actorId, requestedAt: at, requiredRoles: ["finance"], decisions: [], status: "pending", amount: sc.varianceValue };
    this.approvals.push(ap); sc.approvalId = ap.id; sc.status = "submitted"; sc.updatedAt = at; sc.updatedBy = actorId; this.emit(); return ap;
  }

  // ======================================================================
  // Phase 3 — visits, issues, commissioning, HSE, warranty
  // ======================================================================
  listVisits(projectId?: string) { return this.visits.filter((v) => !projectId || v.projectId === projectId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  logVisit(actorId: string, projectId: string, input: { visitType: VisitType; startedAt: string; endedAt: string; technicianIds?: string[]; findings: string; actionsTaken: string; costTravel: number; costLabour: number;
      parts?: { itemId: string; qty: number; serials?: string[] }[]; locationId?: string; attachmentIds: string[]; issueIds?: string[]; clientSignoff?: SiteVisit["clientSignoff"]; gps?: SiteVisit["gps"]; offlineCapturedAt?: string }): SiteVisit {
    this.require(actorId, "visit.create", projectId);
    if (!input.findings.trim()) throw new ApiError("Findings are required", "invalid");
    if (!input.attachmentIds.length) throw new ApiError("At least one site photo is required", "invalid");
    if (new Date(input.endedAt).getTime() < new Date(input.startedAt).getTime()) throw new ApiError("Visit ends before it starts", "invalid");
    const loc = input.locationId ?? "loc_van1"; const at = this.now(); const visitId = this.id("vis");
    const parts: SiteVisit["parts"] = [];
    for (const p of input.parts ?? []) {
      if (!(p.qty > 0)) continue; const it = this.item(p.itemId);
      const avail = this.available(it.id, loc); if (p.qty > avail) throw new ApiError(`${it.name}: only ${avail} ${it.unit} at ${this.locationName(loc)}`, "invalid");
      const serials = this.validateSerials(it.id, p.qty, p.serials, loc); const wac = this.wacOf(it.id);
      const m: StockMovement = { id: this.id("mv"), itemId: it.id, movementType: "issue", qty: p.qty, locationFromId: loc, unitCost: wac, totalCost: round(p.qty * wac), projectId, serials,
        sourceRef: { model: "SiteVisit", id: visitId, label: "Parts used on visit" }, createdBy: actorId, createdAt: at, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
      this.movements.push(m); parts.push({ movementId: m.id, itemId: it.id, qty: p.qty, serials });
    }
    const costParts = parts.reduce((s, p) => s + (this.movements.find((m) => m.id === p.movementId)?.totalCost ?? 0), 0);
    const durationHrs = round((new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime()) / 3600000);
    const v: SiteVisit = { id: visitId, projectId, visitType: input.visitType, startedAt: input.startedAt, endedAt: input.endedAt, technicianIds: input.technicianIds?.length ? input.technicianIds : [actorId], durationHrs,
      findings: input.findings.trim(), actionsTaken: input.actionsTaken.trim(), costTravel: input.costTravel || 0, costLabour: input.costLabour || 0, costParts, costTotal: (input.costTravel || 0) + (input.costLabour || 0) + costParts,
      parts, locationId: loc, attachmentIds: input.attachmentIds, issueIds: input.issueIds ?? [], clientSignoff: input.clientSignoff, gps: input.gps, offlineCapturedAt: input.offlineCapturedAt,
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.visits.push(v);
    this.log(projectId, actorId, "visit", `${VISIT_TYPE_LABEL[v.visitType]} visit logged — ${v.durationHrs} h, ${this.fmt(v.costTotal)} (pending check)`, v.findings, { model: "SiteVisit", id: v.id });
    this.emit(); return v;
  }

  /** Attach further photos to a visit. An edit to an already-checked record re-enters review (§4.13). */
  addVisitPhotos(actorId: string, visitId: string, input: { attachmentIds: string[] }): SiteVisit {
    const v = this.visits.find((x) => x.id === visitId); if (!v) throw new ApiError("Visit not found", "not_found");
    this.require(actorId, "visit.create", v.projectId);
    const ids = input.attachmentIds ?? [];
    if (!ids.length) throw new ApiError("Choose at least one photo", "invalid");
    if (ids.some((i) => !this.attachments.some((a) => a.id === i && a.projectId === v.projectId))) throw new ApiError("Photo is not on this project", "invalid");
    const fresh = ids.filter((i) => !v.attachmentIds.includes(i));
    if (!fresh.length) throw new ApiError("Those photos are already attached", "conflict");
    const at = this.now();
    v.attachmentIds = [...v.attachmentIds, ...fresh]; v.updatedAt = at; v.updatedBy = actorId;
    const reopened = v.reviewStatus === "checked";
    if (reopened) Object.assign(v, { reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: v.reviewVersion + 1, checkedBy: undefined, checkedAt: undefined, checkComment: undefined });
    this.log(v.projectId, actorId, "visit", `${fresh.length} photo${fresh.length === 1 ? "" : "s"} added to the ${VISIT_TYPE_LABEL[v.visitType]} visit${reopened ? " — record re-entered review" : ""}`, undefined, { model: "SiteVisit", id: v.id });
    this.emit(); return v;
  }

  slaHours(sev: IssueSeverity) { const t = this.thresholds.find((x) => x.key === `sla.${sev}`); if (!t) return { critical: 24, high: 72, medium: 168, low: 720 }[sev]; return t.unit === "d" ? Number(t.value) * 24 : Number(t.value); }
  issueSla(i: Issue) { const due = new Date(i.slaDueAt).getTime(); const open = !["closed", "wont_fix"].includes(i.status); const left = (due - Date.now()) / 3600000; return { dueAt: i.slaDueAt, breached: open && left < 0, hoursLeft: Math.round(left), open }; }
  listIssues(f: { projectId?: string; status?: IssueStatus; openOnly?: boolean } = {}) {
    return this.issues.filter((i) => (!f.projectId || i.projectId === f.projectId) && (!f.status || i.status === f.status) && (!f.openOnly || !["closed", "wont_fix"].includes(i.status)))
      .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  }
  raiseIssue(actorId: string, projectId: string, input: { category: IssueCategory; severity: IssueSeverity; title: string; description: string; assetId?: string; beforeAttachmentIds: string[]; isSnag?: boolean; source?: Issue["source"]; linkedVisitId?: string }): Issue {
    this.require(actorId, "issue.create", projectId);
    if (!input.title.trim()) throw new ApiError("Title is required", "invalid");
    if (input.source !== "telemetry_alert" && !input.beforeAttachmentIds.length) throw new ApiError("A 'before' photo is required to raise an issue", "invalid");
    if (input.assetId && !this.assets.some((a) => a.id === input.assetId && a.projectId === projectId)) throw new ApiError("Asset is not on this project", "invalid");
    const at = this.now();
    const i: Issue = { id: this.id("iss"), projectId, assetId: input.assetId, category: input.category, severity: input.severity, title: input.title.trim(), description: input.description.trim(), raisedBy: actorId, raisedAt: at,
      source: input.source ?? "manual", status: "open", costToResolve: 0, linkedVisitId: input.linkedVisitId, beforeAttachmentIds: input.beforeAttachmentIds, afterAttachmentIds: [], isSnag: !!input.isSnag,
      slaDueAt: new Date(new Date(at).getTime() + this.slaHours(input.severity) * 3600000).toISOString(), createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.issues.push(i);
    this.log(projectId, actorId, "issue", `Issue raised — ${i.severity.toUpperCase()} · ${i.title} (SLA ${this.slaHours(i.severity)} h)`, i.description, { model: "Issue", id: i.id });
    this.emit(); return i;
  }
  setIssueStatus(actorId: string, issueId: string, status: "in_progress" | "awaiting_parts", assigneeId?: string) {
    const i = this.issues.find((x) => x.id === issueId); if (!i) throw new ApiError("Issue not found", "not_found");
    this.require(actorId, "issue.update", i.projectId);
    if (["closed", "wont_fix", "resolved"].includes(i.status)) throw new ApiError(`Issue is ${i.status.replace("_", " ")}`, "conflict");
    i.status = status; if (assigneeId) i.assigneeId = assigneeId; i.updatedAt = this.now(); i.updatedBy = actorId;
    this.log(i.projectId, actorId, "issue", `${i.title} → ${status.replace("_", " ")}${assigneeId ? ` (assigned ${this.userName(assigneeId)})` : ""}`, undefined, { model: "Issue", id: i.id });
    this.emit();
  }
  /** Resolution re-enters review: an 'after' photo is mandatory; the checker closes it. */
  resolveIssue(actorId: string, issueId: string, input: { rootCause: string; resolution: string; afterAttachmentIds: string[]; costToResolve?: number; visitId?: string }) {
    const i = this.issues.find((x) => x.id === issueId); if (!i) throw new ApiError("Issue not found", "not_found");
    this.require(actorId, "issue.update", i.projectId);
    if (["closed", "wont_fix", "resolved"].includes(i.status)) throw new ApiError(`Issue is already ${i.status.replace("_", " ")}`, "conflict");
    if (!input.resolution.trim()) throw new ApiError("Resolution is required", "invalid");
    if (!input.afterAttachmentIds.length) throw new ApiError("An 'after' photo is required to resolve an issue", "invalid");
    const at = this.now();
    Object.assign(i, { status: "resolved", rootCause: input.rootCause.trim(), resolution: input.resolution.trim(), afterAttachmentIds: input.afterAttachmentIds, costToResolve: input.costToResolve || 0, linkedVisitId: input.visitId ?? i.linkedVisitId,
      resolvedBy: actorId, resolvedAt: at, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: i.reviewVersion + 1, checkedBy: undefined, checkedAt: undefined, checkComment: undefined });
    this.log(i.projectId, actorId, "issue", `Resolved (pending check) — ${i.title}`, `${input.rootCause.trim()} → ${input.resolution.trim()}`, { model: "Issue", id: i.id });
    this.emit();
  }

  listCommissioning(projectId: string) { return this.commissionings.filter((c) => c.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date)); }
  createCommissioning(actorId: string, projectId: string, input: { date: string; result: CommissioningRecord["result"]; notes: string; items: { key: string; measuredValue?: string; pass: boolean; comment?: string; attachmentId?: string }[]; meter: MeterIntegrity; clientWitness?: CommissioningRecord["clientWitness"]; attachmentIds: string[]; stationId?: string }): CommissioningRecord {
    this.require(actorId, "commissioning.create", projectId);
    const missing = COMMISSIONING_TEMPLATE.filter((t) => !input.items.some((i) => i.key === t.key)); if (missing.length) throw new ApiError(`Checklist incomplete: ${missing.map((m) => m.label).join(", ")}`, "invalid");
    const fails = input.items.filter((i) => !i.pass); if (input.result === "pass" && fails.length) throw new ApiError(`Result cannot be "pass" with ${fails.length} failed item${fails.length > 1 ? "s" : ""}`, "invalid");
    if (!input.attachmentIds.length) throw new ApiError("Commissioning photos are required", "invalid");
    const at = this.now();
    const c: CommissioningRecord = { id: this.id("com"), projectId, stationId: input.stationId, date: input.date, engineerId: actorId, result: input.result, notes: input.notes.trim(),
      items: COMMISSIONING_TEMPLATE.map((t) => { const i = input.items.find((x) => x.key === t.key)!; return { key: t.key, label: t.label, unit: t.unit, measuredValue: i.measuredValue, pass: i.pass, comment: i.comment, attachmentId: i.attachmentId }; }),
      meter: input.meter, clientWitness: input.clientWitness, attachmentIds: input.attachmentIds, createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.commissionings.push(c);
    this.log(projectId, actorId, "commissioning", `Commissioning record submitted — ${c.result} (${c.items.filter((i) => i.pass).length}/${c.items.length} pass) · pending check`, c.notes, { model: "CommissioningRecord", id: c.id });
    this.emit(); return c;
  }
  /** A checked commissioning record IS the gate-5 evidence: it emits the matching checked documents. */
  private emitCommissioningEvidence(c: CommissioningRecord, checkerId: string) {
    const at = this.now(); const meterOk = Object.values(c.meter).every(Boolean);
    const mk = (docType: DocType, title: string) => {
      if (this.documents.some((d) => d.projectId === c.projectId && d.docType === docType && d.reviewStatus === "checked")) return;
      const prior = this.documents.filter((d) => d.projectId === c.projectId && d.docType === docType).length;
      this.documents.push({ id: this.id("doc"), projectId: c.projectId, docType, title, status: "approved", issuedAt: c.date, issuer: this.userName(c.engineerId), version: prior + 1, fileName: `${docType}-${c.date}.pdf`, sizeBytes: 240_000,
        createdAt: at, createdBy: c.engineerId, updatedAt: at, updatedBy: checkerId, reviewStatus: "checked", submittedBy: c.engineerId, submittedAt: c.submittedAt, checkedBy: checkerId, checkedAt: at, checkComment: "Generated from checked commissioning record", reviewVersion: 1 });
    };
    mk("commissioning_record", `Commissioning record ${c.date} — ${c.result}`);
    if (meterOk) mk("meter_integrity", `Meter data-integrity checks ${c.date} — all pass`);
    if (c.clientWitness?.signatureAttachmentId) mk("client_witness", `Client witness — ${c.clientWitness.name}`);
    if (c.attachmentIds.length) mk("commissioning_photos", `Commissioning photos (${c.attachmentIds.length})`);
    this.log(c.projectId, checkerId, "commissioning", `Commissioning checked — gate-5 evidence generated${meterOk ? "" : " (meter integrity NOT satisfied)"}`, undefined, { model: "CommissioningRecord", id: c.id });
  }

  listHse(projectId?: string) { return this.hseIncidents.filter((h) => !projectId || h.projectId === projectId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)); }
  reportHse(actorId: string, projectId: string, input: { type: HseType; severity: IssueSeverity; description: string; actions: string; occurredAt: string; visitId?: string; attachmentIds?: string[] }): HseIncident {
    this.require(actorId, "hse.create", projectId);
    if (!input.description.trim()) throw new ApiError("Description is required", "invalid");
    const at = this.now();
    const h: HseIncident = { id: this.id("hse"), projectId, visitId: input.visitId, type: input.type, severity: input.severity, description: input.description.trim(), actions: input.actions.trim(), occurredAt: input.occurredAt, reportedBy: actorId,
      attachmentIds: input.attachmentIds ?? [], createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.hseIncidents.push(h);
    this.log(projectId, actorId, "hse", `HSE ${HSE_TYPE_LABEL[h.type]} reported — ${h.severity} (pending check)`, h.description, { model: "HseIncident", id: h.id });
    this.emit(); return h;
  }

  listWarranty(projectId?: string) { return this.warrantyClaims.filter((w) => !projectId || w.projectId === projectId).sort((a, b) => b.claimedAt.localeCompare(a.claimedAt)); }
  raiseWarrantyClaim(actorId: string, projectId: string, input: { assetId: string; issueId?: string; notes: string }): WarrantyClaim {
    this.require(actorId, "warranty.create", projectId);
    const a = this.assets.find((x) => x.id === input.assetId && x.projectId === projectId); if (!a) throw new ApiError("Asset is not on this project", "invalid");
    if (a.warrantyEnd && a.warrantyEnd < this.now().slice(0, 10)) throw new ApiError(`Warranty on ${a.serial} expired ${a.warrantyEnd}`, "invalid");
    const at = this.now();
    const w: WarrantyClaim = { id: this.id("war"), projectId, assetId: a.id, issueId: input.issueId, vendorId: a.vendorId, claimedAt: at, status: "raised", costRecovered: 0, notes: input.notes.trim(),
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1 };
    this.warrantyClaims.push(w); if (input.issueId) { const i = this.issues.find((x) => x.id === input.issueId); if (i) i.warrantyClaimId = w.id; }
    this.log(projectId, actorId, "warranty", `Warranty claim raised — ${a.make} ${a.model} ${a.serial} → ${this.vendorName(a.vendorId)}`, w.notes, { model: "WarrantyClaim", id: w.id });
    this.emit(); return w;
  }
  updateWarrantyClaim(actorId: string, claimId: string, input: { status: WarrantyStatus; outcome?: string; costRecovered?: number }) {
    const w = this.warrantyClaims.find((x) => x.id === claimId); if (!w) throw new ApiError("Claim not found", "not_found");
    this.require(actorId, "warranty.create", w.projectId);
    const at = this.now();
    Object.assign(w, { status: input.status, outcome: input.outcome?.trim() || w.outcome, costRecovered: input.costRecovered ?? w.costRecovered, updatedAt: at, updatedBy: actorId,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: w.reviewVersion + 1, checkedBy: undefined, checkedAt: undefined, checkComment: undefined });
    this.log(w.projectId, actorId, "warranty", `Warranty claim → ${input.status}${input.costRecovered ? ` · ${this.fmt(input.costRecovered)} recovered` : ""} (pending check)`, input.outcome, { model: "WarrantyClaim", id: w.id });
    this.emit();
  }
}

export const api = new MockApi();
