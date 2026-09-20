"""Phase 2/3 — stock ledger with weighted-average cost, no negative stock, serialised assets, locations, transfers, counts (spec §4.15)."""
from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from typing import Optional

from django.db import transaction

from .. import rbac
from ..errors import ApiError
from ..constants import ASSET_TYPES
from ..models import Actual, Approval, Asset, InventoryItem, StockCount, StockLocation, StockMovement, User, Vendor
from . import base as b


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months; y = d.year + m // 12; m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def balances() -> list[dict]:
    """Replay every checked movement in order: item-level WAC, per-location quantities."""
    wac: dict[str, dict] = {}; loc: dict[tuple, Decimal] = {}; last: dict[str, str] = {}
    for m in StockMovement.objects.filter(review_status="checked").order_by("created_at", "id"):
        w = wac.setdefault(m.item_id, {"qty": Decimal("0"), "wac": Decimal("0")})
        q = b.dec(m.qty); uc = b.dec(m.unit_cost)

        def add(l: Optional[str], n: Decimal):
            if not l:
                return
            loc[(m.item_id, l)] = loc.get((m.item_id, l), Decimal("0")) + n

        t = m.movement_type
        if t in ("receipt", "return"):
            nq = w["qty"] + q
            w["wac"] = (w["qty"] * w["wac"] + q * uc) / nq if nq > 0 else uc
            w["qty"] = nq; add(m.location_to_id, q)
        elif t in ("issue", "write_off"):
            w["qty"] -= q; add(m.location_from_id, -q)
        elif t == "adjustment":
            if m.location_to_id:
                w["qty"] += q; add(m.location_to_id, q)
            else:
                w["qty"] -= q; add(m.location_from_id, -q)
        elif t == "transfer":
            add(m.location_from_id, -q); add(m.location_to_id, q)
        last[m.item_id] = b.iso(m.created_at)
    items = {i.id: i for i in InventoryItem.objects.all()}
    out = []
    for (item_id, location_id), qty in loc.items():
        w = wac[item_id]; it = items.get(item_id)
        out.append({"itemId": item_id, "locationId": location_id, "qtyOnHand": float(qty), "wacUnitCost": float(b.round2(w["wac"])), "value": float(b.round2(qty * w["wac"])),
                    "lastMovementAt": last.get(item_id), "belowReorder": qty <= b.dec(it.reorder_level if it else 0)})
    seen = {o["itemId"] for o in out}
    wh = b.default_warehouse().id
    for it in items.values():
        if it.id not in seen:
            out.append({"itemId": it.id, "locationId": wh, "qtyOnHand": 0.0, "wacUnitCost": 0.0, "value": 0.0, "lastMovementAt": None, "belowReorder": Decimal("0") <= b.dec(it.reorder_level)})
    return out


def balance_of(item_id: str, location_id: Optional[str] = None) -> dict:
    location_id = location_id or b.default_warehouse().id
    for bal in balances():
        if bal["itemId"] == item_id and bal["locationId"] == location_id:
            return bal
    return {"itemId": item_id, "locationId": location_id, "qtyOnHand": 0.0, "wacUnitCost": 0.0, "value": 0.0, "lastMovementAt": None, "belowReorder": True}


def wac_of(item_id: str) -> Decimal:
    for bal in balances():
        if bal["itemId"] == item_id:
            return b.dec(bal["wacUnitCost"])
    return Decimal("0")


def stock_value() -> dict:
    bs = balances(); by: dict[str, float] = {}
    cats = {i.id: i.category for i in InventoryItem.objects.all()}
    for bal in bs:
        by[cats.get(bal["itemId"], "other")] = by.get(cats.get(bal["itemId"], "other"), 0.0) + bal["value"]
    return {"total": float(b.round2(sum(x["value"] for x in bs))), "byCategory": by}


