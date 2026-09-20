"""Spec §2.2 permission matrix + §2.3 scoping. The matrix is seeded into RolePermission (editable by Admin) and
cached in-process; `can()` mirrors packages/api/src/rbac.ts + MockApi.can exactly."""
from __future__ import annotations

from typing import Iterable, Optional

from .constants import GLOBAL_ROLES

MATRIX: dict[str, list[str]] = {
    # Approver, and the administrator: `admin` folded in here on 2026-09-19, so this is the only role that
    # manages users and thresholds. It approves and checks; it does not raise POs or cost items, so a
    # director cannot manufacture the thing they then approve.
    "director": ["project.create", "project.read", "project.update", "gate.request", "gate.approve", "chronology.read",
                 "document.create", "document.read", "document.update", "document.check",
                 "attachment.create", "attachment.read", "po.read", "po.approve", "writeoff.approve",
                 "stockcount.approve", "commissioning.check", "approval.read", "membership.manage", "users.manage",
                 "thresholds.read", "thresholds.manage", "money.read", "inventory.read", "asset.read",
                 "recon.read", "dashboard.read", "catalogue.manage"],
    # Checker and project owner — the old pm and lead_engineer, merged. It holds both gate.request and
    # gate.approve, which is safe because segregation of duties is enforced per *person*
    # (approvals.py and review.py refuse your own request or your own submission), not per role.
    "techlead": ["project.create", "project.read", "project.update", "gate.request", "gate.approve",
                 "chronology.read", "document.create", "document.read", "document.update", "document.check",
                 "attachment.create", "attachment.read", "attachment.check", "po.create", "po.read",
                 "approval.read", "membership.manage", "thresholds.read", "money.read",
                 "cost.create", "change_order.create", "goods_receipt.create", "goods_receipt.check",
                 "inventory.read", "inventory.request", "inventory.check", "asset.read", "asset.write",
                 "visit.create", "visit.check", "issue.create", "issue.update", "issue.check",
                 "commissioning.create", "commissioning.check", "hse.create", "hse.check",
                 "warranty.create", "warranty.check", "dashboard.read", "catalogue.manage"],
    # Field capture — the old field_tech, renamed. Creates, never checks.
    "tech": ["project.read", "chronology.read", "document.create", "document.read",
             "attachment.create", "attachment.read", "goods_receipt.create",
             "inventory.read", "inventory.request", "asset.read", "asset.write",
             "visit.create", "issue.create", "issue.update", "hse.create", "dashboard.read"],
    "finance": ["stockcount.approve", "warranty.check", "project.read", "gate.request", "gate.approve", "chronology.read", "document.read", "attachment.read",
                "po.read", "po.approve", "writeoff.approve", "approval.read", "thresholds.read", "money.read", "money.write", "cost.create",
                "cost.check", "goods_receipt.check", "inventory.read", "inventory.check", "retention.request", "asset.read", "recon.read",
                "recon.write", "dashboard.read"],
    "store_keeper": ["stockcount.create", "project.read", "chronology.read", "attachment.create", "attachment.read", "po.read",
                     "goods_receipt.create", "inventory.read", "inventory.write", "asset.read", "asset.write", "thresholds.read", "dashboard.read", "catalogue.manage"],
    "auditor": ["project.read", "chronology.read", "document.read", "attachment.read", "po.read", "approval.read", "thresholds.read",
                "money.read", "inventory.read", "asset.read", "recon.read", "dashboard.read"],
}

# Roles trusted to sign off their own work (user decision, 2026-09-20). Everyone else still needs a
# second pair of eyes: a tech cannot check the visit they logged, a techlead cannot approve their own
# gate request. The record always shows who submitted and who checked, so a self-review is visible in
# the audit trail rather than hidden by it.
SELF_REVIEW_ROLES = {"finance", "director", "store_keeper"}


def may_self_review(user) -> bool:
    return bool(SELF_REVIEW_ROLES.intersection(base_roles(user)))


CHECK_PERM = {
    "document": "document.check", "attachment": "attachment.check", "goods_receipt": "goods_receipt.check", "stock_movement": "inventory.check",
    "cost_item": "cost.check", "site_visit": "visit.check", "issue": "issue.check", "commissioning": "commissioning.check",
    "hse": "hse.check", "warranty": "warranty.check",
}

_cache: Optional[dict[str, set[str]]] = None


def matrix() -> dict[str, set[str]]:
    """Role → permissions, from the DB (seeded from MATRIX); falls back to the code matrix before seeding."""
    global _cache
    if _cache is None:
        from .models import RolePermission
        rows = RolePermission.objects.values_list("role_id", "permission")
        m: dict[str, set[str]] = {}
        for role, perm in rows:
            m.setdefault(role, set()).add(perm)
        _cache = m if m else {r: set(p) for r, p in MATRIX.items()}
    return _cache


def invalidate() -> None:
    global _cache
    _cache = None


def base_roles(user) -> list[str]:
    return list(user.role_codes())


def roles_on(user, project_id: Optional[str] = None, memberships: Optional[Iterable] = None) -> list[str]:
    """Roles a user holds on a project.

    Wyre runs this as a single in-house team, so roles apply company-wide: a Lead Engineer is a Lead Engineer on
    every project, not only the ones they are assigned to (user decision, 2026-09-15). `ProjectMembership` is
    therefore an *assignment* record — who is responsible, shown in the UI and used to pick defaults — and no
    longer a permission gate.

    What still constrains people is unchanged and is not membership-based:
      * the role → permission matrix (§2.2): a Field Tech cannot approve a PO anywhere;
      * segregation of duties (§4.13, §5): nobody checks their own submission or approves their own request;
      * actor capture: every create, edit and decision records who did it, on every project.
    """
    return base_roles(user)


def _has(roles: Iterable[str], perm: str) -> bool:
    m = matrix()
    return any(perm in m.get(r, set()) for r in roles)


# Permissions a project can delegate to one named person, on that project alone.
DELEGATED = {"commissioning.create": "commissioning_assignee_id"}


def can(user, perm: str, project_id: Optional[str] = None) -> bool:
    """Permission follows the role, on every project. See `roles_on` for what still constrains people.

    One exception: a project may delegate a permission to a named person (DELEGATED). A techlead assigns
    commissioning per site, so the tech who did the install can record the readings they took. It widens
    nothing else — the record still has to be checked by someone who is not its author.
    """
    if _has(base_roles(user), perm):
        return True
    field = DELEGATED.get(perm)
    if field and project_id:
        from .models import Project
        return Project.objects.filter(pk=project_id, **{field: user.id}).exists()
    return False


def can_by_base_role(user, perm: str) -> bool:
    """Permission granted by any base role regardless of membership (used for project.create — no project exists yet)."""
    return _has(base_roles(user), perm)


def has_global(user) -> bool:
    return any(r in GLOBAL_ROLES for r in base_roles(user))
