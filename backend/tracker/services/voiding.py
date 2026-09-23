"""§4.14 void — mirrors MockApi.voidRecord. Wrong data stops counting everywhere but stays on the record."""
from __future__ import annotations

from django.db import transaction

from ..constants import MOVEMENT_LABEL
from ..errors import ApiError
from ..models import Actual, Asset, Attachment, ClientInvoice, CostItem, Document, StockMovement, User, VatPayment
from . import base as b

KINDS = {"document": Document, "attachment": Attachment, "stock_movement": StockMovement, "cost_item": CostItem, "client_invoice": ClientInvoice, "vat_payment": VatPayment}
MODEL_NAME = {"document": "Document", "attachment": "Attachment", "stock_movement": "StockMovement", "cost_item": "CostItem", "client_invoice": "ClientInvoice", "vat_payment": "VatPayment"}


@transaction.atomic
def void_record(actor: User, kind: str, id: str, reason: str) -> None:
    model = KINDS.get(kind)
    if model is None:
        raise ApiError("That kind of record cannot be voided", "invalid")
    rec = b.get_or_404(model, id, "Record")
    project_id = getattr(rec, "project_id", None)
    b.require(actor, "record.void", project_id)
    why = b.clean(reason)
    if not why:
        raise ApiError("A reason is required to void a record", "invalid")
    if rec.voided_at:
        raise ApiError("Already voided", "conflict")
    at = b.now()
    if kind == "document":
        label = f"document {rec.title}"
    elif kind == "attachment":
        label = f"file {rec.caption or rec.file_name}"
    elif kind == "cost_item":
        label = f"budget line {rec.label}"
    elif kind == "client_invoice":
        label = f"invoice {rec.invoice_number}"
    elif kind == "vat_payment":
        label = f"VAT payment {b.fmt(rec.amount)}"
    else:
        m = rec
        label = f"{MOVEMENT_LABEL[m.movement_type]} · {m.item.name} × {b.dec(m.qty).normalize():f}"
        src = (m.source_ref or {}).get("model")
        if src in ("GoodsReceipt", "SiteVisit"):
            raise ApiError(f"This movement was posted by a {'goods receipt' if src == 'GoodsReceipt' else 'site visit'} — void that record instead", "conflict")
        if m.review_status == "checked":
            # unwind what the check posted
            if m.movement_type == "receipt":
                for serial in (m.serials or []):
                    a = Asset.objects.filter(serial=serial).first()
                    if not a:
                        continue
                    if a.status != "in_stock":
                        raise ApiError(f"Serial {serial} from this receipt has since been {a.status.replace('_', ' ')} — void that first", "conflict")
                    a.delete()
            if m.movement_type == "issue":
                for serial in (m.serials or []):
                    a = Asset.objects.filter(serial=serial).first()
                    if a:
                        a.status = "in_stock"; a.project = None; a.install_date = None; a.location_id = m.location_from_id; b.stamp(a, actor, at); a.save()
            Actual.objects.filter(source_ref__model="StockMovement", source_ref__id=m.id).delete()
            # the balance the void leaves behind must still be non-negative
            from . import stock as stock_svc
            m.voided_at = at; m.save(update_fields=["voided_at"])
            try:
                after = stock_svc.balance_of(m.item_id, m.location_to_id or m.location_from_id)["qtyOnHand"]
            finally:
                m.voided_at = None; m.save(update_fields=["voided_at"])
            if after < 0:
                raise ApiError(f"Voiding this would leave {m.item.name} at {after} — void the later issues first", "conflict")
    rec.voided_at = at; rec.voided_by = actor; rec.void_reason = why
    rec.save(update_fields=["voided_at", "voided_by", "void_reason"])
    b.log(project_id, actor, "void", f"Voided {label} — {why}", None, {"model": MODEL_NAME[kind], "id": id})
