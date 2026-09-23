"""Model → JSON in exactly the shape of packages/api/src/types.ts (camelCase, ISO dates, floats)."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any, Optional

from . import rbac
from .models import (ClientInvoice, VatPayment, Extraction, Actual, Approval, Asset, Attachment, ChangeOrder, ChronologyEvent, CommissioningRecord, CostItem, Document, GoodsReceipt, HseIncident, Notification,
                     InventoryItem, Issue, Project, ProjectMembership, PurchaseOrder, QbBill, Retention, SiteVisit, StockCount, StockLocation, StockMovement,
                     Threshold, User, Vendor, WarrantyClaim)
from .services.base import iso
from .services.projects import visible_project_ids


def num(v: Any) -> Optional[float]:
    if v is None:
        return None
    return float(v) if isinstance(v, Decimal) else v


def d8(v) -> Optional[str]:
    return v.isoformat() if v else None


def url(f) -> Optional[str]:
    try:
        return f.url if f else None
    except Exception:
        return None


def audit(o) -> dict:
    return {"createdAt": iso(o.created_at), "createdBy": o.created_by_id, "updatedAt": iso(o.updated_at), "updatedBy": o.updated_by_id}


def review(o) -> dict:
    return {"reviewStatus": o.review_status, "submittedBy": o.submitted_by_id, "submittedAt": iso(o.submitted_at), "checkedBy": o.checked_by_id,
            "checkedAt": iso(o.checked_at), "checkComment": o.check_comment, "reviewVersion": o.review_version}


def user(u: User) -> dict:
    # "invited" = the account exists but has an unusable password, so the person has never followed
    # their link. The admin screen uses it to offer resend/revoke.
    return {"id": u.id, "name": u.name or u.username, "email": u.email, "roles": u.role_codes(),
            "initials": u.initials, "username": u.username,
            "status": "disabled" if not u.is_active else ("active" if u.has_usable_password() else "invited")}


def project(p: Project, open_issues: Optional[dict] = None) -> dict:
    oi = (open_issues or {}).get(p.id) or {}
    return {"id": p.id, "code": p.code, "name": p.name, "clientName": p.client_name, "branchName": p.branch_name, "location": p.location, "projectType": p.project_type,
            "systemCapacityKwp": num(p.system_capacity_kwp), "stage": p.stage, "rag": p.rag, "ragReason": p.rag_reason, "pmId": p.pm_id, "leadEngineerId": p.lead_engineer_id, "commissioningAssigneeId": p.commissioning_assignee_id,
            "contractValueNet": num(p.contract_value_net), "vatRate": num(p.vat_rate), "vatTreatment": p.vat_treatment, "vatAmount": num(p.vat_amount), "contractValue": num(p.contract_value), "contractStatus": p.contract_status, "contractReceivedOn": d8(p.contract_received_on), "contractReceivedBy": p.contract_received_by_id, "contractDocumentId": p.contract_document_id, "approvedBudget": num(p.approved_budget), "committed": num(p.committed), "actual": num(p.actual),
            "stagePlanned": {str(k): v for k, v in (p.stage_planned or {}).items()}, "stageActual": {str(k): v for k, v in (p.stage_actual or {}).items()},
            "defectsLiabilityEnd": d8(p.defects_liability_end), "retentionPercent": num(p.retention_percent),
            "openIssues": {"critical": oi.get("critical", 0), "high": oi.get("high", 0), "medium": oi.get("medium", 0), "low": oi.get("low", 0)}, **audit(p)}


def membership(m: ProjectMembership) -> dict:
    return {"id": m.id, "projectId": m.project_id, "userId": m.user_id, "role": m.role, "grantedBy": m.granted_by_id, "grantedAt": iso(m.granted_at), "revokedAt": iso(m.revoked_at)}


def event(e: ChronologyEvent) -> dict:
    return {"id": e.id, "projectId": e.project_id, "occurredAt": iso(e.occurred_at), "actorId": e.actor_id, "eventType": e.event_type, "summary": e.summary, "detail": e.detail,
            "ref": e.ref, "before": e.before, "after": e.after}


def document(d: Document) -> dict:
    return {"id": d.id, "projectId": d.project_id, "docType": d.doc_type, "title": d.title, "status": d.status, "issuedAt": iso(d.issued_at), "expiresAt": d8(d.expires_at),
            "issuer": d.issuer, "version": d.version, "fileName": d.file_name, "sizeBytes": d.size_bytes, "sha256": d.sha256, "url": url(d.file), **audit(d), **review(d), **void(d)}


def attachment(a: Attachment) -> dict:
    return {"id": a.id, "projectId": a.project_id or "", "fileName": a.file_name, "mime": a.mime, "sizeBytes": a.size_bytes, "kind": a.kind, "capturedAt": iso(a.captured_at),
            "gps": a.gps, "sha256": a.sha256, "uploadedBy": a.uploaded_by_id, "uploadedAt": iso(a.uploaded_at), "linkedTo": a.linked_to, "caption": a.caption, "url": url(a.file), **review(a), **void(a)}


def approval(a: Approval) -> dict:
    return {"id": a.id, "projectId": a.project_id, "kind": a.kind, "title": a.title, "description": a.description, "requestedBy": a.requested_by_id, "requestedAt": iso(a.requested_at),
            "requiredRoles": a.required_roles, "decisions": a.decisions, "status": a.status, "amount": num(a.amount), "targetStage": a.target_stage}


def threshold(t: Threshold) -> dict:
    try:
        v: Any = float(t.value) if "." in t.value else int(t.value)
    except ValueError:
        v = t.value
    return {"key": t.key, "label": t.label, "value": v, "unit": t.unit or None, "effectiveFrom": d8(t.effective_from), "updatedBy": t.updated_by_id}


def extraction(e) -> dict:
    return {"id": e.id, "projectId": e.project_id, "sourceKind": e.source_kind, "sourceId": e.source_id,
            "target": e.target, "status": e.status, "transcript": e.transcript or "", "fields": e.fields,
            "modelName": e.model_name, "costUsd": float(e.cost_usd or 0), "error": e.error or "",
            "requestedBy": e.requested_by_id, "requestedAt": iso(e.requested_at),
            "finishedAt": iso(e.finished_at), "decidedBy": e.decided_by_id, "decidedAt": iso(e.decided_at)}


def vendor(v: Vendor) -> dict:
    return {"id": v.id, "name": v.name, "category": v.category}


def item(i: InventoryItem) -> dict:
    return {"id": i.id, "sku": i.sku, "name": i.name, "category": i.category, "unit": i.unit, "isSerialised": i.is_serialised, "reorderLevel": num(i.reorder_level),
            "reorderQty": num(i.reorder_qty), "defaultVendorId": i.default_vendor_id, "isActive": i.is_active, "make": i.make, "model": i.model, "warrantyMonths": i.warranty_months}


def location(l: StockLocation) -> dict:
    return {"id": l.id, "name": l.name, "type": l.type, "custodianId": l.custodian_id, "isActive": l.is_active}


def cost_item(c: CostItem) -> dict:
    return {"id": c.id, "projectId": c.project_id, "category": c.category, "label": c.label, "plannedAmount": num(c.planned_amount), **audit(c), **review(c), **void(c)}


def purchase_order(po: PurchaseOrder) -> dict:
    return {"id": po.id, "projectId": po.project_id, "poNumber": po.po_number, "vendorId": po.vendor_id, "status": po.status, "raisedBy": po.raised_by_id, "raisedAt": iso(po.raised_at),
            "items": [{"id": i.id, "costItemId": i.cost_item_id, "inventoryItemId": i.inventory_item_id, "description": i.description, "qty": num(i.qty), "unitCost": num(i.unit_cost),
                       "lineTotal": num(i.line_total), "qtyReceived": num(i.qty_received)} for i in po.items.all()],
            "total": num(po.total), "notes": po.notes, "approvalId": po.approval_id, **audit(po)}


def goods_receipt(g: GoodsReceipt) -> dict:
    return {"id": g.id, "projectId": g.project_id, "poId": g.po_id, "grnNumber": g.grn_number, "receivedAt": iso(g.received_at), "receivedBy": g.received_by_id, "lines": g.lines,
            "attachmentIds": g.attachment_ids, "locationId": g.location_id, "notes": g.notes, **audit(g), **review(g)}


def asset(a: Asset) -> dict:
    return {"id": a.id, "projectId": a.project_id, "inventoryItemId": a.inventory_item_id, "assetType": a.asset_type, "make": a.make, "model": a.model, "serial": a.serial,
            "unitCost": num(a.unit_cost), "vendorId": a.vendor_id, "purchaseItemId": a.purchase_item_id, "grnId": a.grn_id, "installDate": iso(a.install_date),
            "locationOnSite": a.location_on_site, "warrantyStart": d8(a.warranty_start), "warrantyEnd": d8(a.warranty_end), "status": a.status, "locationId": a.location_id, **audit(a)}


def movement(m: StockMovement) -> dict:
    return {"id": m.id, "itemId": m.item_id, "movementType": m.movement_type, "qty": num(m.qty), "locationFromId": m.location_from_id, "locationToId": m.location_to_id,
            "unitCost": num(m.unit_cost), "totalCost": num(m.total_cost), "projectId": m.project_id, "sourceRef": m.source_ref, "reason": m.reason, "serials": m.serials,
            "attachmentIds": m.attachment_ids, "createdBy": m.created_by_id, "createdAt": iso(m.created_at), "approvalId": m.approval_id, **review(m), **void(m)}


def actual(a: Actual) -> dict:
    return {"id": a.id, "projectId": a.project_id, "costItemId": a.cost_item_id, "category": a.category, "source": a.source, "sourceRef": a.source_ref, "amount": num(a.amount),
            "date": iso(a.date), "vendorId": a.vendor_id, "attachmentIds": a.attachment_ids, "qbBillId": a.qb_bill_id, "createdBy": a.created_by_id}


def change_order(c: ChangeOrder) -> dict:
    return {"id": c.id, "projectId": c.project_id, "coNumber": c.co_number, "title": c.title, "reason": c.reason, "scopeDelta": c.scope_delta, "costDelta": num(c.cost_delta),
            "timeDeltaDays": c.time_delta_days, "status": c.status, "approvalId": c.approval_id, **audit(c)}


def retention(r: Retention) -> dict:
    return {"projectId": r.project_id, "percent": num(r.percent), "amountHeld": num(r.amount_held), "releaseConditions": r.release_conditions, "releasedAt": iso(r.released_at),
            "releasedBy": r.released_by_id, "approvalId": r.approval_id}


def qb_bill(q: QbBill) -> dict:
    return {"id": q.id, "docNumber": q.doc_number, "vendorName": q.vendor_name, "txnDate": d8(q.txn_date), "dueDate": d8(q.due_date), "totalAmount": num(q.total_amount),
            "balance": num(q.balance), "currency": q.currency, "projectId": q.project_id, "matchedPoId": q.matched_po_id, "matchStatus": q.match_status, "syncedAt": iso(q.synced_at)}


def visit(v: SiteVisit) -> dict:
    return {"id": v.id, "projectId": v.project_id, "stationId": v.station_id, "visitType": v.visit_type, "startedAt": iso(v.started_at), "endedAt": iso(v.ended_at),
            "technicianIds": v.technician_ids, "durationHrs": num(v.duration_hrs), "findings": v.findings, "actionsTaken": v.actions_taken, "costTravel": num(v.cost_travel),
            "costLabour": num(v.cost_labour), "costParts": num(v.cost_parts), "costTotal": num(v.cost_total), "parts": v.parts, "locationId": v.location_id,
            "attachmentIds": v.attachment_ids, "issueIds": v.issue_ids, "clientSignoff": v.client_signoff, "gps": v.gps, "offlineCapturedAt": iso(v.offline_captured_at), **audit(v), **review(v)}


def issue(i: Issue) -> dict:
    return {"id": i.id, "projectId": i.project_id, "stationId": i.station_id, "assetId": i.asset_id, "category": i.category, "severity": i.severity, "title": i.title,
            "description": i.description, "raisedBy": i.raised_by_id, "raisedAt": iso(i.raised_at), "source": i.source, "status": i.status, "assigneeId": i.assignee_id,
            "rootCause": i.root_cause, "resolution": i.resolution, "resolvedBy": i.resolved_by_id, "resolvedAt": iso(i.resolved_at), "costToResolve": num(i.cost_to_resolve),
            "linkedVisitId": i.linked_visit_id, "warrantyClaimId": i.warranty_claim_id, "attachmentIds": list(i.attachment_ids or []), "beforeAttachmentIds": i.before_attachment_ids, "afterAttachmentIds": i.after_attachment_ids,
            "isSnag": i.is_snag, "slaDueAt": iso(i.sla_due_at), **audit(i), **review(i)}


def commissioning(c: CommissioningRecord) -> dict:
    return {"id": c.id, "projectId": c.project_id, "stationId": c.station_id, "date": d8(c.date), "engineerId": c.engineer_id, "result": c.result, "notes": c.notes, "items": c.items,
            "meter": c.meter, "clientWitness": c.client_witness, "attachmentIds": c.attachment_ids, **audit(c), **review(c)}


def hse(h: HseIncident) -> dict:
    return {"id": h.id, "projectId": h.project_id, "visitId": h.visit_id, "type": h.type, "severity": h.severity, "description": h.description, "actions": h.actions,
            "occurredAt": iso(h.occurred_at), "reportedBy": h.reported_by_id, "attachmentIds": h.attachment_ids, **audit(h), **review(h)}


def warranty(w: WarrantyClaim) -> dict:
    return {"id": w.id, "projectId": w.project_id, "assetId": w.asset_id, "issueId": w.issue_id, "vendorId": w.vendor_id, "claimedAt": iso(w.claimed_at), "status": w.status,
            "outcome": w.outcome, "costRecovered": num(w.cost_recovered), "notes": w.notes, **audit(w), **review(w)}


def stock_count(s: StockCount) -> dict:
    return {"id": s.id, "locationId": s.location_id, "countDate": d8(s.count_date), "countedBy": s.counted_by_id, "status": s.status, "lines": s.lines, "approvalId": s.approval_id,
            "notes": s.notes, "varianceValue": num(s.variance_value), **audit(s)}


def notification(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "severity": n.severity, "title": n.title, "body": n.body, "link": n.link,
            "projectId": n.project_id, "ref": n.ref, "createdAt": iso(n.created_at), "updatedAt": iso(n.updated_at),
            "readAt": iso(n.read_at)}


SERIALIZER = {Notification: notification, Project: project, ProjectMembership: membership, ChronologyEvent: event, Document: document, Attachment: attachment, Approval: approval, Threshold: threshold,
              Vendor: vendor, InventoryItem: item, StockLocation: location, CostItem: cost_item, PurchaseOrder: purchase_order, GoodsReceipt: goods_receipt, Asset: asset,
              StockMovement: movement, Actual: actual, ChangeOrder: change_order, Retention: retention, QbBill: qb_bill, SiteVisit: visit, Issue: issue,
              CommissioningRecord: commissioning, HseIncident: hse, WarrantyClaim: warranty, StockCount: stock_count, User: user}


def serialize(obj: Any) -> Any:
    if obj is None or isinstance(obj, (dict, list, str, int, float, bool)):
        return obj
    fn = SERIALIZER.get(type(obj))
    return fn(obj) if fn else str(obj)


def open_issue_counts() -> dict:
    out: dict = defaultdict(lambda: {"critical": 0, "high": 0, "medium": 0, "low": 0})
    for pid, sev in Issue.objects.exclude(status__in=["closed", "wont_fix"]).values_list("project_id", "severity"):
        out[pid][sev] = out[pid].get(sev, 0) + 1
    return out


def client_invoice(i: ClientInvoice) -> dict:
    return {"id": i.id, "projectId": i.project_id, "invoiceNumber": i.invoice_number, "issuedAt": d8(i.issued_at), "description": i.description,
            "netAmount": num(i.net_amount), "vatAmount": num(i.vat_amount), "grossAmount": num(i.gross_amount), "receipts": list(i.receipts or []),
            "vatStatus": i.vat_status, "vatSettledAt": d8(i.vat_settled_at), "vatSettledBy": i.vat_settled_by_id, "vatNote": i.vat_note,
            "vatEvidenceIds": list(i.vat_evidence_ids or []), "attachmentIds": list(i.attachment_ids or []), **audit(i), **review(i), **void(i)}


def vat_payment(v: VatPayment) -> dict:
    return {"id": v.id, "projectId": v.project_id, "amount": num(v.amount), "paidOn": d8(v.paid_on), "method": v.method, "note": v.note,
            "attachmentIds": list(v.attachment_ids or []), **audit(v), **review(v), **void(v)}


def void(x) -> dict:
    return {"voidedAt": iso(x.voided_at), "voidedBy": x.voided_by_id, "voidReason": x.void_reason} if getattr(x, "voided_at", None) else {}


def snapshot(u: User) -> dict:
    """Everything the web app's in-memory store needs.

    The portfolio is company-wide, so every project is readable by any signed-in member of staff. What a user
    receives is therefore gated by *permission* rather than by membership: a Field Tech sees every project and its
    evidence, but no budgets, purchase orders or actuals, because they hold no `money.read`. Membership still
    decides what they may *do*, which `rbac.can` enforces on every command.
    """
    def scoped(qs, field="project_id", allow_null=False):
        return qs

    may = lambda perm: rbac.can(u, perm) or any(rbac.can(u, perm, p) for p in visible_project_ids(u))
    sees_money = may("money.read")
    sees_stock = may("inventory.read")
    sees_assets = may("asset.read")
    sees_approvals = may("approval.read")
    oi = open_issue_counts()
    return {
        "users": [user(x) for x in User.objects.filter(is_active=True).prefetch_related("roles").order_by("name")],
        "projects": [project(p, oi) for p in scoped(Project.objects.all(), field="id").order_by("code")],
        "memberships": [membership(m) for m in scoped(ProjectMembership.objects.all()).order_by("granted_at")],
        "documents": [document(d) for d in scoped(Document.objects.all()).order_by("-submitted_at")],
        "attachments": [attachment(a) for a in scoped(Attachment.objects.all(), allow_null=True).order_by("-uploaded_at")],
        "events": [event(e) for e in scoped(ChronologyEvent.objects.all()).order_by("-occurred_at")],
        "approvals": [approval(a) for a in Approval.objects.all().order_by("-requested_at")] if sees_approvals else [],
        "thresholds": [threshold(t) for t in Threshold.objects.all().order_by("key")],
        "vendors": [vendor(v) for v in Vendor.objects.all().order_by("name")],
        # only unresolved readings: an accepted one has become the document's own fields
        "extractions": [extraction(e) for e in scoped(Extraction.objects.exclude(status__in=["accepted", "rejected"])).order_by("-requested_at")[:200]],
        "locations": [location(l) for l in StockLocation.objects.all().order_by("id")],
        "items": [item(i) for i in InventoryItem.objects.all().order_by("id")] if sees_stock else [],
        "costItems": [cost_item(c) for c in CostItem.objects.all().order_by("created_at")] if sees_money else [],
        "purchaseOrders": [purchase_order(p) for p in PurchaseOrder.objects.all().prefetch_related("items").order_by("-raised_at")] if sees_money else [],
        "goodsReceipts": [goods_receipt(g) for g in GoodsReceipt.objects.all().order_by("-received_at")] if (sees_money or sees_stock) else [],
        "assets": [asset(a) for a in Asset.objects.all().order_by("created_at")] if sees_assets else [],
        "movements": [movement(m) for m in StockMovement.objects.all().order_by("created_at", "id")] if sees_stock else [],
        "actuals": [actual(a) for a in Actual.objects.all().order_by("-date")] if sees_money else [],
        "changeOrders": [change_order(c) for c in ChangeOrder.objects.all().order_by("-created_at")] if sees_money else [],
        "retentions": [retention(r) for r in Retention.objects.all()] if sees_money else [],
        "clientInvoices": [client_invoice(i) for i in ClientInvoice.objects.all().order_by("-issued_at")] if sees_money else [],
        "vatPayments": [vat_payment(v) for v in VatPayment.objects.all().order_by("-paid_on")] if sees_money else [],
        "qbBills": [qb_bill(q) for q in QbBill.objects.all().order_by("-txn_date")] if rbac.can(u, "recon.read") else [],
        "visits": [visit(v) for v in scoped(SiteVisit.objects.all()).order_by("-started_at")],
        "issues": [issue(i) for i in scoped(Issue.objects.all()).order_by("-raised_at")],
        "commissionings": [commissioning(c) for c in scoped(CommissioningRecord.objects.all()).order_by("-date")],
        "hseIncidents": [hse(h) for h in scoped(HseIncident.objects.all()).order_by("-occurred_at")],
        "warrantyClaims": [warranty(w) for w in scoped(WarrantyClaim.objects.all()).order_by("-claimed_at")],
        "stockCounts": [stock_count(s) for s in StockCount.objects.all().order_by("-created_at")] if sees_stock else [],
    }