def available(item_id: str, location_id: Optional[str] = None) -> Decimal:
    """available = checked on-hand minus quantities reserved by pending issues / write-offs / transfers."""
    location_id = location_id or b.default_warehouse().id
    pend = sum((b.dec(m.qty) for m in StockMovement.objects.filter(item_id=item_id, review_status="pending", movement_type__in=["issue", "write_off", "transfer"], location_from_id=location_id)), Decimal("0"))
    return b.dec(balance_of(item_id, location_id)["qtyOnHand"]) - pend


def in_stock_serials(item_id: str, location_id: Optional[str] = None) -> list[str]:
    location_id = location_id or b.default_warehouse().id
    reserved = set()
    for m in StockMovement.objects.filter(review_status="pending", item_id=item_id):
        reserved.update(m.serials or [])
    return [a.serial for a in Asset.objects.filter(inventory_item_id=item_id, status="in_stock", location_id=location_id) if a.serial not in reserved]


def validate_serials(it: InventoryItem, qty: Decimal, serials, location_id: str) -> Optional[list[str]]:
    if not it.is_serialised:
        return None
    ser = [s.strip() for s in (serials or []) if s and s.strip()]
    n = int(qty)
    if len(ser) != n:
        raise ApiError(f"{it.name} is serialised — {n} serial{'s' if n > 1 else ''} required (got {len(ser)})", "invalid")
    ok = set(in_stock_serials(it.id, location_id))
    for s in ser:
        if s not in ok:
            raise ApiError(f"Serial {s} is not in stock at {b.location_name(location_id)} (or already reserved)", "invalid")
    return ser


def _pending_movement(actor: User, at, input: Optional[dict] = None, **fields) -> StockMovement:
    m = StockMovement(**b.maybe_id(input, StockMovement, "mv"), created_by=actor, created_at=at, **fields)
    b.new_review(m, actor, at)
    m.save()
    return m


@transaction.atomic
def issue_stock(actor: User, input: dict) -> StockMovement:
    project_id = input.get("projectId")
    if not rbac.can(actor, "inventory.write") and not rbac.can(actor, "inventory.request", project_id):
        raise ApiError("Only a Store Keeper (or a PM / Field Tech on the project) can issue stock", "forbidden")
    b.project(project_id)
    loc = b.location(input.get("locationId")); it = b.item(input.get("itemId")); qty = b.dec(input.get("qty"))
    if not qty > 0:
        raise ApiError("Quantity must be positive", "invalid")
    avail = available(it.id, loc.id)
    if qty > avail:
        raise ApiError(f"Only {avail.normalize():f} {it.unit} of {it.name} available at {loc.name} — no negative stock", "invalid")
    serials = validate_serials(it, qty, input.get("serials"), loc.id)
    wac = wac_of(it.id); at = b.now()
    m = _pending_movement(actor, at, input, item=it, movement_type="issue", qty=qty, location_from=loc, unit_cost=wac, total_cost=b.round2(qty * wac), project_id=project_id,
                          source_ref={"model": "PickList", "id": f"pl_{at.strftime('%Y%m%d%H%M%S%f')}", "label": b.clean(input.get("label")) or "Pick list"}, serials=serials)
    b.log(project_id, actor, "stock_movement", f"Issue requested — {it.name} × {qty.normalize():f} @ {b.fmt(wac)} (pending check)", None, {"model": "StockMovement", "id": m.id})
    return m


@transaction.atomic
def return_stock(actor: User, input: dict) -> StockMovement:
    project_id = input.get("projectId")
    if not rbac.can(actor, "inventory.write") and not rbac.can(actor, "inventory.request", project_id):
        raise ApiError("Not allowed", "forbidden")
    b.project(project_id)
    it = b.item(input.get("itemId")); qty = b.dec(input.get("qty"))
    if not qty > 0:
        raise ApiError("Quantity must be positive", "invalid")
    serials = None
    if it.is_serialised:
        serials = [s.strip() for s in (input.get("serials") or []) if s and s.strip()]
        if len(serials) != int(qty):
            raise ApiError(f"{int(qty)} serials required", "invalid")
        for s in serials:
            if not Asset.objects.filter(serial=s, project_id=project_id, status="installed").exists():
                raise ApiError(f"Serial {s} is not installed on this project", "invalid")
    wac = wac_of(it.id); at = b.now(); wh = b.default_warehouse()
    m = _pending_movement(actor, at, input, item=it, movement_type="return", qty=qty, location_to=wh, unit_cost=wac, total_cost=b.round2(qty * wac), project_id=project_id,
                          source_ref={"model": "Return", "id": f"rt_{at.strftime('%Y%m%d%H%M%S%f')}", "label": b.clean(input.get("reason")) or "Unused parts returned"}, serials=serials)
    b.log(project_id, actor, "stock_movement", f"Return requested — {it.name} × {qty.normalize():f} (pending check)", None, {"model": "StockMovement", "id": m.id})
    return m


