"""Spec §4.13 maker-checker — review queue, pending counts and the check() transition with per-module side effects."""
from __future__ import annotations

from typing import Optional

from django.db import transaction
from django.utils import timezone

from .. import rbac
from ..constants import COST_CATEGORY_LABEL, DOC_TYPE_LABEL, HSE_TYPE_LABEL, MOVEMENT_LABEL, VISIT_TYPE_LABEL
from ..errors import ApiError
from ..models import (Actual, Attachment, CommissioningRecord, CostItem, Document, GoodsReceipt, HseIncident, Issue, SiteVisit, StockMovement, User, WarrantyClaim)
from ..rbac import CHECK_PERM
from . import base as b

MODELS = {"document": Document, "attachment": Attachment, "goods_receipt": GoodsReceipt, "stock_movement": StockMovement, "cost_item": CostItem,
          "site_visit": SiteVisit, "issue": Issue, "commissioning": CommissioningRecord, "hse": HseIncident, "warranty": WarrantyClaim}
MODEL_NAME = {"document": "Document", "attachment": "Attachment", "goods_receipt": "GoodsReceipt", "stock_movement": "StockMovement", "cost_item": "CostItem",
              "site_visit": "SiteVisit", "issue": "Issue", "commissioning": "CommissioningRecord", "hse": "HseIncident", "warranty": "WarrantyClaim"}


def pending_items() -> list[dict]:
    """Every item awaiting a check, with no per-user filtering — used by the alert engine, which needs to
    decide who to tell rather than what one person can see."""
    return _collect(None)


def review_queue(user: User) -> list[dict]:
    """What this user may check: pending, not their own, and within their permissions."""
    return _collect(user)


def _collect(user: Optional[User]) -> list[dict]:
    from . import money as money_svc
    items: list[dict] = []
    escalation = int(b.threshold_num("check.escalation_days", 3)); now = timezone.now()

    def push(kind, it, project_id, title, subtitle, amount=None):
        if it.review_status != "pending":
            return
        if user is not None and (it.submitted_by_id == user.id or not rbac.can(user, CHECK_PERM[kind], project_id)):
            return
        age = (now - it.submitted_at).days
        items.append({"kind": kind, "id": it.id, "projectId": project_id, "title": title, "subtitle": subtitle, "amount": None if amount is None else float(amount),
                      "submittedBy": it.submitted_by_id, "submittedAt": b.iso(it.submitted_at), "ageDays": age, "overdue": age > escalation, "item": it})

    for d in Document.objects.filter(review_status="pending"):
        push("document", d, d.project_id, d.title, DOC_TYPE_LABEL.get(d.doc_type, d.doc_type))
    for a in Attachment.objects.filter(review_status="pending"):
        push("attachment", a, a.project_id, a.caption or a.file_name, f"{a.linked_to['model']}: {a.linked_to.get('label', '')}" if a.linked_to else "Photo" if a.kind == "image" else "File")
    for g in GoodsReceipt.objects.filter(review_status="pending").select_related("po__vendor"):
        push("goods_receipt", g, g.project_id, f"{g.grn_number} · {g.po.vendor.name}", f"{len(g.lines)} line{'s' if len(g.lines) > 1 else ''} against {g.po.po_number}", money_svc.grn_value(g))
    for m in StockMovement.objects.filter(review_status="pending", movement_type__in=["issue", "return", "transfer"]).select_related("item"):
        if (m.source_ref or {}).get("model") == "SiteVisit":
            continue
        push("stock_movement", m, m.project_id, f"{MOVEMENT_LABEL[m.movement_type]} · {m.item.name} × {b.dec(m.qty).normalize():f}", (m.source_ref or {}).get("label", ""), m.total_cost)
    for c in CostItem.objects.filter(review_status="pending"):
        push("cost_item", c, c.project_id, c.label, f"Budget line · {COST_CATEGORY_LABEL[c.category]}", c.planned_amount)
    for v in SiteVisit.objects.filter(review_status="pending"):
        techs = ", ".join(b.user_name(t) for t in v.technician_ids)
        push("site_visit", v, v.project_id, f"{VISIT_TYPE_LABEL[v.visit_type]} visit · {b.iso(v.started_at)[:10]}",
             f"{techs} · {len(v.parts)} part line{'' if len(v.parts) == 1 else 's'} · {len(v.attachment_ids)} photo{'' if len(v.attachment_ids) == 1 else 's'}", v.cost_total)
    for i in Issue.objects.filter(review_status="pending"):
        push("issue", i, i.project_id, f"{'Resolution' if i.status == 'resolved' else 'Issue report'} · {i.title}", f"{i.severity} · {i.category}{' · after photo attached' if i.status == 'resolved' else ''}", i.cost_to_resolve or None)
    for c in CommissioningRecord.objects.filter(review_status="pending"):
        push("commissioning", c, c.project_id, f"Commissioning record · {c.result}", f"{sum(1 for x in c.items if x.get('pass'))}/{len(c.items)} checklist pass · meter integrity {'pass' if all(c.meter.values()) else 'FAIL'}")
    for h in HseIncident.objects.filter(review_status="pending"):
        push("hse", h, h.project_id, f"HSE · {HSE_TYPE_LABEL[h.type]}", f"{h.severity} · {h.description[:70]}")
    for w in WarrantyClaim.objects.filter(review_status="pending").select_related("asset"):
        push("warranty", w, w.project_id, f"Warranty claim · {w.asset.serial}", f"{w.status} · {b.vendor_name(w.vendor_id)}", w.cost_recovered or None)
    return sorted(items, key=lambda x: x["submittedAt"])


