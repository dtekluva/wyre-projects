"""Spec §4.12 / §5 — formal approvals with threshold routing and segregation of duties."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from django.db import transaction

from .. import rbac
from ..errors import ApiError
from ..gates import STAGES
from ..models import Approval, Asset, ChangeOrder, Project, PurchaseOrder, Retention, StockCount, StockMovement, User
from . import base as b


def list_approvals(project_id: Optional[str] = None, status: Optional[str] = None, kind: Optional[str] = None):
    qs = Approval.objects.all()
    if project_id:
        qs = qs.filter(project_id=project_id)
    if status:
        qs = qs.filter(status=status)
    if kind:
        qs = qs.filter(kind=kind)
    return qs.order_by("-requested_at", "-id")


def can_decide(user: User, a: Approval) -> dict:
    if a.status != "pending":
        return {"ok": False, "reason": "Already decided"}
    if a.requested_by_id == user.id and not rbac.may_self_review(user):
        return {"ok": False, "reason": "You raised this — segregation of duties"}
    perm = "gate.approve" if a.kind == "gate" else "writeoff.approve" if a.kind == "write_off" else "po.approve"
    if not rbac.can(user, perm, a.project_id):
        return {"ok": False, "reason": "Your role cannot approve this"}
    mine = rbac.roles_on(user, a.project_id or "__global__")
    decided = {d["role"] for d in a.decisions}
    role = next((r for r in a.required_roles if r in mine and r not in decided), None)
    if not role:
        return {"ok": False, "reason": "Your role has already decided" if decided else "Not one of the required approver roles"}
    return {"ok": True, "role": role}


def approvals_for(user: User) -> list[Approval]:
    return [a for a in list_approvals(status="pending") if can_decide(user, a)["ok"]]


@transaction.atomic
def decide(actor: User, approval_id: str, decision: str, comment: Optional[str] = None) -> Approval:
    a = b.get_or_404(Approval, approval_id, "Approval")
    c = can_decide(actor, a)
    if not c["ok"]:
        raise ApiError(c["reason"], "forbidden")
    if decision not in ("approved", "rejected"):
        raise ApiError("Decision must be approved or rejected", "invalid")
    note = b.clean(comment) or None
    if decision == "rejected" and not note:
        raise ApiError("A comment is required to reject", "invalid")
    at = b.now()
    a.decisions = list(a.decisions) + [{"approverId": actor.id, "role": c["role"], "decision": decision, "at": b.iso(at), "comment": note}]
    ref = {"model": "Approval", "id": a.id}
    if decision == "rejected":
        a.status = "rejected"; a.save()
        apply_outcome(a, actor, False)
        b.log(a.project_id, actor, "approval_decided", f"Rejected: {a.title}", note, ref)
        return a
    done = all(any(d["role"] == r and d["decision"] == "approved" for d in a.decisions) for r in a.required_roles)
    if done:
        a.status = "approved"; a.save()
        apply_outcome(a, actor, True)
        if a.kind == "gate" and a.target_stage is not None and a.project_id:
            p = a.project; frm = p.stage; p.stage = a.target_stage
            sa = dict(p.stage_actual); sa[str(a.target_stage)] = b.iso(at); p.stage_actual = sa; p.save()
            b.log(a.project_id, actor, "stage_change", f"Stage {frm} → {a.target_stage} · now in {STAGES[a.target_stage]['name']}", None, ref)
        else:
            et = {"po": "po_approved", "change_order": "change_order", "write_off": "stock_movement", "retention": "retention"}.get(a.kind, "approval_decided")
            b.log(a.project_id, actor, et, f"Approved: {a.title}", note, ref)
    else:
        a.save()
        waiting = [r for r in a.required_roles if not any(d["role"] == r for d in a.decisions)]
        b.log(a.project_id, actor, "approval_decided", f"{a.title} — approved by {c['role']}; awaiting {', '.join(waiting)}", note, ref)
    return a


def apply_outcome(a: Approval, actor: User, approved: bool) -> None:
    """Side effects of an approval reaching a terminal state."""
    from . import stock as stock_svc
    at = b.now()
    if a.kind == "po":
        po = PurchaseOrder.objects.filter(approval=a).first()
        if po:
            po.status = "approved" if approved else "rejected"; b.stamp(po, actor, at); po.save()
    if a.kind == "change_order":
        co = ChangeOrder.objects.filter(approval=a).first()
        if co:
            co.status = "approved" if approved else "rejected"; b.stamp(co, actor, at); co.save()
            if approved:
                p = co.project; p.approved_budget = b.dec(p.approved_budget) + b.dec(co.cost_delta); p.save(update_fields=["approved_budget"])
    if a.kind == "write_off":
        m = StockMovement.objects.filter(approval=a).first()
        if m:
            m.review_status = "checked" if approved else "rejected"; m.checked_by = actor; m.checked_at = at; m.save()
            if approved:
                for s in (m.serials or []):
                    asset = Asset.objects.filter(serial=s).first()
                    if asset:
                        asset.status = "decommissioned"; b.stamp(asset, actor, at); asset.save()
    if a.kind == "retention" and approved and a.project_id:
        r = Retention.objects.filter(project_id=a.project_id).first()
        if r:
            r.released_at = at; r.released_by = actor; r.approval = a; r.save()
    if a.kind == "stock_count":
        sc = StockCount.objects.filter(approval=a).first()
        if not sc:
            return
        sc.status = "approved" if approved else "rejected"; b.stamp(sc, actor, at); sc.save()
        if approved:
            for l in sc.lines:
                var = b.dec(l.get("variance"))
                if not var:
                    continue
                wac = stock_svc.wac_of(l["itemId"]); up = var > 0
                StockMovement.objects.create(item_id=l["itemId"], movement_type="adjustment", qty=abs(var), location_from=None if up else sc.location, location_to=sc.location if up else None,
                                             unit_cost=wac, total_cost=b.round2(abs(var) * wac), reason=f"Stock count {sc.count_date.isoformat()}: {l.get('note') or 'variance'}",
                                             source_ref={"model": "StockCount", "id": sc.id, "label": f"Count {sc.count_date.isoformat()}"},
                                             attachment_ids=[l["attachmentId"]] if l.get("attachmentId") else [], created_by=sc.counted_by, created_at=at, approval=a,
                                             review_status="checked", submitted_by=sc.counted_by, submitted_at=at, checked_by=actor, checked_at=at, review_version=1)