def post_movement_effects(m: StockMovement, actor: User) -> None:
    """On check of an issue / return / transfer: assets move, project actual posts (issue = cost, return = credit)."""
    at = b.now(); it = m.item
    if m.movement_type == "receipt":
        # Direct receipt (no PO). The PO path builds its own assets in post_goods_receipt and arrives
        # already checked, so it never reaches here — this branch is only the without-a-PO route.
        for s_ in (m.serials or []):
            Asset.objects.get_or_create(
                serial=s_,
                defaults=dict(inventory_item=it, asset_type=it.category if it.category in ASSET_TYPES else "other",
                              make=it.make or "", model=it.model or it.name, unit_cost=m.unit_cost,
                              status="in_stock", location=m.location_to, created_at=at, created_by=m.created_by,
                              updated_at=at, updated_by=actor))
        return
    if m.movement_type == "issue":
        p = m.project
        for s in (m.serials or []):
            a = Asset.objects.filter(serial=s).first()
            if not a:
                continue
            a.status = "installed"; a.project_id = m.project_id; a.install_date = at; a.location = None; b.stamp(a, actor, at)
            if it.warranty_months:
                a.warranty_start = at.date(); a.warranty_end = add_months(at.date(), it.warranty_months)
            a.save()
        if m.project_id:
            Actual.objects.create(project_id=m.project_id, category="om" if p and p.stage >= 7 else "equipment", source="issue",
                                  source_ref={"model": "StockMovement", "id": m.id, "label": f"{it.name} × {b.dec(m.qty).normalize():f}"},
                                  amount=m.total_cost, date=at, attachment_ids=m.attachment_ids or [], created_by=actor)
    if m.movement_type == "transfer":
        for s in (m.serials or []):
            a = Asset.objects.filter(serial=s, status="in_stock").first()
            if a:
                a.location_id = m.location_to_id; b.stamp(a, actor, at); a.save()
    if m.movement_type == "return":
        for s in (m.serials or []):
            a = Asset.objects.filter(serial=s).first()
            if a:
                a.status = "in_stock"; a.project = None; a.location_id = m.location_to_id; b.stamp(a, actor, at); a.save()
        if m.project_id:
            Actual.objects.create(project_id=m.project_id, category="equipment", source="return",
                                  source_ref={"model": "StockMovement", "id": m.id, "label": f"{it.name} × {b.dec(m.qty).normalize():f} returned"},
                                  amount=-b.dec(m.total_cost), date=at, attachment_ids=[], created_by=actor)


