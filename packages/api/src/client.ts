// In-memory API for Phase 1 (frontend-first). Same surface the Django backend will implement.
// Enforces: RBAC (§2), stage gates (§3), actor capture (§4), maker-checker + segregation of duties (§4.13, §5).
import { can as canFn, rolesOn as rolesOnFn, type Permission } from "./rbac";
import { STAGES } from "./gates";
import * as seed from "./mock/data";
import {
  DOC_TYPE_LABEL, type User, type Project, type ProjectMembership, type Document, type Attachment, type ChronologyEvent,
  type Approval, type Threshold, type Stage, type GateStatus, type DocType, type RoleCode, type EventType, type ReviewStatus,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, public code: "forbidden" | "invalid" | "not_found" | "conflict") { super(message); }
}

export interface ReviewItem {
  kind: "document" | "attachment"; id: string; projectId: string; title: string; subtitle: string;
  submittedBy: string; submittedAt: string; ageDays: number; overdue: boolean; item: Document | Attachment;
}

type Listener = () => void;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export class MockApi {
  users: User[] = clone(seed.users);
  projects: Project[] = clone(seed.projects);
  memberships: ProjectMembership[] = clone(seed.memberships);
  documents: Document[] = clone(seed.documents);
  attachments: Attachment[] = clone(seed.attachments);
  events: ChronologyEvent[] = clone(seed.events);
  approvals: Approval[] = clone(seed.approvals);
  thresholds: Threshold[] = clone(seed.thresholds);

  private listeners = new Set<Listener>();
  private seq = 1000;
  private static KEY = "wyre.tracker.state.v1";

  constructor() { this.load(); }
  /** Phase 1 only: the mock store survives page reloads via localStorage. The Django backend replaces this. */
  private load() {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(MockApi.KEY) : null;
      if (!raw) return;
      const st = JSON.parse(raw);
      Object.assign(this, { projects: st.projects, memberships: st.memberships, documents: st.documents, attachments: st.attachments,
        events: st.events, approvals: st.approvals, thresholds: st.thresholds, seq: st.seq ?? 1000 });
    } catch { /* ignore corrupt state */ }
  }
  private persist() {
    try {
      if (typeof localStorage === "undefined") return;
      const { projects, memberships, documents, attachments, events, approvals, thresholds, seq } = this;
      localStorage.setItem(MockApi.KEY, JSON.stringify({ projects, memberships, documents, attachments, events, approvals, thresholds, seq }));
    } catch { /* quota / private mode */ }
  }
  /** Restore the seed data set. */
  reset() {
    try { localStorage.removeItem(MockApi.KEY); } catch { /* ignore */ }
    Object.assign(this, { projects: clone(seed.projects), memberships: clone(seed.memberships), documents: clone(seed.documents),
      attachments: clone(seed.attachments), events: clone(seed.events), approvals: clone(seed.approvals), thresholds: clone(seed.thresholds), seq: 1000 });
    this.emit();
  }
  isDirty() { try { return typeof localStorage !== "undefined" && localStorage.getItem(MockApi.KEY) !== null; } catch { return false; } }
  private id = (p: string) => `${p}${++this.seq}`;
  private now = () => new Date().toISOString();

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.persist(); this.listeners.forEach((fn) => fn()); }

  // ---------- users & access ----------
  getUsers() { return this.users; }
  getUser(id: string) { const u = this.users.find((x) => x.id === id); if (!u) throw new ApiError("User not found", "not_found"); return u; }
  userName(id?: string) { return id ? this.users.find((x) => x.id === id)?.name ?? id : "—"; }
  rolesOn(userId: string, projectId?: string): RoleCode[] { return rolesOnFn(this.getUser(userId), projectId, this.memberships); }
  can(userId: string, perm: Permission, projectId?: string) { return canFn(this.getUser(userId), perm, projectId, this.memberships); }
  private require(userId: string, perm: Permission, projectId?: string) {
    if (!this.can(userId, perm, projectId)) throw new ApiError(`Your role does not allow "${perm}" here`, "forbidden");
  }
  private hasGlobal(userId: string) { return this.getUser(userId).roles.some((r) => ["admin", "director", "finance", "store_keeper", "auditor"].includes(r)); }

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
  private log(projectId: string, actorId: string, eventType: EventType, summary: string, detail?: string, ref?: ChronologyEvent["ref"]) {
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

  // ---------- maker-checker ----------
  reviewQueue(userId: string): ReviewItem[] {
    const nowMs = Date.now();
    const items: ReviewItem[] = [];
    const escalation = Number(this.thresholds.find((t) => t.key === "check.escalation_days")?.value ?? 3);
    const push = (kind: ReviewItem["kind"], it: Document | Attachment, title: string, subtitle: string) => {
      if (it.reviewStatus !== "pending") return;
      if (it.submittedBy === userId) return; // segregation of duties
      if (!this.can(userId, kind === "document" ? "document.check" : "attachment.check", it.projectId)) return;
      const ageDays = Math.floor((nowMs - new Date(it.submittedAt).getTime()) / 86400000);
      items.push({ kind, id: it.id, projectId: it.projectId, title, subtitle, submittedBy: it.submittedBy, submittedAt: it.submittedAt, ageDays, overdue: ageDays > escalation, item: it });
    };
    this.documents.forEach((d) => push("document", d, d.title, DOC_TYPE_LABEL[d.docType]));
    this.attachments.forEach((a) => push("attachment", a, a.caption ?? a.fileName, a.linkedTo ? `${a.linkedTo.model}: ${a.linkedTo.label}` : a.kind === "image" ? "Photo" : "File"));
    return items.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  }

  check(kind: "document" | "attachment", id: string, actorId: string, decision: Exclude<ReviewStatus, "pending">, comment?: string) {
    const item = kind === "document" ? this.documents.find((d) => d.id === id) : this.attachments.find((a) => a.id === id);
    if (!item) throw new ApiError("Item not found", "not_found");
    if (item.reviewStatus !== "pending") throw new ApiError("Already reviewed", "conflict");
    if (item.submittedBy === actorId) throw new ApiError("You cannot check your own submission (segregation of duties)", "forbidden");
    this.require(actorId, kind === "document" ? "document.check" : "attachment.check", item.projectId);
    if (decision === "rejected" && !comment?.trim()) throw new ApiError("A comment is required to reject", "invalid");
    item.reviewStatus = decision; item.checkedBy = actorId; item.checkedAt = this.now(); item.checkComment = comment?.trim() || undefined;
    if (kind === "document") { const d = item as Document; d.status = decision === "checked" ? "approved" : "submitted"; d.updatedAt = this.now(); d.updatedBy = actorId; }
    const label = kind === "document" ? (item as Document).title : (item as Attachment).caption ?? (item as Attachment).fileName;
    this.log(item.projectId, actorId, decision === "checked" ? "check_passed" : "check_rejected",
      `${decision === "checked" ? "Checked" : "Rejected"}: ${label}`, comment?.trim() || undefined, { model: kind === "document" ? "Document" : "Attachment", id });
    this.emit();
  }

  pendingChecks(projectId: string) {
    return this.documents.filter((d) => d.projectId === projectId && d.reviewStatus === "pending").length
         + this.attachments.filter((a) => a.projectId === projectId && a.reviewStatus === "pending").length;
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
  listApprovals(f: { projectId?: string; status?: Approval["status"] } = {}) {
    return this.approvals.filter((a) => (!f.projectId || a.projectId === f.projectId) && (!f.status || a.status === f.status))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }
  /** approvals this user can act on right now */
  approvalsFor(userId: string) {
    return this.listApprovals({ status: "pending" }).filter((a) => this.canDecide(userId, a).ok);
  }
  canDecide(userId: string, a: Approval): { ok: boolean; reason?: string; role?: RoleCode } {
    if (a.status !== "pending") return { ok: false, reason: "Already decided" };
    if (a.requestedBy === userId) return { ok: false, reason: "You raised this — segregation of duties" };
    const perm: Permission = a.kind === "gate" ? "gate.approve" : "po.approve";
    if (!this.can(userId, perm, a.projectId)) return { ok: false, reason: "Your role cannot approve this" };
    const mine = this.rolesOn(userId, a.projectId);
    const decided = new Set(a.decisions.map((d) => d.role));
    const role = a.requiredRoles.find((r) => mine.includes(r) && !decided.has(r));
    if (!role) return { ok: false, reason: decided.size ? "Your role has already decided" : "Not one of the required approver roles" };
    return { ok: true, role };
  }
  decide(approvalId: string, actorId: string, decision: "approved" | "rejected", comment?: string) {
    const a = this.approvals.find((x) => x.id === approvalId); if (!a) throw new ApiError("Approval not found", "not_found");
    const c = this.canDecide(actorId, a); if (!c.ok) throw new ApiError(c.reason!, "forbidden");
    if (decision === "rejected" && !comment?.trim()) throw new ApiError("A comment is required to reject", "invalid");
    a.decisions.push({ approverId: actorId, role: c.role!, decision, at: this.now(), comment: comment?.trim() || undefined });
    if (decision === "rejected") {
      a.status = "rejected";
      this.log(a.projectId, actorId, "approval_decided", `Rejected: ${a.title}`, comment?.trim(), { model: "Approval", id: a.id });
    } else {
      const done = a.requiredRoles.every((r) => a.decisions.some((d) => d.role === r && d.decision === "approved"));
      if (done) {
        a.status = "approved";
        if (a.kind === "gate" && a.targetStage !== undefined) {
          const p = this.raw(a.projectId); const from = p.stage; p.stage = a.targetStage; p.stageActual[a.targetStage] = this.now();
          this.log(a.projectId, actorId, "stage_change", `Stage ${from} → ${a.targetStage} · now in ${STAGES[a.targetStage].name}`, undefined, { model: "Approval", id: a.id });
        } else {
          this.log(a.projectId, actorId, a.kind === "po" ? "po_approved" : "approval_decided", `Approved: ${a.title}`, comment?.trim(), { model: "Approval", id: a.id });
        }
      } else {
        const waiting = a.requiredRoles.filter((r) => !a.decisions.some((d) => d.role === r));
        this.log(a.projectId, actorId, "approval_decided", `${a.title} — approved by ${c.role}; awaiting ${waiting.join(", ")}`, comment?.trim(), { model: "Approval", id: a.id });
      }
    }
    this.emit();
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
}

export const api = new MockApi();
