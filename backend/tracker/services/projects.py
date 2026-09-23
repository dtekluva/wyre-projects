from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from django.db import transaction

from .. import rbac
from ..constants import PROJECT_TYPE_LABEL
from ..errors import ApiError
from ..models import Project, ProjectMembership, User
from . import base as b


def can_create_project(actor: User) -> bool:
    """project.create is granted by base role (Admin, PM) — there is no project to be a member of yet."""
    return rbac.can_by_base_role(actor, "project.create")


def next_project_code() -> str:
    year = datetime.now().year
    used = []
    for code in Project.objects.values_list("code", flat=True):
        m = re.match(r"^WYR-(\d{4})-(\d+)$", code)
        if m and int(m.group(1)) == year:
            used.append(int(m.group(2)))
    return f"WYR-{year}-{(max(used) if used else 0) + 1:03d}"


def list_projects(user: User):
    """The portfolio is company-wide: any signed-in member of staff can see every project.
    Membership no longer gates *reading* a project — it gates acting on one, which `rbac.can` still enforces."""
    return Project.objects.all().order_by("code")


def visible_project_ids(user: User) -> list[str]:
    return list(list_projects(user).values_list("id", flat=True))


def my_project_ids(user: User) -> list[str]:
    """Projects this user is actually assigned to, for 'my work' views and for pickers that must not offer
    a project the user would be refused on."""
    return list(ProjectMembership.objects.filter(user=user, revoked_at__isnull=True).values_list("project_id", flat=True).distinct())


@transaction.atomic
def create_project(actor: User, input: dict) -> Project:
    if not can_create_project(actor):
        raise ApiError('Your role does not allow "project.create"', "forbidden")

    def req(key: str, label: str) -> str:
        v = b.clean(input.get(key))
        if not v:
            raise ApiError(f"{label} is required", "invalid")
        return v

    name = req("name", "Project name"); client_name = req("clientName", "Client"); branch_name = req("branchName", "Branch / site"); location = req("location", "Location")
    ptype = input.get("projectType")
    if ptype not in PROJECT_TYPE_LABEL:
        raise ApiError("Unknown project type", "invalid")

    def money(key: str, label: str) -> b.Decimal:
        v = input.get(key)
        n = b.dec(v) if v not in (None, "") else b.ZERO
        if n < 0:
            raise ApiError(f"{label} must be zero or more", "invalid")
        return b.round2(n)

    # NET of VAT — `contractValue` is accepted as an alias and treated as net; VAT and the gross are derived
    contract_value_net = money("contractValueNet" if input.get("contractValueNet") not in (None, "") else "contractValue", "Contract value"); approved_budget = money("approvedBudget", "Approved budget")
    if approved_budget > contract_value_net and contract_value_net > 0:
        raise ApiError("Approved budget cannot exceed the net contract value", "invalid")
    from . import billing
    vat_rate = billing._rate(input.get("vatRate"), b.dec("7.5")); vat_treatment = billing._treatment(input.get("vatTreatment"), "standard")
    rp = input.get("retentionPercent")
    retention = b.threshold_num("retention.percent", 5) if rp in (None, "") else b.dec(rp)
    if retention < 0 or retention > 20:
        raise ApiError("Retention must be between 0 and 20 %", "invalid")
    kwp = input.get("systemCapacityKwp")
    if kwp not in (None, "") and not b.dec(kwp) > 0:
        raise ApiError("System capacity must be a positive number of kWp", "invalid")
    due = input.get("proposalDueDate")
    if due and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(due)):
        raise ApiError("Proposal due date must be YYYY-MM-DD", "invalid")
    handover = input.get("targetHandoverDate")
    if handover and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(handover)):
        raise ApiError("Target handover must be YYYY-MM-DD", "invalid")
    if due and handover and str(handover) < str(due):
        raise ApiError("Target handover cannot be before the proposal sign-off", "invalid")
    planned = {}
    if due:
        planned["0"] = due
    if handover:
        planned["6"] = handover
    pm = b.get_user(input.get("pmId"))
    if "techlead" not in pm.role_codes():
        raise ApiError(f"{pm.name} is not a Project Manager", "invalid")
    le = b.get_user(input.get("leadEngineerId"))
    if "techlead" not in le.role_codes():
        raise ApiError(f"{le.name} is not a Lead Engineer", "invalid")
    if Project.objects.filter(name__iexact=name).exists():
        raise ApiError("A project with that name already exists", "conflict")
    at = b.now()
    p = Project.objects.create(
        **b.maybe_id(input, Project, "p"), code=next_project_code(), name=name, client_name=client_name, branch_name=branch_name, location=location,
        project_type=ptype, system_capacity_kwp=b.dec(kwp) if kwp not in (None, "") else None,
        stage=0, rag="green", pm=pm, lead_engineer=le, contract_value_net=contract_value_net, vat_rate=vat_rate, vat_treatment=vat_treatment, approved_budget=approved_budget,
        contract_status="received" if input.get("contractReceived") else "draft", contract_received_on=at.date() if input.get("contractReceived") else None, contract_received_by=actor if input.get("contractReceived") else None,
        committed=0, actual=0, stage_planned=planned, stage_actual={}, retention_percent=retention,
        created_at=at, created_by=actor, updated_at=at, updated_by=actor,
    )
    b.log(p.id, actor, "project_created", f"Project created — {p.code} · {PROJECT_TYPE_LABEL[ptype]} · {b.fmt(contract_value_net)} net of VAT", None, {"model": "Project", "id": p.id})
    for u, role in ((pm, "techlead"), (le, "techlead")):
        ProjectMembership.objects.create(project=p, user=u, role=role, granted_by=actor, granted_at=at)
        b.log(p.id, actor, "role_granted", f"{u.name} granted {role}")
    return p


