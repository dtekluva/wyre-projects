"""VAT and client billing.

The contract is written NET of VAT; VAT and the gross are derived from it, never typed. What we bill the client
is a ClientInvoice; what comes in is a receipt against it; where its VAT stands is a status with evidence.
Mirrors packages/api/src/client.ts (vatBlock, setContractTerms, raiseInvoice, recordReceipt, settleVat).
"""
from __future__ import annotations

import re
import secrets
from decimal import Decimal

from django.db import transaction

from ..errors import ApiError
from ..models import Attachment, ClientInvoice, Project, User
from . import base as b

VAT_TREATMENTS = {"standard": "Standard — we collect and remit", "withheld_by_client": "Withheld by client — they remit to FIRS", "exempt": "Exempt / zero-rated"}
VAT_SETTLED = ("withheld_by_client", "remitted")
VAT_STATUSES = ("outstanding", "collected", "withheld_by_client", "remitted")
Q = Decimal("0.01")


def vat_on(net: Decimal, rate: Decimal, treatment: str) -> Decimal:
    if treatment == "exempt" or rate is None or rate <= 0:
        return Decimal("0.00")
    return (Decimal(net) * Decimal(rate) / 100).quantize(Q)


def vat_block(p: Project, change_orders: Decimal) -> dict:
    """The base for VAT is the NET contract plus approved change orders. Everything gross is derived from it."""
    contract_net = b.dec(p.contract_value_net) + b.dec(change_orders)
    vat_due = vat_on(contract_net, b.dec(p.vat_rate), p.vat_treatment)
    invs = list(ClientInvoice.objects.filter(project=p, review_status="checked"))
    invoiced_net = sum((b.dec(i.net_amount) for i in invs), Decimal("0")); invoiced_vat = sum((b.dec(i.vat_amount) for i in invs), Decimal("0"))
    received = sum((b.dec(r.get("amount", 0)) for i in invs for r in (i.receipts or [])), Decimal("0"))
    vat_collected = sum((b.dec(i.vat_amount) for i in invs if i.vat_status == "collected"), Decimal("0"))
    vat_settled = sum((b.dec(i.vat_amount) for i in invs if i.vat_status in VAT_SETTLED), Decimal("0"))
    f = lambda x: float(Decimal(x).quantize(Q))  # noqa: E731
    return {"contractNet": f(contract_net), "vatRate": float(p.vat_rate), "vatDue": f(vat_due), "contractGross": f(contract_net + vat_due),
            "invoicedNet": f(invoiced_net), "invoicedVat": f(invoiced_vat), "received": f(received),
            "vatCollected": f(vat_collected), "vatSettled": f(vat_settled), "vatOutstanding": f(max(Decimal("0"), vat_due - vat_settled))}


def _rate(v, current) -> Decimal:
    if v in (None, ""):
        return b.dec(current)
    r = b.dec(v)
    if r < 0 or r > 100:
        raise ApiError("VAT rate must be between 0 and 100 %", "invalid")
    return r


def _treatment(v, current: str) -> str:
    t = current if v in (None, "") else str(v)
    if t not in VAT_TREATMENTS:
        raise ApiError("Unknown VAT treatment", "invalid")
    return t


def _files_on_project(ids, project_id: str) -> list[str]:
    ids = [str(x) for x in (ids or []) if x]
    if ids:
        valid = set(Attachment.objects.filter(pk__in=ids, project_id=project_id).values_list("id", flat=True))
        if [x for x in ids if x not in valid]:
            raise ApiError("File is not on this project", "invalid")
    return ids


@transaction.atomic
def set_contract_terms(actor: User, project_id: str, input: dict) -> Project:
    """Correct the contract's commercial terms. Rare — a data fix, not a change order — so Director or Finance, and logged."""
    b.require(actor, "contract.manage", project_id)
    p = b.project(project_id)
    net = b.dec(input.get("contractValueNet"))
    if net < 0:
        raise ApiError("Contract value must be zero or more", "invalid")
    rate = _rate(input.get("vatRate"), p.vat_rate); treatment = _treatment(input.get("vatTreatment"), p.vat_treatment)
    if b.dec(p.approved_budget) > net and net > 0:
        raise ApiError("Approved budget cannot exceed the net contract value", "invalid")
    was = f"{b.fmt(p.contract_value_net)} net · VAT {p.vat_rate}% · {VAT_TREATMENTS[p.vat_treatment]}"
    p.contract_value_net = b.round2(net); p.vat_rate = rate; p.vat_treatment = treatment
    b.stamp(p, actor, b.now()); p.save()
    b.log(project_id, actor, "contract_updated", f"Contract terms set — {b.fmt(p.contract_value_net)} net · VAT {rate}% ({b.fmt(p.vat_amount)}) · {VAT_TREATMENTS[treatment]}", f"was {was}", {"model": "Project", "id": p.id})
    return p


