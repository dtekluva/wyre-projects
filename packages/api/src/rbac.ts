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
  | "inventory.read" | "inventory.write" | "inventory.request" | "inventory.check" | "writeoff.approve"
  | "goods_receipt.create" | "goods_receipt.check"
  | "cost.create" | "cost.check" | "change_order.create" | "retention.request"
  | "asset.read" | "asset.write" | "recon.read" | "recon.write"
  | "visit.create" | "visit.check" | "issue.create" | "issue.update" | "issue.check"
  | "commissioning.create" | "commissioning.check" | "hse.create" | "hse.check" | "warranty.create" | "warranty.check"
  | "stockcount.create" | "stockcount.approve"
  | "dashboard.read";

const R = (...p: Permission[]) => p;

/** Spec §2.2 permission matrix (Phase 1 subset + a few phase-2 reads for display) */
export const MATRIX: Record<RoleCode, Permission[]> = {
  admin: R("project.create","project.read","project.update","chronology.read","document.create","document.read","document.update",
           "attachment.create","attachment.read","po.read","approval.read","membership.manage","users.manage",
           "thresholds.read","thresholds.manage","money.read","inventory.read","asset.read","recon.read","dashboard.read"),
  director: R("commissioning.check","stockcount.approve","project.read","gate.approve","chronology.read","document.read","document.check","attachment.read","po.read","po.approve",
              "writeoff.approve","approval.read","thresholds.read","money.read","inventory.read","asset.read","recon.read","dashboard.read"),
  finance: R("stockcount.approve","warranty.check","project.read","gate.approve","chronology.read","document.read","attachment.read","po.read","po.approve","writeoff.approve",
             "approval.read","thresholds.read","money.read","money.write","cost.create","cost.check","goods_receipt.check","inventory.read",
             "inventory.check","retention.request","asset.read","recon.read","recon.write","dashboard.read"),
  pm: R("visit.create","visit.check","issue.create","issue.update","issue.check","hse.create","hse.check","warranty.create","warranty.check","project.create","project.read","project.update","gate.request","chronology.read","document.create","document.read","document.update",
        "attachment.create","attachment.read","attachment.check","po.create","po.read","approval.read","membership.manage",
        "thresholds.read","money.read","cost.create","change_order.create","goods_receipt.create","goods_receipt.check",
        "inventory.read","inventory.request","inventory.check","asset.read","asset.write","dashboard.read"),
  lead_engineer: R("visit.create","visit.check","issue.create","issue.update","issue.check","commissioning.create","commissioning.check","hse.create","hse.check","warranty.create","project.read","gate.approve","chronology.read","document.create","document.read","document.update","document.check",
                   "attachment.create","attachment.read","attachment.check","po.read","approval.read","thresholds.read",
                   "goods_receipt.create","inventory.read","asset.read","asset.write","dashboard.read"),
  field_tech: R("visit.create","issue.create","issue.update","hse.create","project.read","chronology.read","document.create","document.read","attachment.create","attachment.read",
                "goods_receipt.create","inventory.read","inventory.request","asset.read","asset.write"),
  store_keeper: R("stockcount.create","project.read","chronology.read","attachment.create","attachment.read","po.read","goods_receipt.create",
                  "inventory.read","inventory.write","asset.read","asset.write","thresholds.read","dashboard.read"),
  auditor: R("project.read","chronology.read","document.read","attachment.read","po.read","approval.read","thresholds.read",
             "money.read","inventory.read","asset.read","recon.read","dashboard.read"),
};

/**
 * Roles a user holds on a project. Wyre runs as a single in-house team, so roles apply company-wide: a Lead
 * Engineer is a Lead Engineer on every project, not only the ones they are assigned to. `ProjectMembership` is
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
export const CHECKER_ROLES: Record<"document" | "attachment" | "goods_receipt" | "stock_movement" | "cost_item" | "site_visit" | "issue" | "commissioning" | "hse" | "warranty", RoleCode[]> = {
  document: ["lead_engineer", "director"],
  attachment: ["pm", "lead_engineer"],
  goods_receipt: ["pm", "finance"],
  stock_movement: ["pm", "finance"],
  cost_item: ["finance", "director"],
  site_visit: ["pm", "lead_engineer"],
  issue: ["pm", "lead_engineer"],
  commissioning: ["director", "lead_engineer"],
  hse: ["pm", "lead_engineer"],
  warranty: ["pm", "finance"],
};
