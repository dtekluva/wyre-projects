"""Tools and PPE: bought for the team rather than for a project, tracked by who holds them.

A holder is a StockLocation of type "person" — created the first time something is handed to them — so the
existing transfer machinery, balances, serials and checks do all the work. Mirrors MockApi (assignTool etc.).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction

from ..constants import TOOL_CATEGORIES
from ..errors import ApiError
from ..models import InventoryItem, StockLocation, StockMovement, User
from . import base as b
from . import stock


def holder_location(user_id: str) -> StockLocation:
    u = b.get_user(user_id)
    loc, _ = StockLocation.objects.get_or_create(id=f"loc_person_{u.id}", defaults={"name": u.name, "type": "person", "custodian": u, "is_active": True})
    return loc


def is_tool(item: InventoryItem) -> bool:
    return item.category in TOOL_CATEGORIES


def _main() -> StockLocation:
    return b.default_warehouse()


@transaction.atomic
def assign_tool(actor: User, input: dict) -> StockMovement:
    """Hand a tool from the store to a person. Checked like any transfer; value unchanged."""
    b.require(actor, "tools.assign")
    it = b.item(input.get("itemId"))
    if not is_tool(it):
        raise ApiError("Only tools and PPE are handed to people — issue project stock to a project instead", "invalid")
    to = holder_location(input.get("userId")); note = b.clean(input.get("note"))
    return stock.move_stock(actor, {"itemId": it.id, "qty": input.get("qty"), "serials": input.get("serials"), "fromId": _main().id, "toId": to.id,
                                    "label": f"Handed to {to.name}" + (f" — {note}" if note else "")})


@transaction.atomic
def hand_over_tool(actor: User, input: dict) -> StockMovement:
    b.require(actor, "tools.assign")
    it = b.item(input.get("itemId"))
    if not is_tool(it):
        raise ApiError("Only tools and PPE are handed between people", "invalid")
    frm = holder_location(input.get("fromUserId")); to = holder_location(input.get("toUserId")); note = b.clean(input.get("note"))
    return stock.move_stock(actor, {"itemId": it.id, "qty": input.get("qty"), "serials": input.get("serials"), "fromId": frm.id, "toId": to.id,
                                    "label": f"{frm.name} → {to.name}" + (f" — {note}" if note else "")})


@transaction.atomic
def return_tool(actor: User, input: dict) -> StockMovement:
    b.require(actor, "tools.assign")
    it = b.item(input.get("itemId"))
    frm = holder_location(input.get("userId")); note = b.clean(input.get("note"))
    return stock.move_stock(actor, {"itemId": it.id, "qty": input.get("qty"), "serials": input.get("serials"), "fromId": frm.id, "toId": _main().id,
                                    "label": f"Returned by {frm.name}" + (f" — {note}" if note else "")})


def tools_spend(months: int = 12) -> dict:
    """What the team has spent on tools and PPE: checked receipts by month and by category. No budget by design."""
    tool_ids = set(InventoryItem.objects.filter(category__in=TOOL_CATEGORIES).values_list("id", flat=True))
    rc = [m for m in StockMovement.objects.filter(movement_type="receipt", review_status="checked", voided_at__isnull=True, item_id__in=tool_ids).select_related("item")]
    today = b.now().date(); keys = []
    y, mo = today.year, today.month
    for i in range(months - 1, -1, -1):
        yy, mm = y, mo - i
        while mm <= 0:
            mm += 12; yy -= 1
        keys.append(f"{yy}-{mm:02d}")
    q = lambda x: float(Decimal(x).quantize(Decimal("0.01")))  # noqa: E731
    by_month = [{"month": k, "amount": q(sum((b.dec(m.total_cost) for m in rc if b.iso(m.created_at)[:7] == k), Decimal("0")))} for k in keys]
    by_cat = [{"category": c, "amount": q(sum((b.dec(m.total_cost) for m in rc if m.item.category == c), Decimal("0")))} for c in TOOL_CATEGORIES]
    total = q(sum((b.dec(m.total_cost) for m in rc), Decimal("0")))
    ytd = q(sum((b.dec(m.total_cost) for m in rc if b.iso(m.created_at)[:4] == str(today.year)), Decimal("0")))
    return {"byMonth": by_month, "byCategory": by_cat, "total": total, "thisMonth": by_month[-1]["amount"] if by_month else 0, "ytd": ytd, "count": len(rc)}
