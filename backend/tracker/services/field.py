"""Phase 3 — visits, issues (SLA), commissioning → gate-5 evidence, HSE, warranty (spec §4.6, §4.8, §4.9, §4.14)."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from ..constants import COMMISSIONING_TEMPLATE, HSE_TYPE_LABEL, ISSUE_SEVERITIES, VISIT_TYPE_LABEL
from ..errors import ApiError
from ..models import Asset, CommissioningRecord, Document, HseIncident, Issue, SiteVisit, StockMovement, Threshold, User, WarrantyClaim
from . import base as b
from . import stock as stock_svc

SLA_DEFAULT = {"critical": 24, "high": 72, "medium": 168, "low": 720}


def sla_hours(severity: str) -> Decimal:
    t = Threshold.objects.filter(pk=f"sla.{severity}").first()
    if not t:
        return Decimal(SLA_DEFAULT.get(severity, 168))
    return b.dec(t.value) * 24 if t.unit == "d" else b.dec(t.value)


def issue_sla(i: Issue) -> dict:
    open_ = i.status not in ("closed", "wont_fix"); left = (i.sla_due_at - timezone.now()).total_seconds() / 3600
    return {"dueAt": b.iso(i.sla_due_at), "breached": open_ and left < 0, "hoursLeft": int(round(left)), "open": open_}


@transaction.atomic
def log_visit(actor: User, project_id: str, input: dict) -> SiteVisit:
    b.require(actor, "visit.create", project_id)
    b.project(project_id)
    findings = b.clean(input.get("findings"))
    if not findings:
        raise ApiError("Findings are required", "invalid")
    attachment_ids = list(input.get("attachmentIds") or [])
    if not attachment_ids:
        raise ApiError("At least one site photo is required", "invalid")
    if input.get("visitType") not in VISIT_TYPE_LABEL:
        raise ApiError("Unknown visit type", "invalid")
    started = b.to_dt(input.get("startedAt"), "startedAt"); ended = b.to_dt(input.get("endedAt"), "endedAt")
    if ended < started:
        raise ApiError("Visit ends before it starts", "invalid")
    loc_id = input.get("locationId")
    loc = b.get_or_404(type(b.default_warehouse()), loc_id, "Location") if loc_id else (stock_svc.list_locations().filter(type="vehicle").first() or b.default_warehouse())
    at = b.now()
    v = SiteVisit(**b.maybe_id(input, SiteVisit, "vis"), project_id=project_id, station_id=input.get("stationId"), visit_type=input["visitType"], started_at=started, ended_at=ended,
                  technician_ids=list(input.get("technicianIds") or []) or [actor.id], duration_hrs=b.round2((ended - started).total_seconds() / 3600),
                  findings=findings, actions_taken=b.clean(input.get("actionsTaken")), cost_travel=b.round2(input.get("costTravel") or 0), cost_labour=b.round2(input.get("costLabour") or 0),
                  cost_parts=0, cost_total=0, parts=[], location=loc, attachment_ids=attachment_ids, issue_ids=list(input.get("issueIds") or []),
                  client_signoff=input.get("clientSignoff") or None, gps=input.get("gps") or None,
                  offline_captured_at=b.to_dt(input["offlineCapturedAt"], "offlineCapturedAt") if input.get("offlineCapturedAt") else None,
                  created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(v, actor, at)
    v.save()  # parts movements reference the visit id
    parts = []; cost_parts = Decimal("0")
    for p in (input.get("parts") or []):
        qty = b.dec(p.get("qty"))
        if not qty > 0:
            continue
        it = b.item(p.get("itemId")); avail = stock_svc.available(it.id, loc.id)
        if qty > avail:
            raise ApiError(f"{it.name}: only {avail.normalize():f} {it.unit} at {loc.name}", "invalid")
        serials = stock_svc.validate_serials(it, qty, p.get("serials"), loc.id); wac = stock_svc.wac_of(it.id)
        m = StockMovement(item=it, movement_type="issue", qty=qty, location_from=loc, unit_cost=wac, total_cost=b.round2(qty * wac), project_id=project_id, serials=serials,
                          source_ref={"model": "SiteVisit", "id": v.id, "label": "Parts used on visit"}, created_by=actor, created_at=at)
        b.new_review(m, actor, at); m.save()
        parts.append({"movementId": m.id, "itemId": it.id, "qty": float(qty), "serials": serials}); cost_parts += b.dec(m.total_cost)
    v.parts = parts; v.cost_parts = cost_parts; v.cost_total = b.dec(v.cost_travel) + b.dec(v.cost_labour) + cost_parts
    v.save()
    b.log(project_id, actor, "visit", f"{VISIT_TYPE_LABEL[v.visit_type]} visit logged — {b.dec(v.duration_hrs).normalize():f} h, {b.fmt(v.cost_total)} (pending check)", v.findings, {"model": "SiteVisit", "id": v.id})
    return v


@transaction.atomic
def raise_issue(actor: User, project_id: str, input: dict) -> Issue:
    b.require(actor, "issue.create", project_id)
    b.project(project_id)
    title = b.clean(input.get("title"))
    if not title:
        raise ApiError("Title is required", "invalid")
    if input.get("severity") not in ISSUE_SEVERITIES:
        raise ApiError("Unknown severity", "invalid")
    before = list(input.get("beforeAttachmentIds") or [])
    if input.get("source") != "telemetry_alert" and not before:
        raise ApiError("A 'before' photo is required to raise an issue", "invalid")
    asset = None
    if input.get("assetId"):
        asset = Asset.objects.filter(pk=input["assetId"], project_id=project_id).first()
        if not asset:
            raise ApiError("Asset is not on this project", "invalid")
    at = b.now(); hours = sla_hours(input["severity"])
    i = Issue(**b.maybe_id(input, Issue, "iss"), project_id=project_id, asset=asset, category=input.get("category") or "other", severity=input["severity"], title=title, description=b.clean(input.get("description")),
              raised_by=actor, raised_at=at, source=input.get("source") or "manual", status="open", cost_to_resolve=0, linked_visit_id=input.get("linkedVisitId") or None,
              before_attachment_ids=before, after_attachment_ids=[], is_snag=bool(input.get("isSnag")), sla_due_at=b.plus_hours(at, hours),
              created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(i, actor, at); i.save()
    b.log(project_id, actor, "issue", f"Issue raised — {i.severity.upper()} · {i.title} (SLA {hours.normalize():f} h)", i.description, {"model": "Issue", "id": i.id})
    return i


@transaction.atomic
def set_issue_status(actor: User, issue_id: str, status: str, assignee_id: Optional[str] = None) -> Issue:
    i = b.get_or_404(Issue, issue_id, "Issue")
    b.require(actor, "issue.update", i.project_id)
    if status not in ("in_progress", "awaiting_parts"):
        raise ApiError("Status must be in_progress or awaiting_parts", "invalid")
    if i.status in ("closed", "wont_fix", "resolved"):
        raise ApiError(f"Issue is {i.status.replace('_', ' ')}", "conflict")
    i.status = status
    if assignee_id:
        i.assignee = b.get_user(assignee_id)
    b.stamp(i, actor); i.save()
    b.log(i.project_id, actor, "issue", f"{i.title} → {status.replace('_', ' ')}{f' (assigned {i.assignee.name})' if assignee_id else ''}", None, {"model": "Issue", "id": i.id})
    return i


@transaction.atomic
def resolve_issue(actor: User, issue_id: str, input: dict) -> Issue:
    """Resolution re-enters review: an 'after' photo is mandatory; the checker closes it."""
    i = b.get_or_404(Issue, issue_id, "Issue")
    b.require(actor, "issue.update", i.project_id)
    if i.status in ("closed", "wont_fix", "resolved"):
        raise ApiError(f"Issue is already {i.status.replace('_', ' ')}", "conflict")
    resolution = b.clean(input.get("resolution"))
    if not resolution:
        raise ApiError("Resolution is required", "invalid")
    after = list(input.get("afterAttachmentIds") or [])
    if not after:
        raise ApiError("An 'after' photo is required to resolve an issue", "invalid")
    at = b.now(); root = b.clean(input.get("rootCause"))
    i.status = "resolved"; i.root_cause = root; i.resolution = resolution; i.after_attachment_ids = after; i.cost_to_resolve = b.round2(input.get("costToResolve") or 0)
    i.linked_visit_id = input.get("visitId") or i.linked_visit_id; i.resolved_by = actor; i.resolved_at = at; b.stamp(i, actor, at)
    b.new_review(i, actor, at, version=i.review_version + 1); i.save()
    b.log(i.project_id, actor, "issue", f"Resolved (pending check) — {i.title}", f"{root} → {resolution}", {"model": "Issue", "id": i.id})
    return i


@transaction.atomic
def create_commissioning(actor: User, project_id: str, input: dict) -> CommissioningRecord:
    b.require(actor, "commissioning.create", project_id)
    b.project(project_id)
    items_in = {i.get("key"): i for i in (input.get("items") or [])}
    missing = [t["label"] for t in COMMISSIONING_TEMPLATE if t["key"] not in items_in]
    if missing:
        raise ApiError(f"Checklist incomplete: {', '.join(missing)}", "invalid")
    fails = [i for i in items_in.values() if not i.get("pass")]
    if input.get("result") == "pass" and fails:
        raise ApiError(f"Result cannot be \"pass\" with {len(fails)} failed item{'s' if len(fails) > 1 else ''}", "invalid")
    if input.get("result") not in ("pass", "conditional", "fail"):
        raise ApiError("Result must be pass, conditional or fail", "invalid")
    attachment_ids = list(input.get("attachmentIds") or [])
    if not attachment_ids:
        raise ApiError("Commissioning photos are required", "invalid")
    meter = input.get("meter") or {}
    at = b.now()
    c = CommissioningRecord(**b.maybe_id(input, CommissioningRecord, "com"), project_id=project_id, station_id=input.get("stationId"), date=b.to_date(input.get("date"), "Date") or at.date(), engineer=actor, result=input["result"],
                            notes=b.clean(input.get("notes")),
                            items=[{"key": t["key"], "label": t["label"], "unit": t.get("unit"), "measuredValue": items_in[t["key"]].get("measuredValue"), "pass": bool(items_in[t["key"]].get("pass")),
                                    "comment": items_in[t["key"]].get("comment"), "attachmentId": items_in[t["key"]].get("attachmentId")} for t in COMMISSIONING_TEMPLATE],
                            meter={k: bool(meter.get(k)) for k in ("serialAscii", "ctRatioVerified", "firstLiveReading", "historicalOk")},
                            client_witness=input.get("clientWitness") or None, attachment_ids=attachment_ids, created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(c, actor, at); c.save()
    b.log(project_id, actor, "commissioning", f"Commissioning record submitted — {c.result} ({sum(1 for i in c.items if i['pass'])}/{len(c.items)} pass) · pending check", c.notes, {"model": "CommissioningRecord", "id": c.id})
    return c


def emit_commissioning_evidence(c: CommissioningRecord, checker: User) -> None:
    """A checked commissioning record IS the gate-5 evidence: it emits the matching checked documents."""
    at = b.now(); meter_ok = all(c.meter.values())

    def mk(doc_type: str, title: str):
        if Document.objects.filter(project_id=c.project_id, doc_type=doc_type, review_status="checked").exists():
            return
        prior = Document.objects.filter(project_id=c.project_id, doc_type=doc_type).count()
        Document.objects.create(project_id=c.project_id, doc_type=doc_type, title=title, status="approved", issued_at=b.to_dt(c.date), issuer=c.engineer.name, version=prior + 1,
                                file_name=f"{doc_type}-{c.date.isoformat()}.pdf", size_bytes=240_000, created_at=at, created_by=c.engineer, updated_at=at, updated_by=checker,
                                review_status="checked", submitted_by=c.engineer, submitted_at=c.submitted_at, checked_by=checker, checked_at=at,
                                check_comment="Generated from checked commissioning record", review_version=1)

    mk("commissioning_record", f"Commissioning record {c.date.isoformat()} — {c.result}")
    if meter_ok:
        mk("meter_integrity", f"Meter data-integrity checks {c.date.isoformat()} — all pass")
    if (c.client_witness or {}).get("signatureAttachmentId"):
        mk("client_witness", f"Client witness — {c.client_witness.get('name')}")
    if c.attachment_ids:
        mk("commissioning_photos", f"Commissioning photos ({len(c.attachment_ids)})")
    b.log(c.project_id, checker, "commissioning", f"Commissioning checked — gate-5 evidence generated{'' if meter_ok else ' (meter integrity NOT satisfied)'}", None, {"model": "CommissioningRecord", "id": c.id})


@transaction.atomic
def report_hse(actor: User, project_id: str, input: dict) -> HseIncident:
    b.require(actor, "hse.create", project_id)
    b.project(project_id)
    desc = b.clean(input.get("description"))
    if not desc:
        raise ApiError("Description is required", "invalid")
    if input.get("type") not in HSE_TYPE_LABEL:
        raise ApiError("Unknown incident type", "invalid")
    at = b.now()
    h = HseIncident(**b.maybe_id(input, HseIncident, "hse"), project_id=project_id, visit_id=input.get("visitId") or None, type=input["type"], severity=input.get("severity") or "medium", description=desc,
                    actions=b.clean(input.get("actions")), occurred_at=b.to_dt(input.get("occurredAt") or at, "occurredAt"), reported_by=actor,
                    attachment_ids=list(input.get("attachmentIds") or []), created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(h, actor, at); h.save()
    b.log(project_id, actor, "hse", f"HSE {HSE_TYPE_LABEL[h.type]} reported — {h.severity} (pending check)", h.description, {"model": "HseIncident", "id": h.id})
    return h


@transaction.atomic
def raise_warranty_claim(actor: User, project_id: str, input: dict) -> WarrantyClaim:
    b.require(actor, "warranty.create", project_id)
    a = Asset.objects.filter(pk=input.get("assetId"), project_id=project_id).first()
    if not a:
        raise ApiError("Asset is not on this project", "invalid")
    today = b.now().date()
    if a.warranty_end and a.warranty_end < today:
        raise ApiError(f"Warranty on {a.serial} expired {a.warranty_end.isoformat()}", "invalid")
    at = b.now()
    w = WarrantyClaim(**b.maybe_id(input, WarrantyClaim, "war"), project_id=project_id, asset=a, issue_id=input.get("issueId") or None, vendor=a.vendor, claimed_at=at, status="raised", cost_recovered=0, notes=b.clean(input.get("notes")),
                      created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(w, actor, at); w.save()
    if input.get("issueId"):
        Issue.objects.filter(pk=input["issueId"]).update(warranty_claim_id=w.id)
    b.log(project_id, actor, "warranty", f"Warranty claim raised — {a.make} {a.model} {a.serial} → {b.vendor_name(a.vendor_id)}", w.notes, {"model": "WarrantyClaim", "id": w.id})
    return w


@transaction.atomic
def update_warranty_claim(actor: User, claim_id: str, input: dict) -> WarrantyClaim:
    w = b.get_or_404(WarrantyClaim, claim_id, "Claim")
    b.require(actor, "warranty.create", w.project_id)
    if input.get("status") not in ("raised", "accepted", "rejected", "replaced", "refunded"):
        raise ApiError("Unknown claim status", "invalid")
    at = b.now()
    w.status = input["status"]; w.outcome = b.clean(input.get("outcome")) or w.outcome
    if input.get("costRecovered") is not None:
        w.cost_recovered = b.round2(input["costRecovered"])
    b.stamp(w, actor, at); b.new_review(w, actor, at, version=w.review_version + 1); w.save()
    b.log(w.project_id, actor, "warranty", f"Warranty claim → {w.status}{f' · {b.fmt(w.cost_recovered)} recovered' if input.get('costRecovered') else ''} (pending check)", input.get("outcome"), {"model": "WarrantyClaim", "id": w.id})
    return w
