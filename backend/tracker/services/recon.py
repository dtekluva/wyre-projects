"""Phase 2 — QuickBooks bill ↔ PO reconciliation (bills arrive by sync; matching is a Finance action)."""
from __future__ import annotations

from django.db import transaction

from ..errors import ApiError
from ..models import PurchaseOrder, QbBill, User
from . import base as b

ORDER = {"unmatched": 0, "suggested": 1, "matched": 2}


def list_qb_bills() -> list[dict]:
    out = []
    for bill in QbBill.objects.all().select_related("matched_po"):
        row = {"id": bill.id, "docNumber": bill.doc_number, "vendorName": bill.vendor_name, "txnDate": bill.txn_date.isoformat(), "dueDate": bill.due_date.isoformat() if bill.due_date else None,
               "totalAmount": float(bill.total_amount), "balance": float(bill.balance), "currency": bill.currency, "projectId": bill.project_id, "matchedPoId": bill.matched_po_id,
               "matchStatus": bill.match_status, "syncedAt": b.iso(bill.synced_at)}
        if bill.match_status == "matched" and bill.matched_po_id:
            po = bill.matched_po
            row.update({"poId": po.id, "poNumber": po.po_number, "confidence": "matched", "note": "Matched manually"}); out.append(row); continue
        cands = [p for p in PurchaseOrder.objects.filter(project_id=bill.project_id).exclude(status__in=["pending_approval", "rejected"]).select_related("vendor")
                 if p.vendor.name.lower() == bill.vendor_name.lower()] if bill.project_id else []
        exact = next((p for p in cands if abs(b.dec(p.total) - b.dec(bill.total_amount)) <= max(b.dec(1), b.dec(p.total) * b.dec("0.01"))), None)
        if exact:
            row.update({"poId": exact.id, "poNumber": exact.po_number, "confidence": "matched", "note": "Vendor + amount within 1%"})
        elif cands:
            c = cands[0]
            row.update({"poId": c.id, "poNumber": c.po_number, "confidence": "suggested", "note": f"Vendor matches {c.po_number} but amount differs by {b.fmt(abs(b.dec(c.total) - b.dec(bill.total_amount)))}"})
        else:
            row.update({"confidence": "unmatched", "note": "No PO from this vendor on the project" if bill.project_id else "Bill has no project"})
        out.append(row)
    return sorted(out, key=lambda r: ORDER[r["confidence"]])


@transaction.atomic
def match_bill(actor: User, bill_id: str, po_id: str) -> QbBill:
    b.require(actor, "recon.write")
    bill = QbBill.objects.filter(pk=bill_id).first(); po = PurchaseOrder.objects.filter(pk=po_id).first()
    if not bill or not po:
        raise ApiError("Bill or PO not found", "not_found")
    bill.matched_po = po; bill.match_status = "matched"
    if not bill.project_id:
        bill.project_id = po.project_id
    bill.save()
    b.log(po.project_id, actor, "reconciliation", f"QB bill {bill.doc_number} ({b.fmt(bill.total_amount)}) matched to {po.po_number}", None, {"model": "QbBill", "id": bill.id})
    return bill


@transaction.atomic
def unmatch_bill(actor: User, bill_id: str) -> QbBill:
    b.require(actor, "recon.write")
    bill = b.get_or_404(QbBill, bill_id, "Bill")
    bill.matched_po = None; bill.match_status = "unmatched"; bill.save()
    return bill