def pending_checks(project_id: str) -> int:
    n = 0
    for kind, model in MODELS.items():
        qs = model.objects.filter(project_id=project_id, review_status="pending")
        if kind == "stock_movement":
            qs = qs.exclude(movement_type="write_off")
        n += qs.count()
    return n


@transaction.atomic
def check(actor: User, kind: str, id: str, decision: str, comment: Optional[str] = None) -> None:
    from . import field as field_svc, money as money_svc, stock as stock_svc
    model = MODELS.get(kind)
    if model is None:
        raise ApiError("Unknown review kind", "invalid")
    item = b.get_or_404(model, id, "Item")
    project_id = getattr(item, "project_id", None)
    if item.review_status != "pending":
        raise ApiError("Already reviewed", "conflict")
    if item.submitted_by_id == actor.id:
        raise ApiError("You cannot check your own submission (segregation of duties)", "forbidden")
    b.require(actor, CHECK_PERM[kind], project_id)
    if decision not in ("checked", "rejected"):
        raise ApiError("Decision must be checked or rejected", "invalid")
    note = b.clean(comment) or None
    if decision == "rejected" and not note:
        raise ApiError("A comment is required to reject", "invalid")
    at = b.now(); ok = decision == "checked"
    item.review_status = decision; item.checked_by = actor; item.checked_at = at; item.check_comment = note
    label = ""
    if kind == "document":
        item.status = "approved" if ok else "submitted"; b.stamp(item, actor, at); label = item.title
    elif kind == "attachment":
        label = item.caption or item.file_name
    elif kind == "cost_item":
        b.stamp(item, actor, at); label = f"budget line {item.label}"
    elif kind == "goods_receipt":
        label = item.grn_number
        item.save()
        if ok:
            money_svc.post_goods_receipt(item, actor)
    elif kind == "stock_movement":
        label = f"{MOVEMENT_LABEL[item.movement_type]} {item.item.name} × {b.dec(item.qty).normalize():f}"
        item.save()
        if ok:
            stock_svc.post_movement_effects(item, actor)
    elif kind == "site_visit":
        b.stamp(item, actor, at); label = f"{VISIT_TYPE_LABEL[item.visit_type]} visit {b.iso(item.started_at)[:10]}"
        for part in item.parts:
            m = StockMovement.objects.filter(pk=part.get("movementId"), review_status="pending").first()
            if not m:
                continue
            m.review_status = decision; m.checked_by = actor; m.checked_at = at; m.save()
            if ok:
                stock_svc.post_movement_effects(m, actor)
        if ok and b.dec(item.cost_travel) + b.dec(item.cost_labour) > 0:
            Actual.objects.create(project_id=item.project_id, category="om", source="visit", source_ref={"model": "SiteVisit", "id": item.id, "label": f"{VISIT_TYPE_LABEL[item.visit_type]} visit — travel + labour"},
                                  amount=b.dec(item.cost_travel) + b.dec(item.cost_labour), date=at, attachment_ids=item.attachment_ids, created_by=actor)
    elif kind == "issue":
        b.stamp(item, actor, at); label = item.title
        if item.status == "resolved":
            if ok:
                item.status = "closed"
                if b.dec(item.cost_to_resolve) > 0:
                    Actual.objects.create(project_id=item.project_id, category="om", source="issue", source_ref={"model": "Issue", "id": item.id, "label": f"Issue resolved — {item.title}"},
                                          amount=item.cost_to_resolve, date=at, attachment_ids=item.after_attachment_ids, created_by=actor)
            else:
                item.status = "in_progress"; item.resolved_at = None; item.resolved_by = None
        elif not ok:
            item.status = "wont_fix"
    elif kind == "commissioning":
        b.stamp(item, actor, at); label = f"commissioning record ({item.result})"
        item.save()
        if ok and item.result != "fail":
            field_svc.emit_commissioning_evidence(item, actor)
    elif kind == "hse":
        b.stamp(item, actor, at); label = f"HSE {HSE_TYPE_LABEL[item.type]}"
    elif kind == "warranty":
        b.stamp(item, actor, at); label = f"warranty claim {item.asset.serial}"
        if ok and b.dec(item.cost_recovered) > 0 and item.status in ("accepted", "refunded", "replaced") and not Actual.objects.filter(source_ref__id=item.id).exists():
            Actual.objects.create(project_id=item.project_id, category="om", source="warranty", source_ref={"model": "WarrantyClaim", "id": item.id, "label": f"Warranty recovery — {b.vendor_name(item.vendor_id)}"},
                                  amount=-b.dec(item.cost_recovered), date=at, attachment_ids=[], created_by=actor)
    item.save()
    b.log(project_id, actor, "check_passed" if ok else "check_rejected", f"{'Checked' if ok else 'Rejected'}: {label}", note, {"model": MODEL_NAME[kind], "id": id})