@transaction.atomic
def write_off(actor: User, input: dict) -> StockMovement:
    b.require(actor, "inventory.write")
    it = b.item(input.get("itemId")); qty = b.dec(input.get("qty"))
    if not qty > 0:
        raise ApiError("Quantity must be positive", "invalid")
    reason = b.clean(input.get("reason"))
    if not reason:
        raise ApiError("A reason is required", "invalid")
    attachment_ids = list(input.get("attachmentIds") or [])
    if not attachment_ids:
        raise ApiError("A photo of the damaged / lost goods is required", "invalid")
    wh = b.default_warehouse(); avail = available(it.id, wh.id)
    if qty > avail:
        raise ApiError(f"Only {avail.normalize():f} available", "invalid")
    serials = validate_serials(it, qty, input.get("serials"), wh.id)
    wac = wac_of(it.id); amount = b.round2(qty * wac); at = b.now()
    required = ["finance", "director"] if amount >= b.threshold_num("writeoff.director_threshold", 500_000) else ["finance"]
    project_id = input.get("projectId") or None
    ap = Approval.objects.create(project_id=project_id, kind="write_off", title=f"Write-off · {qty.normalize():f} × {it.name} ({b.fmt(amount)})",
                                 description=f"{reason} {'Above director threshold → Finance + Director.' if len(required) > 1 else 'Below ₦500k → Finance only.'}",
                                 requested_by=actor, requested_at=at, required_roles=required, decisions=[], status="pending", amount=amount)
    m = _pending_movement(actor, at, input, item=it, movement_type="write_off", qty=qty, location_from=wh, unit_cost=wac, total_cost=amount, project_id=project_id, reason=reason,
                          serials=serials, attachment_ids=attachment_ids, approval=ap)
    b.log(project_id, actor, "stock_movement", f"Write-off requested — {it.name} × {qty.normalize():f}, {b.fmt(amount)} (awaiting {' + '.join(required)})", reason, {"model": "StockMovement", "id": m.id})
    return m


def list_locations():
    return StockLocation.objects.filter(is_active=True).order_by("id")


@transaction.atomic
def add_location(actor: User, input: dict) -> StockLocation:
    b.require(actor, "inventory.write")
    name = b.clean(input.get("name"))
    if not name:
        raise ApiError("Name is required", "invalid")
    if input.get("type") not in ("warehouse", "vehicle", "site", "quarantine"):
        raise ApiError("Unknown location type", "invalid")
    cust = b.get_user(input["custodianId"]) if input.get("custodianId") else None
    return StockLocation.objects.create(**b.maybe_id(input, StockLocation, "loc"), name=name, type=input["type"], custodian=cust, is_active=True)


@transaction.atomic
def transfer_stock(actor: User, input: dict) -> StockMovement:
    b.require(actor, "inventory.write")
    it = b.item(input.get("itemId")); qty = b.dec(input.get("qty"))
    if not qty > 0:
        raise ApiError("Quantity must be positive", "invalid")
    if input.get("fromId") == input.get("toId"):
        raise ApiError("Choose two different locations", "invalid")
    src = b.get_or_404(StockLocation, input.get("fromId"), "Location"); dst = b.get_or_404(StockLocation, input.get("toId"), "Location")
    avail = available(it.id, src.id)
    if qty > avail:
        raise ApiError(f"Only {avail.normalize():f} available at {src.name}", "invalid")
    serials = validate_serials(it, qty, input.get("serials"), src.id)
    wac = wac_of(it.id); at = b.now()
    return _pending_movement(actor, at, input, item=it, movement_type="transfer", qty=qty, location_from=src, location_to=dst, unit_cost=wac, total_cost=b.round2(qty * wac), serials=serials,
                             source_ref={"model": "Transfer", "id": f"tr_{at.strftime('%Y%m%d%H%M%S%f')}", "label": b.clean(input.get("label")) or f"{src.name} → {dst.name}"})


@transaction.atomic
def start_count(actor: User, location_id: str, input: Optional[dict] = None) -> StockCount:
    b.require(actor, "stockcount.create")
    loc = b.get_or_404(StockLocation, location_id, "Location")
    if StockCount.objects.filter(location=loc, status__in=["open", "submitted"]).exists():
        raise ApiError("A count is already open for this location", "conflict")
    at = b.now(); bal = {x["itemId"]: x["qtyOnHand"] for x in balances() if x["locationId"] == loc.id}
    lines = [{"itemId": i.id, "expectedQty": bal.get(i.id, 0.0), "countedQty": None, "variance": 0} for i in InventoryItem.objects.filter(is_active=True).order_by("id")]
    return StockCount.objects.create(**b.maybe_id(input, StockCount, "sc"), location=loc, count_date=at.date(), counted_by=actor, status="open", lines=lines, variance_value=0,
                                     created_at=at, created_by=actor, updated_at=at, updated_by=actor)


