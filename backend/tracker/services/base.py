"""Shared helpers for the rule services (mirror MockApi private helpers)."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from datetime import timezone as dt_tz
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from .. import rbac
from ..errors import ApiError
from ..models import (ChronologyEvent, InventoryItem, Project, StockLocation, Threshold, User, Vendor)

ZERO = Decimal("0")
CENT = Decimal("0.01")


def dec(v: Any, default: Decimal = ZERO) -> Decimal:
    if v is None or v == "":
        return default
    if isinstance(v, Decimal):
        return v
    if isinstance(v, bool):
        return Decimal(int(v))
    try:
        return Decimal(str(v))
    except Exception:
        raise ApiError(f"Not a number: {v!r}", "invalid")


def round2(v: Any) -> Decimal:
    return dec(v).quantize(CENT, rounding=ROUND_HALF_UP)


def now() -> datetime:
    return timezone.now()


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.astimezone(dt_tz.utc).isoformat().replace("+00:00", "Z")


def to_dt(v: Any, label: str = "date") -> datetime:
    if isinstance(v, datetime):
        return v if timezone.is_aware(v) else timezone.make_aware(v, dt_tz.utc)
    if isinstance(v, date):
        return timezone.make_aware(datetime(v.year, v.month, v.day), dt_tz.utc)
    dt = parse_datetime(str(v)) if v else None
    if dt is None:
        d = parse_date(str(v)) if v else None
        if d is None:
            raise ApiError(f"{label} must be an ISO date-time", "invalid")
        dt = datetime(d.year, d.month, d.day)
    return dt if timezone.is_aware(dt) else timezone.make_aware(dt, dt_tz.utc)


def to_date(v: Any, label: str = "date") -> Optional[date]:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    d = parse_date(str(v)[:10])
    if d is None:
        raise ApiError(f"{label} must be YYYY-MM-DD", "invalid")
    return d


def fmt_date(v: Any) -> str:
    """'12 Sep 2026' for a YYYY-MM-DD string or date; 'none' when empty — for chronology lines."""
    if not v:
        return "none"
    try:
        return date.fromisoformat(str(v)[:10]).strftime("%d %b %Y")
    except ValueError:
        return str(v)


def fmt(n: Any) -> str:
    return "₦" + f"{int(dec(n).to_integral_value(rounding=ROUND_HALF_UP)):,}"


def clean(s: Any) -> str:
    return (s or "").strip() if isinstance(s, str) else ("" if s is None else str(s).strip())


def require(actor: User, perm: str, project_id: Optional[str] = None) -> None:
    if not rbac.can(actor, perm, project_id):
        raise ApiError(f'Your role does not allow "{perm}" here', "forbidden")


def get_or_404(model, pk: Optional[str], label: str):
    obj = model.objects.filter(pk=pk).first() if pk else None
    if obj is None:
        raise ApiError(f"{label} not found", "not_found")
    return obj


def get_user(uid: Optional[str]) -> User:
    return get_or_404(User, uid, "User")


def user_name(uid: Optional[str]) -> str:
    if not uid:
        return "—"
    u = User.objects.filter(pk=uid).first()
    return u.name if u else uid


def vendor_name(vid: Optional[str]) -> str:
    if not vid:
        return "—"
    v = Vendor.objects.filter(pk=vid).first()
    return v.name if v else vid


def item(item_id: Optional[str]) -> InventoryItem:
    return get_or_404(InventoryItem, item_id, "Item")


def item_name(item_id: str) -> str:
    it = InventoryItem.objects.filter(pk=item_id).first()
    return it.name if it else item_id


def location_name(loc_id: Optional[str]) -> str:
    if not loc_id:
        return "—"
    loc = StockLocation.objects.filter(pk=loc_id).first()
    return loc.name if loc else loc_id


def default_warehouse() -> StockLocation:
    loc = StockLocation.objects.filter(pk="loc_wh").first() or StockLocation.objects.filter(type="warehouse", is_active=True).order_by("id").first()
    if loc is None:
        raise ApiError("No warehouse location configured", "conflict")
    return loc


def location(loc_id: Optional[str]) -> StockLocation:
    return get_or_404(StockLocation, loc_id, "Location") if loc_id else default_warehouse()


def project(pid: Optional[str]) -> Project:
    return get_or_404(Project, pid, "Project")


def threshold_num(key: str, fallback: Any) -> Decimal:
    t = Threshold.objects.filter(pk=key).first()
    return dec(t.value) if t else dec(fallback)


def log(project_id: Optional[str], actor: User, event_type: str, summary: str, detail: Optional[str] = None, ref: Optional[dict] = None) -> None:
    """§4.2 append-only chronology; also bumps the project's updated_at/by (actor capture)."""
    if not project_id:
        return
    at = now()
    ChronologyEvent.objects.create(project_id=project_id, occurred_at=at, actor=actor, event_type=event_type, summary=summary[:400], detail=detail or None, ref=ref)
    Project.objects.filter(pk=project_id).update(updated_at=at, updated_by=actor)


def stamp(obj, actor: User, at: Optional[datetime] = None) -> None:
    at = at or now()
    obj.updated_at = at
    obj.updated_by = actor


def new_review(obj, actor: User, at: Optional[datetime] = None, version: int = 1) -> None:
    at = at or now()
    obj.review_status = "pending"
    obj.submitted_by = actor
    obj.submitted_at = at
    obj.review_version = version
    obj.checked_by = None
    obj.checked_at = None
    obj.check_comment = None


def plus_hours(dt: datetime, hours: Any) -> datetime:
    return dt + timedelta(hours=float(hours))


ID_RE = re.compile(r"^[a-z]+_[0-9a-f]{8}$")


def maybe_id(input: Optional[dict], model, prefix: str, key: str = "id") -> dict:
    """Client-supplied id (optimistic UI / offline replay). Only the backend format is accepted; must be unused. Returns kwargs for objects.create()."""
    v = (input or {}).get(key)
    if not v:
        return {}
    v = str(v)
    if not ID_RE.match(v) or not v.startswith(prefix + "_"):
        raise ApiError(f"Invalid id {v}", "invalid")
    if model.objects.filter(pk=v).exists():
        raise ApiError(f"{model.__name__} {v} already exists", "conflict")
    return {"id": v}
