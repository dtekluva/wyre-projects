// In-memory API for the frontend-first phases. Same surface the Django backend will implement.
// Enforces: RBAC (§2), stage gates (§3), actor capture (§4), maker-checker + segregation of duties (§4.13, §5),
// money & stock rules (§0, §4.4, §4.10, §4.15, §11).
import { can as canFn, rolesOn as rolesOnFn, type Permission } from "./rbac";
import { STAGES } from "./gates";
import * as seed from "./mock/data";
import * as seed2 from "./mock/data2";
import {
  DOC_TYPE_LABEL, COST_CATEGORY_LABEL, MOVEMENT_LABEL,
  type User, type Project, type ProjectMembership, type Document, type Attachment, type ChronologyEvent, type Approval, type Threshold,
  type Stage, type GateStatus, type DocType, type RoleCode, type EventType, type ReviewStatus,
  type Vendor, type InventoryItem, type StockLocation, type CostItem, type PurchaseOrder, type PurchaseItem, type GoodsReceipt, type Asset,
  type StockMovement, type StockBalance, type Actual, type ChangeOrder, type Retention, type QbBill, type CostCategory, type ProjectMoney, type AssetType,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, public code: "forbidden" | "invalid" | "not_found" | "conflict") { super(message); }
}

export type ReviewKind = "document" | "attachment" | "goods_receipt" | "stock_movement" | "cost_item";
export interface ReviewItem {
  kind: ReviewKind; id: string; projectId?: string; title: string; subtitle: string; amount?: number;
  submittedBy: string; submittedAt: string; ageDays: number; overdue: boolean;
  item: Document | Attachment | GoodsReceipt | StockMovement | CostItem;
}

type Listener = () => void;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const round = (n: number) => Math.round(n * 100) / 100;
const GLOBAL: RoleCode[] = ["admin", "director", "finance", "store_keeper", "auditor"];
const CATS: CostCategory[] = ["equipment", "civil", "labour", "logistics", "permits", "contingency", "om"];

export class MockApi {
  users: User[] = clone(seed.users);
  projects: Project[] = clone(seed.projects);
  memberships: ProjectMembership[] = clone(seed.memberships);
  documents: Document[] = clone(seed.documents);
  attachments: Attachment[] = clone(seed.attachments);
  events: ChronologyEvent[] = clone(seed.events);
  approvals: Approval[] = clone(seed.approvals);
  thresholds: Threshold[] = clone(seed.thresholds);
  // phase 2
  vendors: Vendor[] = clone(seed2.vendors);
  locations: StockLocation[] = clone(seed2.locations);
  items: InventoryItem[] = clone(seed2.items);
  costItems: CostItem[] = clone(seed2.costItems);
  purchaseOrders: PurchaseOrder[] = clone(seed2.purchaseOrders);
  goodsReceipts: GoodsReceipt[] = clone(seed2.goodsReceipts);
  assets: Asset[] = clone(seed2.assets);
  movements: StockMovement[] = clone(seed2.movements);
  actuals: Actual[] = clone(seed2.actuals);
  changeOrders: ChangeOrder[] = clone(seed2.changeOrders);
  retentions: Retention[] = clone(seed2.retentions);
  qbBills: QbBill[] = clone(seed2.qbBills);

  private listeners = new Set<Listener>();
  private seq = 1000;
  private static KEY = "wyre.tracker.state.v2";
  private static PERSISTED = ["projects","memberships","documents","attachments","events","approvals","thresholds",
    "vendors","locations","items","costItems","purchaseOrders","goodsReceipts","assets","movements","actuals","changeOrders","retentions","qbBills","seq"] as const;