@transaction.atomic
def enter_count(actor: User, count_id: str, lines: list[dict]) -> StockCount:
    b.require(actor, "stockcount.create")
    sc = b.get_or_404(StockCount, count_id, "Count")
    if sc.status != "open":
        raise ApiError("Count is not open", "conflict")
    rows = {r["itemId"]: r for r in sc.lines}
    for l in lines:
        row = rows.get(l.get("itemId"))
        if not row:
            continue
        cq = l.get("countedQty")
        row["countedQty"] = None if cq is None else float(b.dec(cq))
        row["variance"] = 0 if cq is None else float(b.dec(cq) - b.dec(row["expectedQty"]))
        if l.get("note") is not None:
            row["note"] = l["note"]
        if l.get("attachmentId"):
            row["attachmentId"] = l["attachmentId"]
    sc.lines = list(rows.values()); b.stamp(sc, actor); sc.save()
    return sc


@transaction.atomic
def submit_count(actor: User, count_id: str) -> Approval:
    """Submit for Finance approval. Lines outside tolerance (or any variance on serialised items) need a note."""
    b.require(actor, "stockcount.create")
    sc = b.get_or_404(StockCount, count_id, "Count")
    if sc.status != "open":
        raise ApiError("Count is not open", "conflict")
    missing = [l for l in sc.lines if l.get("countedQty") is None]
    if missing:
        raise ApiError(f"{len(missing)} line{'s' if len(missing) > 1 else ''} not counted yet", "invalid")
    tol = b.threshold_num("stockcount.tolerance_pct", 2) / 100; value = Decimal("0")
    for l in sc.lines:
        var = b.dec(l.get("variance"))
        if not var:
            continue
        it = b.item(l["itemId"]); value += abs(var) * wac_of(it.id)
        over = True if it.is_serialised else abs(var) > max(Decimal("1"), b.dec(l["expectedQty"]) * tol)
        if over and not b.clean(l.get("note")):
            raise ApiError(f"{it.name}: variance {'+' if var > 0 else ''}{var.normalize():f} is outside tolerance — a note is required", "invalid")
    sc.variance_value = b.round2(value); at = b.now()
    n = len([l for l in sc.lines if b.dec(l.get("variance"))])
    ap = Approval.objects.create(kind="stock_count", title=f"Stock count {sc.count_date.isoformat()} · {sc.location.name}",
                                 description=f"{n} variance line{'' if n == 1 else 's'}, {b.fmt(sc.variance_value)} absolute value at WAC. Approval posts adjustments to the ledger.",
                                 requested_by=actor, requested_at=at, required_roles=["finance"], decisions=[], status="pending", amount=sc.variance_value)
    sc.approval = ap; sc.status = "submitted"; b.stamp(sc, actor, at); sc.save()
    return ap


# ---- reference data: the item catalogue and the vendor list ------------------------------------------
# Without these a fresh database cannot raise a single PO, so nothing can be received and nothing can
# enter the stock ledger. They were only ever created by seed_demo.

def add_vendor(actor: User, input: dict) -> Vendor:
    b.require(actor, "catalogue.manage")
    name = b.clean(input.get("name"))
    if not name:
        raise ApiError("Vendor name is required", "invalid")
    if Vendor.objects.filter(name__iexact=name).exists():
        raise ApiError(f"{name} is already on the vendor list", "conflict")
    return Vendor.objects.create(**b.maybe_id(input, Vendor, "v"), name=name,
                                 category=b.clean(input.get("category")) or None)


