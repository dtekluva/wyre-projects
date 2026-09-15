"""Command registry: one entry per MockApi mutation, same argument names, actor taken from the JWT (never from the body)."""
from __future__ import annotations

from typing import Any, Callable

from . import serializers as S
from .errors import ApiError
from .services import approvals, documents, field, gates, money, projects, recon, review, stock

Handler = Callable[[Any, dict, Any], Any]


def _in(body: dict, key: str = "input") -> dict:
    v = body.get(key)
    if not isinstance(v, dict):
        raise ApiError(f"'{key}' object is required", "invalid")
    return v


COMMANDS: dict[str, Handler] = {
    # projects & people
    "createProject": lambda a, d, f: S.project(projects.create_project(a, _in(d))),
    "grantMembership": lambda a, d, f: S.membership(projects.grant_membership(a, d.get("projectId"), d.get("userId"), d.get("role"))),
    "revokeMembership": lambda a, d, f: projects.revoke_membership(a, d.get("membershipId")),
    # documents & attachments
    "addDocument": lambda a, d, f: S.document(documents.add_document(a, d.get("projectId"), _in(d), f)),
    "addAttachment": lambda a, d, f: S.attachment(documents.add_attachment(a, d.get("projectId"), _in(d), f)),
    "addEvidence": lambda a, d, f: S.attachment(documents.add_evidence(a, _in(d), f)),
    # maker-checker, gates, approvals
    "check": lambda a, d, f: review.check(a, d.get("kind"), d.get("id"), d.get("decision"), d.get("comment")),
    "requestGate": lambda a, d, f: S.approval(gates.request_gate(a, d.get("projectId"))),
    "decide": lambda a, d, f: S.approval(approvals.decide(a, d.get("approvalId"), d.get("decision"), d.get("comment"))),
    # money
    "addCostItem": lambda a, d, f: S.cost_item(money.add_cost_item(a, d.get("projectId"), _in(d))),
    "createPO": lambda a, d, f: S.purchase_order(money.create_po(a, d.get("projectId"), _in(d))),
    "receiveGoods": lambda a, d, f: S.goods_receipt(money.receive_goods(a, d.get("poId"), _in(d))),
    "raiseChangeOrder": lambda a, d, f: S.change_order(money.raise_change_order(a, d.get("projectId"), _in(d))),
    "requestRetentionRelease": lambda a, d, f: S.approval(money.request_retention_release(a, d.get("projectId"))),
    # stock
    "issueStock": lambda a, d, f: S.movement(stock.issue_stock(a, _in(d))),
    "returnStock": lambda a, d, f: S.movement(stock.return_stock(a, _in(d))),
    "writeOff": lambda a, d, f: S.movement(stock.write_off(a, _in(d))),
    "addLocation": lambda a, d, f: S.location(stock.add_location(a, _in(d))),
    "transferStock": lambda a, d, f: S.movement(stock.transfer_stock(a, _in(d))),
    "startCount": lambda a, d, f: S.stock_count(stock.start_count(a, d.get("locationId"), d)),
    "enterCount": lambda a, d, f: S.stock_count(stock.enter_count(a, d.get("countId"), d.get("lines") or [])),
    "submitCount": lambda a, d, f: S.approval(stock.submit_count(a, d.get("countId"))),
    # reconciliation
    "matchBill": lambda a, d, f: S.qb_bill(recon.match_bill(a, d.get("billId"), d.get("poId"))),
    "unmatchBill": lambda a, d, f: S.qb_bill(recon.unmatch_bill(a, d.get("billId"))),
    # field
    "logVisit": lambda a, d, f: S.visit(field.log_visit(a, d.get("projectId"), _in(d))),
    "addVisitPhotos": lambda a, d, f: S.visit(field.add_visit_photos(a, d.get("visitId"), _in(d))),
    "raiseIssue": lambda a, d, f: S.issue(field.raise_issue(a, d.get("projectId"), _in(d))),
    "setIssueStatus": lambda a, d, f: S.issue(field.set_issue_status(a, d.get("issueId"), d.get("status"), d.get("assigneeId"))),
    "resolveIssue": lambda a, d, f: S.issue(field.resolve_issue(a, d.get("issueId"), _in(d))),
    "createCommissioning": lambda a, d, f: S.commissioning(field.create_commissioning(a, d.get("projectId"), _in(d))),
    "reportHse": lambda a, d, f: S.hse(field.report_hse(a, d.get("projectId"), _in(d))),
    "raiseWarrantyClaim": lambda a, d, f: S.warranty(field.raise_warranty_claim(a, d.get("projectId"), _in(d))),
    "updateWarrantyClaim": lambda a, d, f: S.warranty(field.update_warranty_claim(a, d.get("claimId"), _in(d))),
}