@transaction.atomic
def raise_invoice(actor: User, project_id: str, input: dict) -> ClientInvoice:
    """What we billed the client. VAT defaults to the project rate; the invoice enters review like any other input."""
    b.require(actor, "billing.manage", project_id)
    p = b.project(project_id)
    no = b.clean(input.get("invoiceNumber"))
    if not no:
        raise ApiError("Invoice number is required", "invalid")
    if ClientInvoice.objects.filter(project=p, invoice_number__iexact=no).exists():
        raise ApiError(f"Invoice {no} already exists on this project", "conflict")
    net = b.dec(input.get("netAmount"))
    if net <= 0:
        raise ApiError("Net amount must be more than zero", "invalid")
    vat = vat_on(net, b.dec(p.vat_rate), p.vat_treatment) if input.get("vatAmount") in (None, "") else b.round2(b.dec(input.get("vatAmount")))
    if vat < 0:
        raise ApiError("VAT amount cannot be negative", "invalid")
    issued = str(input.get("issuedAt") or b.now().date().isoformat())
    if not re.match(r"^\d{4}-\d{2}-\d{2}", issued):
        raise ApiError("Invoice date must be YYYY-MM-DD", "invalid")
    ids = _files_on_project(input.get("attachmentIds"), project_id)
    at = b.now()
    inv = ClientInvoice.objects.create(**b.maybe_id(input, ClientInvoice, "inv"), project=p, invoice_number=no, issued_at=issued[:10], description=b.clean(input.get("description")) or "",
                                       net_amount=b.round2(net), vat_amount=vat, gross_amount=b.round2(net + vat), receipts=[], vat_status="outstanding", vat_evidence_ids=[], attachment_ids=ids,
                                       created_at=at, created_by=actor, updated_at=at, updated_by=actor, review_status="pending", submitted_by=actor, submitted_at=at, review_version=1)
    b.log(project_id, actor, "invoice", f"Invoice {no} raised — {b.fmt(net)} net + {b.fmt(vat)} VAT (pending check)", inv.description or None, {"model": "ClientInvoice", "id": inv.id})
    return inv


@transaction.atomic
def record_receipt(actor: User, invoice_id: str, input: dict) -> ClientInvoice:
    """Money in against a checked invoice. Cannot exceed the gross — an overpayment is a different conversation."""
    inv = b.get_or_404(ClientInvoice, invoice_id, "Invoice")
    b.require(actor, "billing.manage", inv.project_id)
    if inv.review_status != "checked":
        raise ApiError("The invoice must be checked before receipts are recorded against it", "conflict")
    amount = b.dec(input.get("amount"))
    if amount <= 0:
        raise ApiError("Amount must be more than zero", "invalid")
    got = sum((b.dec(r.get("amount", 0)) for r in (inv.receipts or [])), Decimal("0"))
    if got + amount > b.dec(inv.gross_amount) + Decimal("0.005"):
        raise ApiError(f"Only {b.fmt(b.dec(inv.gross_amount) - got)} is outstanding on {inv.invoice_number}", "invalid")
    ids = _files_on_project(input.get("attachmentIds"), inv.project_id)
    at = b.now()
    r = {"id": input.get("receiptId") or f"rcpt_{secrets.token_hex(4)}", "date": str(input.get("date") or at.date().isoformat())[:10], "amount": float(b.round2(amount)),
         "note": b.clean(input.get("note")) or None, "attachmentIds": ids, "recordedBy": actor.id, "recordedAt": b.iso(at)}
    inv.receipts = list(inv.receipts or []) + [r]; b.stamp(inv, actor, at); inv.save()
    full = got + amount >= b.dec(inv.gross_amount)
    b.log(inv.project_id, actor, "invoice", f"{b.fmt(amount)} received against {inv.invoice_number}{' — paid in full' if full else ''}", r["note"], {"model": "ClientInvoice", "id": inv.id})
    return inv


@transaction.atomic
def settle_vat(actor: User, invoice_id: str, input: dict) -> ClientInvoice:
    """Where the invoice's VAT stands. Settling with FIRS — withheld by the client, or remitted by us — needs the paper that proves it."""
    inv = b.get_or_404(ClientInvoice, invoice_id, "Invoice")
    b.require(actor, "billing.manage", inv.project_id)
    if inv.review_status != "checked":
        raise ApiError("The invoice must be checked first", "conflict")
    status = str(input.get("status") or "")
    if status not in VAT_STATUSES or status == "outstanding":
        raise ApiError("Choose how the VAT was settled", "invalid")
    if inv.vat_status in VAT_SETTLED:
        raise ApiError(f"VAT on {inv.invoice_number} is already settled ({inv.vat_status.replace('_', ' ')})", "conflict")
    ids = _files_on_project(input.get("attachmentIds"), inv.project_id)
    if status in VAT_SETTLED and not ids:
        raise ApiError("Attach the FIRS receipt or the client's VAT credit note", "invalid")
    at = b.now()
    inv.vat_status = status; inv.vat_settled_at = str(input.get("date") or at.date().isoformat())[:10]; inv.vat_settled_by = actor
    inv.vat_note = b.clean(input.get("note")) or None; inv.vat_evidence_ids = list(inv.vat_evidence_ids or []) + ids
    b.stamp(inv, actor, at); inv.save()
    b.log(inv.project_id, actor, "invoice", f"VAT on {inv.invoice_number} ({b.fmt(inv.vat_amount)}) — {status.replace('_', ' ')}", inv.vat_note, {"model": "ClientInvoice", "id": inv.id})
    return inv
