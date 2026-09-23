import type { RoleCode, User, ProjectMembership } from "./types";

export type Permission =
  | "project.create" | "project.read" | "project.update"
  | "gate.request" | "gate.approve"
  | "chronology.read"
  | "document.create" | "document.read" | "document.update" | "document.check"
  | "attachment.create" | "attachment.read" | "attachment.check"
  | "po.create" | "po.read" | "po.approve"
  | "approval.read"
  | "membership.manage" | "users.manage"
  | "thresholds.read" | "thresholds.manage"
  | "money.read" | "money.write"
  | "inventory.read" | "inventory.write" | "catalogue.manage" | "inventory.request" | "inventory.check" | "writeoff.approve"
  | "goods_receipt.create" | "goods_receipt.check"
  | "cost.create" | "cost.check" | "change_order.create" | "retention.request"
  | "asset.read" | "asset.write" | "recon.read" | "recon.write"
  | "visit.create" | "visit.check" | "issue.create" | "issue.update" | "issue.check"
  | "commissioning.create" | "commissioning.check" | "hse.create" | "hse.check" | "warranty.create" | "warranty.check"
  | "stockcount.create" | "stockcount.approve"
  | "dashboard.read"
  | "billing.manage" | "contract.manage" | "record.void";

const R = (...p: Permission[]) => p;

/** Spec §2.2 permission matrix (Phase 1 subset + a few phase-2 reads for display) */
export const MATRIX: Record<RoleCode, Permission[]> = {
  // Approver and administrator — the old `admin` folded in here. Approves and checks; does not raise POs or
  // cost items, so a director cannot manufacture the thing they then approve.
  director: R("project.create","project.read","project.update","gate.request","gate.approve","chronology.read",
              "document.create","document.read","document.update","document.check",
              "attachment.create","attachment.read","po.read","po.approve","writeoff.approve",
              "stockcount.approve","commissioning.check","approval.read","membership.manage","users.manage",
              "thresholds.read","thresholds.manage","money.read","inventory.read","asset.read",
              "recon.read","dashboard.read","catalogue.manage","billing.manage","contract.manage","record.void"),
  // Checker and project owner — the old pm and lead_engineer merged. Holds gate.request AND gate.approve,
  // which is safe because segregation of duties is enforced per person, not per role: you cannot approve
  // your own request or check your own submission.
  techlead: R("project.create","project.read","project.update","gate.request","gate.approve",
              "chronology.read","document.create","document.read","document.update","document.check",
              "attachment.create","attachment.read","attachment.check","po.create","po.read",
              "approval.read","membership.manage","thresholds.read","money.read",
              "cost.create","change_order.create","goods_receipt.create","goods_receipt.check",
              "inventory.read","inventory.request","inventory.check","asset.read","asset.write",
              "visit.create","visit.check","issue.create","issue.update","issue.check",
              "commissioning.create","commissioning.check","hse.create","hse.check",
              "warranty.create","warranty.check","dashboard.read","catalogue.manage","contract.manage","billing.manage","record.void"),
  // Field capture — the old field_tech, renamed. Creates, never checks.
  tech: R("project.read","chronology.read","document.create","document.read",
          "attachment.create","attachment.read","goods_receipt.create",
          "inventory.read","inventory.request","asset.read","asset.write",
          "visit.create","issue.create","issue.update","hse.create","dashboard.read"),
  finance: R("stockcount.approve","warranty.check","project.read","project.update","gate.request","gate.approve","chronology.read","document.read","document.create","attachment.read","attachment.create","po.read","po.approve","writeoff.approve",
             "approval.read","thresholds.read","money.read","money.write","cost.create","cost.check","goods_receipt.check","inventory.read",
             "inventory.check","retention.request","asset.read","recon.read","recon.write","dashboard.read","billing.manage","contract.manage"),
  store_keeper: R("stockcount.create","project.read","chronology.read","attachment.create","attachment.read","po.read","goods_receipt.create",
                  "inventory.read","inventory.write","asset.read","asset.write","thresholds.read","dashboard.read","catalogue.manage"),
  auditor: R("project.read","chronology.read","document.read","attachment.read","po.read","approval.read","thresholds.read",
             "money.read","inventory.read","asset.read","recon.read","dashboard.read"),
};

/**
 * Roles a user holds on a project. Wyre runs as a single in-house team, so roles apply company-wide: a Tech
 * Lead is a Tech Lead on every project, not only the ones they are assigned to. `ProjectMembership` is
 * an *assignment* record — who is responsible — rather than a permission gate.
 *
 * What still constrains people: the role → permission matrix (§2.2), segregation of duties (nobody checks their
 * own submission or approves their own request), and actor capture on every change.
 */
export function rolesOn(user: User, _projectId: string | undefined, _memberships: ProjectMembership[]): RoleCode[] {
  return user.roles;
}

export function can(user: User, perm: Permission, _projectId: string | undefined, _memberships: ProjectMembership[]): boolean {
  return user.roles.some((r) => MATRIX[r].includes(perm));
}

/** Who may check whose input — spec §4.13 */
/** Roles trusted to sign off their own work (user decision, 2026-09-20) — mirrors rbac.SELF_REVIEW_ROLES.
 *  Everyone else still needs a second pair of eyes. Who submitted and who checked is always recorded,
 *  so a self-review shows up in the audit trail rather than being hidden by it. */
export const SELF_REVIEW_ROLES: RoleCode[] = ["finance", "director", "store_keeper"];
export function maySelfReview(user: User): boolean {
  return user.roles.some((r) => SELF_REVIEW_ROLES.includes(r));
}

export const CHECKER_ROLES: Record<"document" | "attachment" | "goods_receipt" | "stock_movement" | "cost_item" | "site_visit" | "issue" | "commissioning" | "hse" | "warranty", RoleCode[]> = {
  document: ["techlead", "director"],
  attachment: ["techlead"],
  goods_receipt: ["techlead", "finance"],
  stock_movement: ["techlead", "finance"],
  cost_item: ["finance", "director"],
  site_visit: ["techlead"],
  issue: ["techlead"],
  commissioning: ["director", "techlead"],
  hse: ["techlead"],
  warranty: ["techlead", "finance"],
};