def add_item(actor: User, input: dict) -> InventoryItem:
    b.require(actor, "catalogue.manage")
    sku = b.clean(input.get("sku")).upper()
    name = b.clean(input.get("name"))
    category = b.clean(input.get("category"))
    if not sku:
        raise ApiError("SKU is required", "invalid")
    if not name:
        raise ApiError("Item name is required", "invalid")
    if category not in ASSET_TYPES:
        raise ApiError(f"Category must be one of: {', '.join(ASSET_TYPES)}", "invalid")
    if InventoryItem.objects.filter(sku__iexact=sku).exists():
        raise ApiError(f"SKU {sku} is already in use", "conflict")
    reorder_level = b.dec(input.get("reorderLevel"))
    reorder_qty = b.dec(input.get("reorderQty"))
    if reorder_level < 0 or reorder_qty < 0:
        raise ApiError("Reorder figures cannot be negative", "invalid")
    vendor = None
    if input.get("defaultVendorId"):
        vendor = b.get_or_404(Vendor, input["defaultVendorId"], "Vendor")
    months = input.get("warrantyMonths")
    return InventoryItem.objects.create(
        **b.maybe_id(input, InventoryItem, "it"), sku=sku, name=name, category=category,
        unit=b.clean(input.get("unit")) or "pcs", is_serialised=bool(input.get("isSerialised")),
        reorder_level=reorder_level, reorder_qty=reorder_qty, default_vendor=vendor, is_active=True,
        make=b.clean(input.get("make")) or None, model=b.clean(input.get("model")) or None,
        warranty_months=int(months) if months else None)


@transaction.atomic
def receive_stock(actor: User, input: dict) -> list[StockMovement]:
    """Take stock in without a purchase order — an opening balance, a donation, a transfer from another
    company, or goods that arrived against paperwork raised outside the system.

    Stock that appears from nowhere is exactly the movement worth controlling, so this is deliberately
    stricter than the PO path rather than looser: evidence is required, a reason is required, and every
    line lands as PENDING for somebody else to check. The PO route can auto-check because an approval
    already happened upstream; here nothing has been approved by anyone.
    """
    b.require(actor, "inventory.write")
    loc = b.location(input.get("locationId"))
    reason = b.clean(input.get("reason"))
    if not reason:
        raise ApiError("Say where this stock came from — a delivery note number, or 'opening balance'", "invalid")
    attachment_ids = [a for a in (input.get("attachmentIds") or []) if a]
    if not attachment_ids:
        raise ApiError("Attach the delivery note or count sheet — stock cannot appear without paperwork", "invalid")

    raw = [l for l in (input.get("lines") or []) if l and l.get("itemId")]
    if not raw:
        raise ApiError("Add at least one line", "invalid")

    at = b.now()
    out: list[StockMovement] = []
    seen_serials: set[str] = set()
    for line in raw:
        it = b.item(line.get("itemId"))
        qty = b.dec(line.get("qty"))
        if not qty > 0:
            raise ApiError(f"{it.name}: quantity must be positive", "invalid")
        unit_cost = b.dec(line.get("unitCost"))
        if unit_cost < 0:
            raise ApiError(f"{it.name}: unit cost cannot be negative", "invalid")

        serials = [x.strip() for x in (line.get("serials") or []) if x and x.strip()]
        if it.is_serialised:
            # Incoming serials are NEW, so validate_serials() is the wrong check — that one asserts they
            # are already in stock. What matters here is one per unit, and never a duplicate.
            if len(serials) != int(qty):
                raise ApiError(f"{it.name} is serialised — {int(qty)} serial number{'s' if qty != 1 else ''} required (got {len(serials)})", "invalid")
            if len(set(serials)) != len(serials):
                raise ApiError(f"{it.name}: the same serial appears twice", "invalid")
            clash = seen_serials.intersection(serials)
            if clash:
                raise ApiError(f"Serial {sorted(clash)[0]} appears on more than one line", "invalid")
            seen_serials.update(serials)
            existing = Asset.objects.filter(serial__in=serials).values_list("serial", flat=True).first()
            if existing:
                raise ApiError(f"Serial {existing} is already in the asset register", "conflict")
        elif serials:
            raise ApiError(f"{it.name} is not serialised — remove the serial numbers", "invalid")

        m = _pending_movement(actor, at, None, item=it, movement_type="receipt", qty=qty, location_to=loc,
                              unit_cost=unit_cost, total_cost=b.round2(qty * unit_cost), serials=serials or None,
                              attachment_ids=attachment_ids,
                              source_ref={"model": "DirectReceipt", "label": reason})
        out.append(m)
    return out