@transaction.atomic
def grant_membership(actor: User, project_id: str, user_id: str, role: str) -> ProjectMembership:
    b.require(actor, "membership.manage", project_id)
    b.project(project_id)
    user = b.get_user(user_id)
    if ProjectMembership.objects.filter(project_id=project_id, user=user, role=role, revoked_at__isnull=True).exists():
        raise ApiError("Already a member with that role", "conflict")
    m = ProjectMembership.objects.create(project_id=project_id, user=user, role=role, granted_by=actor, granted_at=b.now())
    b.log(project_id, actor, "role_granted", f"{user.name} granted {role}")
    return m


@transaction.atomic
def revoke_membership(actor: User, membership_id: str) -> None:
    m = b.get_or_404(ProjectMembership, membership_id, "Membership")
    b.require(actor, "membership.manage", m.project_id)
    m.revoked_at = b.now()
    m.save(update_fields=["revoked_at"])
    b.log(m.project_id, actor, "role_revoked", f"{m.user.name} revoked {m.role}")


@transaction.atomic
def assign_commissioning(actor: User, project_id: str, user_id: Optional[str]) -> Project:
    """Delegate (or clear) who records commissioning on this project. Whoever holds membership.manage
    decides — techlead or director. Passing user_id=None clears it."""
    b.require(actor, "membership.manage", project_id)
    p = b.project(project_id)
    if user_id:
        user = b.get_user(user_id)
        if p.commissioning_assignee_id == user.id:
            raise ApiError(f"{user.name} is already assigned", "conflict")
        p.commissioning_assignee = user
        p.save(update_fields=["commissioning_assignee"])
        b.log(project_id, actor, "commissioning_assigned", f"{user.name} assigned to commission this site")
    else:
        if not p.commissioning_assignee_id:
            raise ApiError("Nobody is assigned", "conflict")
        was = p.commissioning_assignee.name
        p.commissioning_assignee = None
        p.save(update_fields=["commissioning_assignee"])
        b.log(project_id, actor, "commissioning_assigned", f"{was} unassigned from commissioning")
    return p


# mirrors packages/api/src/gates.ts — the lifecycle is fixed, so the names live in code on both sides
STAGE_NAMES = ["Lead / Proposal", "Site Survey", "Design & Approvals", "Procurement", "Installation", "Commissioning", "Handover", "O&M", "Closed / Decommissioned"]


@transaction.atomic
def set_stage_plan(actor: User, project_id: str, input: dict) -> Project:
    """The schedule: planned exit date per stage. Stages already exited are history and stay as they were; the
    rest must run in stage order. Every changed date is one chronology line, so a slipping plan leaves a trail."""
    b.require(actor, "project.update", project_id)
    p = b.project(project_id)
    current = dict(p.stage_planned or {})
    nxt = dict(current)
    changes = []
    for k, v in (input.get("planned") or {}).items():
        try:
            st = int(k)
        except (TypeError, ValueError):
            raise ApiError(f"Unknown stage {k}", "invalid")
        if st < 0 or st > 8:
            raise ApiError(f"Unknown stage {k}", "invalid")
        val = str(v)[:10] if v else None
        if val and not re.match(r"^\d{4}-\d{2}-\d{2}$", val):
            raise ApiError(f"Stage {st} date must be YYYY-MM-DD", "invalid")
        if current.get(str(st)) == val:
            continue
        if st < p.stage:
            raise ApiError(f"Stage {st} · {STAGE_NAMES[st]} has already been exited — its plan is history", "conflict")
        if val:
            nxt[str(st)] = val
        else:
            nxt.pop(str(st), None)
        changes.append(f"Stage {st} · {STAGE_NAMES[st]} — planned exit {b.fmt_date(current.get(str(st)))} → {b.fmt_date(val)}")
    if not changes:
        raise ApiError("Nothing changed", "invalid")
    prev = None
    for st in range(9):
        d = nxt.get(str(st))
        if not d:
            continue
        if prev and d < prev:
            raise ApiError(f"Stage {st} · {STAGE_NAMES[st]} cannot be planned before the stage above it", "invalid")
        prev = d
    p.stage_planned = nxt
    b.stamp(p, actor, b.now()); p.save()
    for c in changes:
        b.log(project_id, actor, "plan_updated", c, None, {"model": "Project", "id": p.id})
    return p
