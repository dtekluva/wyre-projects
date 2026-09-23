"""§4.14 void — mirrors MockApi.voidRecord. Wrong data stops counting everywhere but stays on the record."""
from __future__ import annotations

from django.db import transaction

from ..constants import MOVEMENT_LABEL, VISIT_TYPE_LABEL
from ..errors import ApiError
from ..models import Actual, Approval, Asset, Attachment, ClientInvoice, CostItem, Document, GoodsReceipt, Issue, PurchaseOrder, SiteVisit, StockMovement, User, VatPayment
from . import base as b

KINDS = {"document": Document, "attachment": Attachment, "stock_movement": StockMovement, "cost_item": CostItem, "client_invoice": ClientInvoice, "vat_payment": VatPayment,
         "purchase_order": PurchaseOrder, "goods_receipt": GoodsReceipt, "site_visit": SiteVisit, "issue": Issue}
MODEL_NAME = {"document": "Document", "attachment": "Attachment", "stock_movement": "StockMovement", "cost_item": "CostItem", "client_invoice": "ClientInvoice", "vat_payment": "VatPayment",
              "purchase_order": "PurchaseOrder", "goods_receipt": "GoodsReceipt", "site_visit": "SiteVisit", "issue": "Issue"}


def _cascade_attachments(ids, actor: User, at, why: str) -> None:
    """The files that belonged to a removed record go with it."""
    for a in Attachment.objects.filter(pk__in=[x for x in (ids or []) if x], voided_at__isnull=True):
        a.voided_at = at; a.voided_by = actor; a.void_reason = why; a.save(update_fields=["voided_at", "voided_by", "void_reason"])


def _unwind_movement(m: StockMovement, actor: User, at, why: str) -> None:
    """Unwind one checked movement's effects and mark it removed. Shared by the movement, receipt and visit paths."""
    from . import stock as stock_svc
    if m.review_status == "checked":
        if m.movement_type == "receipt":
            for serial in (m.serials or []):
                a = Asset.objects.filter(serial=serial).first()
                if not a:
                    continue
                if a.status != "in_stock":
                    raise ApiError(f"Serial {serial} has since been {a.status.replace('_', ' ')} — remove that first", "conflict")
                a.delete()
        if m.movement_type == "issue":
            for serial in (m.serials or []):
                a = Asset.objects.filter(serial=serial).first()
                if a:
                    a.status = "in_stock"; a.project = None; a.install_date = None; a.location_id = m.location_from_id; b.stamp(a, actor, at); a.save()
        Actual.objects.filter(source_ref__model="StockMovement", source_ref__id=m.id).delete()
    m.voided_at = at; m.voided_by = actor; m.void_reason = why
    m.save(update_fields=["voided_at", "voided_by", "void_reason"])
    bal = stock_svc.balance_of(m.item_id, m.location_to_id or m.location_from_id)["qtyOnHand"]
    if bal < 0:
        raise ApiError(f"Removing this would leave {m.item.name} at {bal} — remove the later issues first", "conflict")


def _unwind_goods_receipt(g: GoodsReceipt, actor: User, at, why: str) -> None:
    """A checked goods receipt: its movements and assets go, the cost it posted goes, the PO's received quantities and status step back."""
    for m in StockMovement.objects.filter(source_ref__model="GoodsReceipt", source_ref__id=g.id, voided_at__isnull=True):
        _unwind_movement(m, actor, at, f"removed with {g.grn_number}: {why}")
    Actual.objects.filter(source_ref__model="GoodsReceipt", source_ref__id=g.id).delete()
    po = g.po
    for l in (g.lines or []):
        it = po.items.filter(pk=l.get("purchaseItemId")).first()
        if it:
            it.qty_received = max(b.dec(0), b.dec(it.qty_received) - b.dec(l.get("qty", 0))); it.save(update_fields=["qty_received"])
    items = list(po.items.all())
    po.status = "delivered" if all(b.dec(i.qty_received) >= b.dec(i.qty) for i in items) else "partially_delivered" if any(b.dec(i.qty_received) > 0 for i in items) else "approved"
    b.stamp(po, actor, at); po.save()


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
    elif kind == "purchase_order":
        label = f"purchase order {rec.po_number}"
        if GoodsReceipt.objects.filter(po=rec, voided_at__isnull=True).exists():
            raise ApiError(f"{rec.po_number} has goods receipts against it — remove those first", "conflict")
        Approval.objects.filter(pk=rec.approval_id, status="pending").update(status="cancelled")
    elif kind == "goods_receipt":
        label = f"goods receipt {rec.grn_number}"
        if rec.review_status == "checked":
            _unwind_goods_receipt(rec, actor, at, why)
        _cascade_attachments(rec.attachment_ids, actor, at, f"removed with {rec.grn_number}")
    elif kind == "site_visit":
        label = f"{VISIT_TYPE_LABEL[rec.visit_type]} visit {b.iso(rec.started_at)[:10]}"
        for m in StockMovement.objects.filter(source_ref__model="SiteVisit", source_ref__id=rec.id, voided_at__isnull=True):
            _unwind_movement(m, actor, at, "removed with the visit")
        Actual.objects.filter(source_ref__model="SiteVisit", source_ref__id=rec.id).delete()
        sig = (rec.client_signoff or {}).get("signatureAttachmentId")
        _cascade_attachments(list(rec.attachment_ids or []) + ([sig] if sig else []), actor, at, "removed with the visit")
        Issue.objects.filter(linked_visit=rec).update(linked_visit=None)
    elif kind == "issue":
        label = f"issue {rec.title}"
        Actual.objects.filter(source_ref__model="Issue", source_ref__id=rec.id).delete()
        _cascade_attachments(list(rec.before_attachment_ids or []) + list(rec.attachment_ids or []) + list(rec.after_attachment_ids or []), actor, at, "removed with the issue")
    else:
        m = rec
        label = f"{MOVEMENT_LABEL[m.movement_type]} · {m.item.name} × {b.dec(m.qty).normalize():f}"
        src = (m.source_ref or {}).get("model")
        if src in ("GoodsReceipt", "SiteVisit"):
            raise ApiError(f"This movement was posted by a {'goods receipt' if src == 'GoodsReceipt' else 'site visit'} — remove that record instead", "conflict")
        _unwind_movement(m, actor, at, why)
        b.log(project_id, actor, "void", f"Voided {label} — {why}", None, {"model": "StockMovement", "id": id})
        return
    rec.voided_at = at; rec.voided_by = actor; rec.void_reason = why
    rec.save(update_fields=["voided_at", "voided_by", "void_reason"])
    b.log(project_id, actor, "void", f"Voided {label} — {why}", None, {"model": MODEL_NAME[kind], "id": id})
