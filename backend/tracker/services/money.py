"""Phase 2 — budget lines, POs, goods receipts, change orders, retention, project money rollup (spec §0, §4.4, §4.10)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from django.db import transaction

from .. import rbac
from ..constants import ASSET_TYPES, COST_CATEGORIES, COST_CATEGORY_LABEL
from ..errors import ApiError
from ..models import (Actual, Approval, Asset, ChangeOrder, CostItem, GoodsReceipt, InventoryItem, Project, PurchaseItem, PurchaseOrder,
                      Retention, StockMovement, User, Vendor)
from . import base as b


@transaction.atomic
def add_cost_item(actor: User, project_id: str, input: dict) -> CostItem:
    b.require(actor, "cost.create", project_id)
    b.project(project_id)
    amount = b.dec(input.get("plannedAmount")); label = b.clean(input.get("label"))
    if not amount > 0 or not label:
        raise ApiError("Label and a positive amount are required", "invalid")
    cat = input.get("category")
    if cat not in COST_CATEGORY_LABEL:
        raise ApiError("Unknown cost category", "invalid")
    at = b.now()
    c = CostItem(**b.maybe_id(input, CostItem, "ci"), project_id=project_id, category=cat, label=label, planned_amount=b.round2(amount), created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(c, actor, at); c.save()
    b.log(project_id, actor, "cost_item", f'Budget line "{label}" {b.fmt(amount)} submitted (pending Finance check)', None, {"model": "CostItem", "id": c.id})
    return c


def po_remaining(pi: PurchaseItem) -> Decimal:
    pending = Decimal("0")
    for g in GoodsReceipt.objects.filter(po_id=pi.po_id, review_status="pending"):
        for l in g.lines:
            if l.get("purchaseItemId") == pi.id:
                pending += b.dec(l.get("qty"))
    return b.dec(pi.qty) - b.dec(pi.qty_received) - pending


@transaction.atomic
def create_po(actor: User, project_id: str, input: dict) -> PurchaseOrder:
    b.require(actor, "po.create", project_id)
    b.project(project_id)
    lines = [l for l in (input.get("items") or []) if b.clean(l.get("description")) and b.dec(l.get("qty")) > 0 and b.dec(l.get("unitCost")) > 0]
    if not lines:
        raise ApiError("Add at least one line with quantity and unit cost", "invalid")
    vendor = Vendor.objects.filter(pk=input.get("vendorId")).first()
    if vendor is None:
        raise ApiError("Choose a vendor", "invalid")
    at = b.now()
    total = sum((b.dec(l["qty"]) * b.dec(l["unitCost"]) for l in lines), Decimal("0"))
    required = ["finance", "director"] if total >= b.threshold_num("po.director_threshold", 5_000_000) else ["finance"]
    po_number = f"PO-{datetime.now().year}-{PurchaseOrder.objects.count() + 27:03d}"
    desc = "; ".join(f"{b.dec(l['qty']).normalize():f} × {b.clean(l['description'])}" for l in lines)
    ap = Approval.objects.create(project_id=project_id, kind="po", title=f"{po_number} · {vendor.name}",
                                 description=f"{desc}. {'≥ director threshold → Finance + Director.' if len(required) > 1 else 'Finance approval.'}",
                                 requested_by=actor, requested_at=at, required_roles=required, decisions=[], status="pending", amount=b.round2(total))
    po = PurchaseOrder.objects.create(**b.maybe_id(input, PurchaseOrder, "po"), project_id=project_id, po_number=po_number, vendor=vendor, status="pending_approval", raised_by=actor, raised_at=at,
                                      total=b.round2(total), notes=b.clean(input.get("notes")) or None, approval=ap,
                                      created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    for i, l in enumerate(lines):
        inv = InventoryItem.objects.filter(pk=l.get("inventoryItemId")).first() if l.get("inventoryItemId") else None
        ci = CostItem.objects.filter(pk=l.get("costItemId")).first() if l.get("costItemId") else None
        q = b.dec(l["qty"]); uc = b.round2(l["unitCost"])
        PurchaseItem.objects.create(**b.maybe_id(l, PurchaseItem, "pi"), po=po, position=i, inventory_item=inv, cost_item=ci, description=b.clean(l["description"]), qty=q, unit_cost=uc, line_total=b.round2(q * uc), qty_received=0)
    b.log(project_id, actor, "po_raised", f"{po_number} raised — {vendor.name}, {b.fmt(total)} (awaiting {' + '.join(required)})", None, {"model": "PurchaseOrder", "id": po.id})
    return po


def grn_value(g: GoodsReceipt) -> Decimal:
    items = {i.id: i for i in g.po.items.all()}
    return sum((b.dec(l.get("qty")) * (b.dec(items[l["purchaseItemId"]].unit_cost) if l.get("purchaseItemId") in items else Decimal("0")) for l in g.lines), Decimal("0"))


@transaction.atomic
def receive_goods(actor: User, po_id: str, input: dict) -> GoodsReceipt:
    po = b.get_or_404(PurchaseOrder, po_id, "PO")
    b.require(actor, "goods_receipt.create", po.project_id)
    if po.status not in ("approved", "partially_delivered"):
        raise ApiError(f"PO is {po.status.replace('_', ' ')} — only approved POs can be received", "conflict")
    attachment_ids = list(input.get("attachmentIds") or [])
    if not attachment_ids:
        raise ApiError("A delivery note / receipt image is required", "invalid")
    lines = [l for l in (input.get("lines") or []) if b.dec(l.get("qty")) > 0]
    if not lines:
        raise ApiError("Enter a received quantity", "invalid")
    items = {i.id: i for i in po.items.all()}
    out = []
    for l in lines:
        it = items.get(l.get("purchaseItemId"))
        if it is None:
            raise ApiError("Unknown PO line", "invalid")
        qty = b.dec(l["qty"]); rem = po_remaining(it)
        if qty > rem:
            raise ApiError(f"{it.description}: only {rem.normalize():f} outstanding on this PO", "invalid")
        serials = None
        if it.inventory_item_id and it.inventory_item.is_serialised:
            ser = [s.strip() for s in (l.get("serials") or []) if s and s.strip()]
            n = int(qty)
            if len(ser) != n:
                raise ApiError(f"{it.description}: {n} serial number{'s' if n > 1 else ''} required (got {len(ser)})", "invalid")
            if len(set(ser)) != len(ser):
                raise ApiError("Duplicate serials in the same line", "invalid")
            dup = Asset.objects.filter(serial__in=ser).values_list("serial", flat=True).first()
            if dup:
                raise ApiError(f"Serial {dup} already exists in the asset register", "conflict")
            if any(not all(32 <= ord(ch) <= 126 for ch in s) for s in ser):
                raise ApiError("Serials must be plain ASCII (hidden characters found)", "invalid")
            serials = ser
        out.append({"purchaseItemId": it.id, "qty": float(qty), "serials": serials, "condition": l.get("condition") or "good"})
    at = b.now()
    loc = b.location(input.get("locationId"))
    g = GoodsReceipt(**b.maybe_id(input, GoodsReceipt, "grn"), project_id=po.project_id, po=po, grn_number=f"GRN-{datetime.now().year}-{GoodsReceipt.objects.count() + 10:03d}", received_at=at, received_by=actor,
                     lines=out, attachment_ids=attachment_ids, location=loc, notes=b.clean(input.get("notes")) or None,
                     created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(g, actor, at); g.save()
    summary = ", ".join(f"{b.dec(l['qty']).normalize():f} × {items[l['purchaseItemId']].description}" for l in out)
    b.log(po.project_id, actor, "delivery", f"{g.grn_number} — {summary} received against {po.po_number} (pending check)", None, {"model": "GoodsReceipt", "id": g.id})
    return g


def post_goods_receipt(g: GoodsReceipt, actor: User) -> None:
    """On GRN check: stock lines → receipt movements + assets; service lines → actuals; PO status."""
    po = g.po; at = b.now()
    items = {i.id: i for i in po.items.all()}
    for l in g.lines:
        it = items[l["purchaseItemId"]]; qty = b.dec(l["qty"])
        it.qty_received = b.dec(it.qty_received) + qty; it.save(update_fields=["qty_received"])
        if it.inventory_item_id:
            inv = it.inventory_item
            StockMovement.objects.create(item=inv, movement_type="receipt", qty=qty, location_to=g.location, unit_cost=it.unit_cost, total_cost=b.round2(qty * b.dec(it.unit_cost)),
                                         project_id=g.project_id, source_ref={"model": "GoodsReceipt", "id": g.id, "label": g.grn_number}, serials=l.get("serials"),
                                         attachment_ids=g.attachment_ids, created_by=g.received_by, created_at=at, review_status="checked", submitted_by=g.received_by,
                                         submitted_at=g.received_at, checked_by=actor, checked_at=at, review_version=1)
            for s in (l.get("serials") or []):
                Asset.objects.create(inventory_item=inv, asset_type=inv.category if inv.category in ASSET_TYPES else "other", make=inv.make or "", model=inv.model or inv.name,
                                     serial=s, unit_cost=it.unit_cost, vendor=po.vendor, purchase_item=it, grn=g, status="faulty" if l.get("condition") == "damaged" else "in_stock",
                                     location=g.location, created_at=at, created_by=g.received_by, updated_at=at, updated_by=actor)
        else:
            cat = it.cost_item.category if it.cost_item_id else "equipment"
            Actual.objects.create(project_id=g.project_id, cost_item=it.cost_item, category=cat, source="goods_receipt",
                                  source_ref={"model": "GoodsReceipt", "id": g.id, "label": f"{g.grn_number} · {it.description}"},
                                  amount=b.round2(qty * b.dec(it.unit_cost)), date=at, vendor=po.vendor, attachment_ids=g.attachment_ids, created_by=actor)
    po.status = "delivered" if all(b.dec(i.qty_received) >= b.dec(i.qty) for i in po.items.all()) else "partially_delivered"
    b.stamp(po, actor, at); po.save()


@transaction.atomic
def raise_change_order(actor: User, project_id: str, input: dict) -> ChangeOrder:
    b.require(actor, "change_order.create", project_id)
    p = b.project(project_id)
    title = b.clean(input.get("title")); reason = b.clean(input.get("reason"))
    if not title or not reason:
        raise ApiError("Title and reason are required", "invalid")
    at = b.now(); cost = b.round2(input.get("costDelta")); days = int(input.get("timeDeltaDays") or 0)
    big = abs(cost) >= b.threshold_num("co.director_threshold", 2_000_000) or abs(cost) >= b.dec(p.contract_value) * b.threshold_num("co.director_pct", 10) / 100
    required = ["finance", "director"] if big else ["finance"]
    co_number = f"CO-{ChangeOrder.objects.filter(project_id=project_id).count() + 1:02d}"
    scope = b.clean(input.get("scopeDelta"))
    ap = Approval.objects.create(project_id=project_id, kind="change_order", title=f"{co_number} · {title}",
                                 description=f"{scope or '—'}. {reason} {'Above director threshold → Finance + Director.' if big else 'Finance only.'}",
                                 requested_by=actor, requested_at=at, required_roles=required, decisions=[], status="pending", amount=cost)
    co = ChangeOrder.objects.create(**b.maybe_id(input, ChangeOrder, "co"), project_id=project_id, co_number=co_number, title=title, reason=reason, scope_delta=scope, cost_delta=cost, time_delta_days=days,
                                    status="pending_approval", approval=ap, created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.log(project_id, actor, "change_order", f"{co_number} raised — {title}, {b.fmt(cost)}, {days} d (awaiting {' + '.join(required)})", None, {"model": "ChangeOrder", "id": co.id})
    return co


def retention(p: Project) -> dict:
    r = Retention.objects.filter(project=p).first()
    if r:
        return {"projectId": p.id, "percent": float(r.percent), "amountHeld": float(r.amount_held), "releaseConditions": r.release_conditions,
                "releasedAt": b.iso(r.released_at), "releasedBy": r.released_by_id, "approvalId": r.approval_id}
    held = b.round2(b.dec(p.contract_value) * b.dec(p.retention_percent) / 100) if p.stage >= 6 else Decimal("0")
    return {"projectId": p.id, "percent": float(p.retention_percent), "amountHeld": float(held.to_integral_value()),
            "releaseConditions": f"Held from handover · released after {int(b.threshold_num('dlp.months', 12))}-month DLP", "releasedAt": None, "releasedBy": None, "approvalId": None}


@transaction.atomic
def request_retention_release(actor: User, project_id: str) -> Approval:
    b.require(actor, "retention.request", project_id)
    p = b.project(project_id); r = retention(p)
    if r["releasedAt"]:
        raise ApiError("Retention already released", "conflict")
    if not r["amountHeld"]:
        raise ApiError("No retention is held on this project yet", "conflict")
    if Approval.objects.filter(project_id=project_id, kind="retention", status="pending").exists():
        raise ApiError("Release already requested", "conflict")
    if not Retention.objects.filter(project=p).exists():
        Retention.objects.create(project=p, percent=b.dec(r["percent"]), amount_held=b.dec(r["amountHeld"]), release_conditions=r["releaseConditions"])
    requester_is_finance = "finance" in rbac.roles_on(actor, project_id)
    ap = Approval.objects.create(project_id=project_id, kind="retention", title=f"Retention release · {b.fmt(r['amountHeld'])}", description=r["releaseConditions"],
                                 requested_by=actor, requested_at=b.now(), required_roles=["director"] if requester_is_finance else ["finance", "director"],
                                 decisions=[], status="pending", amount=b.dec(r["amountHeld"]))
    b.log(project_id, actor, "retention", f"Retention release requested — {b.fmt(r['amountHeld'])}", None, {"model": "Approval", "id": ap.id})
    return ap


def money(project_id: str) -> dict:
    p = b.project(project_id)
    ci = list(CostItem.objects.filter(project=p, review_status="checked"))
    planned = sum((b.dec(c.planned_amount) for c in ci), Decimal("0")) if ci else b.dec(p.approved_budget)
    pos = list(PurchaseOrder.objects.filter(project=p, status__in=["approved", "partially_delivered", "delivered", "closed"]).prefetch_related("items"))
    committed = sum((b.dec(o.total) for o in pos), Decimal("0"))
    acts = list(Actual.objects.filter(project=p))
    actual = sum((b.dec(a.amount) for a in acts), Decimal("0"))
    cos = sum((b.dec(c.cost_delta) for c in ChangeOrder.objects.filter(project=p, status="approved")), Decimal("0"))
    by = {c: {"planned": Decimal("0"), "committed": Decimal("0"), "actual": Decimal("0")} for c in COST_CATEGORIES}
    for c in ci:
        by[c.category]["planned"] += b.dec(c.planned_amount)
    for o in pos:
        for i in o.items.all():
            cat = i.cost_item.category if i.cost_item_id else "equipment"
            by[cat]["committed"] += b.dec(i.line_total)
    for a in acts:
        by.setdefault(a.category, {"planned": Decimal("0"), "committed": Decimal("0"), "actual": Decimal("0")})["actual"] += b.dec(a.amount)
    burn = int(round(actual / planned * 100)) if planned > 0 else 0
    return {"planned": float(planned), "committed": float(committed), "actual": float(actual), "variance": float(planned - actual), "burnPct": burn,
            "forecast": float(max(committed, actual)), "byCategory": {k: {kk: float(vv) for kk, vv in v.items()} for k, v in by.items()},
            "changeOrders": float(cos), "retentionHeld": retention(p)["amountHeld"]}