  constructor() { this.load(); }
  private load() {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(MockApi.KEY) : null;
      if (!raw) return;
      const st = JSON.parse(raw);
      for (const k of MockApi.PERSISTED) if (st[k] !== undefined) (this as unknown as Record<string, unknown>)[k] = st[k];
    } catch { /* ignore corrupt state */ }
  }
  private persist() {
    try {
      if (typeof localStorage === "undefined") return;
      const st: Record<string, unknown> = {};
      for (const k of MockApi.PERSISTED) st[k] = (this as unknown as Record<string, unknown>)[k];
      localStorage.setItem(MockApi.KEY, JSON.stringify(st));
    } catch { /* quota / private mode */ }
  }
  /** Restore the seed data set. */
  reset() {
    try { localStorage.removeItem(MockApi.KEY); } catch { /* ignore */ }
    Object.assign(this, { projects: clone(seed.projects), memberships: clone(seed.memberships), documents: clone(seed.documents), attachments: clone(seed.attachments),
      events: clone(seed.events), approvals: clone(seed.approvals), thresholds: clone(seed.thresholds),
      vendors: clone(seed2.vendors), locations: clone(seed2.locations), items: clone(seed2.items), costItems: clone(seed2.costItems), purchaseOrders: clone(seed2.purchaseOrders),
      goodsReceipts: clone(seed2.goodsReceipts), assets: clone(seed2.assets), movements: clone(seed2.movements), actuals: clone(seed2.actuals),
      changeOrders: clone(seed2.changeOrders), retentions: clone(seed2.retentions), qbBills: clone(seed2.qbBills), seq: 1000 });
    this.emit();
  }
  isDirty() { try { return typeof localStorage !== "undefined" && localStorage.getItem(MockApi.KEY) !== null; } catch { return false; } }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.persist(); this.listeners.forEach((fn) => fn()); }
  private id = (p: string) => `${p}${++this.seq}`;
  private now = () => new Date().toISOString();
  thresholdNum(key: string, fallback: number) { const t = this.thresholds.find((x) => x.key === key); return t ? Number(t.value) : fallback; }

  // ---------- users & access ----------
  getUsers() { return this.users; }
  getUser(id: string) { const u = this.users.find((x) => x.id === id); if (!u) throw new ApiError("User not found", "not_found"); return u; }
  userName(id?: string) { return id ? this.users.find((x) => x.id === id)?.name ?? id : "—"; }
  rolesOn(userId: string, projectId?: string): RoleCode[] { return rolesOnFn(this.getUser(userId), projectId, this.memberships); }
  /** projectId undefined → only global roles count (no per-project role leaks into global actions) */
  can(userId: string, perm: Permission, projectId?: string) {
    const u = this.getUser(userId);
    if (projectId) return canFn(u, perm, projectId, this.memberships);
    return canFn(u, perm, "__global__", this.memberships) || u.roles.filter((r) => !GLOBAL.includes(r)).length === 0 && canFn(u, perm, undefined, this.memberships);
  }
  /** can the user do this on ANY project they belong to (for nav / listing) */
  canAnywhere(userId: string, perm: Permission) { return this.can(userId, perm) || this.projects.some((p) => this.can(userId, perm, p.id)); }
  private require(userId: string, perm: Permission, projectId?: string) {
    if (!this.can(userId, perm, projectId)) throw new ApiError(`Your role does not allow "${perm}" here`, "forbidden");
  }
  private hasGlobal(userId: string) { return this.getUser(userId).roles.some((r) => GLOBAL.includes(r)); }

  // ---------- lookups ----------
  vendorName(id?: string) { return id ? this.vendors.find((v) => v.id === id)?.name ?? id : "—"; }
  item(id: string) { const it = this.items.find((i) => i.id === id); if (!it) throw new ApiError("Item not found", "not_found"); return it; }
  itemName(id: string) { return this.items.find((i) => i.id === id)?.name ?? id; }
  locationName(id?: string) { return id ? this.locations.find((l) => l.id === id)?.name ?? id : "—"; }
  projectCode(id?: string) { return id ? this.projects.find((p) => p.id === id)?.code ?? id : "—"; }

  // ---------- projects ----------
  listProjects(userId: string): Project[] {
    if (this.hasGlobal(userId)) return this.projects;
    const mine = new Set(this.memberships.filter((m) => m.userId === userId && !m.revokedAt).map((m) => m.projectId));
    return this.projects.filter((p) => mine.has(p.id));
  }
  private raw(id: string) { const p = this.projects.find((x) => x.id === id); if (!p) throw new ApiError("Project not found", "not_found"); return p; }
  getProject(userId: string, id: string): Project {
    const p = this.raw(id);
    if (!this.listProjects(userId).some((x) => x.id === id)) throw new ApiError("You are not a member of this project", "forbidden");
    return p;
  }
  listMemberships(projectId: string) { return this.memberships.filter((m) => m.projectId === projectId && !m.revokedAt); }

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

  addDocument(actorId: string, projectId: string, input: { docType: DocType; title: string; fileName?: string; sizeBytes?: number; issuer?: string; expiresAt?: string }): Document {
    this.require(actorId, "document.create", projectId);
    const at = this.now();
    const prior = this.documents.filter((d) => d.projectId === projectId && d.docType === input.docType).length;
    const doc: Document = {
      id: this.id("doc"), projectId, docType: input.docType, title: input.title, status: "submitted",
      issuedAt: at, expiresAt: input.expiresAt, issuer: input.issuer, version: prior + 1,
      fileName: input.fileName ?? input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".pdf", sizeBytes: input.sizeBytes ?? 320_000,
      createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1,
    };
    this.documents.push(doc);
    this.log(projectId, actorId, "document_added", `${DOC_TYPE_LABEL[doc.docType]} — "${doc.title}" submitted (pending check)`, undefined, { model: "Document", id: doc.id });
    this.emit(); return doc;
  }

  addAttachment(actorId: string, projectId: string, input: { fileName: string; caption?: string; kind?: "image" | "document"; linkedTo?: Attachment["linkedTo"] }): Attachment {
    this.require(actorId, "attachment.create", projectId);
    const at = this.now();
    const att: Attachment = {
      id: this.id("att"), projectId, fileName: input.fileName, mime: input.kind === "document" ? "application/pdf" : "image/jpeg",
      sizeBytes: 1_400_000, kind: input.kind ?? "image", capturedAt: at,
      sha256: Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
      uploadedBy: actorId, uploadedAt: at, linkedTo: input.linkedTo, caption: input.caption,
      reviewStatus: "pending", submittedBy: actorId, submittedAt: at, reviewVersion: 1,
    };
    this.attachments.push(att);
    this.log(projectId, actorId, "attachment_added", `Uploaded ${att.fileName}${att.caption ? " — " + att.caption : ""} (pending check)`, undefined, { model: "Attachment", id: att.id });
    this.emit(); return att;
  }

  /** Evidence attached to an approval-bearing object (e.g. a write-off): the Approval is its four-eyes check (§4.13), so it is not queued separately. */
  addEvidence(actorId: string, input: { fileName: string; caption?: string; projectId?: string; linkedTo?: Attachment["linkedTo"] }): Attachment {
    this.require(actorId, "attachment.create", input.projectId);
    const at = this.now();
    const att: Attachment = { id: this.id("att"), projectId: input.projectId ?? "", fileName: input.fileName, mime: "image/jpeg", sizeBytes: 1_200_000, kind: "image", capturedAt: at,
      sha256: Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""), uploadedBy: actorId, uploadedAt: at, linkedTo: input.linkedTo, caption: input.caption,
      reviewStatus: "checked", submittedBy: actorId, submittedAt: at, reviewVersion: 1, checkComment: "Verified through the linked approval" };
    this.attachments.push(att); return att;
  }

  // ---------- maker-checker ----------
  private checkPerm(kind: ReviewKind): Permission {
    return ({ document: "document.check", attachment: "attachment.check", goods_receipt: "goods_receipt.check", stock_movement: "inventory.check", cost_item: "cost.check" } as const)[kind];
  }
  private findReviewable(kind: ReviewKind, id: string) {
    const list = ({ document: this.documents, attachment: this.attachments, goods_receipt: this.goodsReceipts, stock_movement: this.movements, cost_item: this.costItems } as Record<ReviewKind, { id: string }[]>)[kind];
    const it = list.find((x) => x.id === id); if (!it) throw new ApiError("Item not found", "not_found");
    return it as Document | Attachment | GoodsReceipt | StockMovement | CostItem;
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
    this.movements.filter((m) => m.movementType === "issue" || m.movementType === "return").forEach((m) =>
      push("stock_movement", m, m.projectId, `${MOVEMENT_LABEL[m.movementType]} · ${this.itemName(m.itemId)} × ${m.qty}`, m.sourceRef?.label ?? "", m.totalCost));
    this.costItems.forEach((c) => push("cost_item", c, c.projectId, c.label, `Budget line · ${COST_CATEGORY_LABEL[c.category]}`, c.plannedAmount));
    return items.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  }
  pendingChecks(projectId: string) {
    return this.documents.filter((d) => d.projectId === projectId && d.reviewStatus === "pending").length
      + this.attachments.filter((a) => a.projectId === projectId && a.reviewStatus === "pending").length
      + this.goodsReceipts.filter((g) => g.projectId === projectId && g.reviewStatus === "pending").length
      + this.movements.filter((m) => m.projectId === projectId && m.reviewStatus === "pending" && m.movementType !== "write_off").length
      + this.costItems.filter((c) => c.projectId === projectId && c.reviewStatus === "pending").length;
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
    }
    const model = { document: "Document", attachment: "Attachment", goods_receipt: "GoodsReceipt", stock_movement: "StockMovement", cost_item: "CostItem" }[kind];
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
  }

  // ---------- memberships ----------
  grantMembership(actorId: string, projectId: string, userId: string, role: RoleCode) {
    this.require(actorId, "membership.manage", projectId);
    if (this.memberships.some((m) => m.projectId === projectId && m.userId === userId && m.role === role && !m.revokedAt)) throw new ApiError("Already a member with that role", "conflict");
    this.memberships.push({ id: this.id("m"), projectId, userId, role, grantedBy: actorId, grantedAt: this.now() });
    this.log(projectId, actorId, "role_granted", `${this.userName(userId)} granted ${role}`);
    this.emit();
  }
  revokeMembership(actorId: string, membershipId: string) {
    const m = this.memberships.find((x) => x.id === membershipId); if (!m) throw new ApiError("Not found", "not_found");
    this.require(actorId, "membership.manage", m.projectId);
    m.revokedAt = this.now();
    this.log(m.projectId, actorId, "role_revoked", `${this.userName(m.userId)} revoked ${m.role}`);
    this.emit();
  }
  listThresholds() { return this.thresholds; }

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
}

export const api = new MockApi();
