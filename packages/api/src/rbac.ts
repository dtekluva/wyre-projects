import type { RoleCode, User, ProjectMembership } from "./types";
import { GLOBAL_ROLES } from "./types";

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
  | "inventory.read" | "inventory.write"
  | "dashboard.read";

const R = (...p: Permission[]) => p;

/** Spec §2.2 permission matrix (Phase 1 subset + a few phase-2 reads for display) */
export const MATRIX: Record<RoleCode, Permission[]> = {
  admin: R("project.create","project.read","project.update","chronology.read","document.create","document.read","document.update",
           "attachment.create","attachment.read","po.read","approval.read","membership.manage","users.manage",
           "thresholds.read","thresholds.manage","money.read","inventory.read","dashboard.read"),
  director: R("project.read","gate.approve","chronology.read","document.read","document.check","attachment.read","po.read","po.approve",
              "approval.read","thresholds.read","money.read","inventory.read","dashboard.read"),
  finance: R("project.read","gate.approve","chronology.read","document.read","attachment.read","po.read","po.approve","approval.read",
             "thresholds.read","money.read","money.write","inventory.read","dashboard.read"),
  pm: R("project.create","project.read","project.update","gate.request","chronology.read","document.create","document.read","document.update",
        "attachment.create","attachment.read","attachment.check","po.create","po.read","approval.read","membership.manage",
        "thresholds.read","money.read","inventory.read","dashboard.read"),
  lead_engineer: R("project.read","gate.approve","chronology.read","document.create","document.read","document.update","document.check",
                   "attachment.create","attachment.read","attachment.check","po.read","approval.read","thresholds.read","dashboard.read"),
  field_tech: R("project.read","chronology.read","document.create","document.read","attachment.create","attachment.read"),
  store_keeper: R("project.read","chronology.read","attachment.create","attachment.read","po.read","inventory.read","inventory.write",
                  "thresholds.read","dashboard.read"),
  auditor: R("project.read","chronology.read","document.read","attachment.read","po.read","approval.read","thresholds.read",
             "money.read","inventory.read","dashboard.read"),
};

/** Roles a user effectively holds on a given project (global roles + memberships) */
export function rolesOn(user: User, projectId: string | undefined, memberships: ProjectMembership[]): RoleCode[] {
  const globals = user.roles.filter((r) => GLOBAL_ROLES.includes(r));
  if (!projectId) return user.roles;
  const local = memberships.filter((m) => m.projectId === projectId && m.userId === user.id && !m.revokedAt).map((m) => m.role);
  return Array.from(new Set([...globals, ...local]));
}

export function can(user: User, perm: Permission, projectId: string | undefined, memberships: ProjectMembership[]): boolean {
  return rolesOn(user, projectId, memberships).some((r) => MATRIX[r].includes(perm));
}

/** Who may check whose input — spec §4.13 */
export const CHECKER_ROLES: Record<"document" | "attachment", RoleCode[]> = {
  document: ["lead_engineer", "director"],
  attachment: ["pm", "lead_engineer"],
};
