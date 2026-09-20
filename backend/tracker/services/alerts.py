"""§8 notifications — the expiry and escalation engine.

Pure function `build()` derives every alert the system should currently be raising; `run()` reconciles those
against the stored `Notification` rows. Reconciling rather than appending means the command is idempotent and
self-healing: an alert whose condition has passed is withdrawn, so nobody chases a document that was renewed
yesterday. It is safe to run on any schedule.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Iterable

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .. import rbac
from ..constants import DOC_TYPE_LABEL, MOVEMENT_LABEL
from ..gates import STAGES
from ..models import (Approval, CommissioningRecord, Document, InventoryItem, Issue, Notification, Project, ProjectMembership, QbBill, User)
from . import base as b
from . import approvals as approvals_svc
from . import gates as gates_svc
from . import money as money_svc
from . import review as review_svc
from . import stock as stock_svc

# how far ahead an expiry is worth chasing, and the wording for each step
EXPIRY_STEPS = [(7, "critical"), (30, "warning"), (90, "info")]


@dataclass
class Alert:
    kind: str
    severity: str
    title: str
    body: str = ""
    link: str = ""
    project_id: str | None = None
    ref: dict | None = None
    dedupe_key: str = ""
    recipients: list[str] = field(default_factory=list)


def _users() -> list[User]:
    return list(User.objects.filter(is_active=True).prefetch_related("roles"))


def _with_perm(users: Iterable[User], perm: str, exclude: Iterable[str] = ()) -> list[str]:
    skip = set(exclude)
    return [u.id for u in users if u.id not in skip and rbac.can(u, perm)]


def _with_role(users: Iterable[User], *roles: str) -> list[str]:
    want = set(roles)
    return [u.id for u in users if want & set(u.role_codes())]


def _owners(p: Project) -> list[str]:
    """The people answerable for a project: its PM, its lead engineer, and anyone assigned to it."""
    ids = {p.pm_id, p.lead_engineer_id}
    ids.update(ProjectMembership.objects.filter(project=p, revoked_at__isnull=True).values_list("user_id", flat=True))
    return [i for i in ids if i]


def build() -> list[Alert]:
    users = _users()
    now = timezone.now()
    today = now.date()
    out: list[Alert] = []
    projects = {p.id: p for p in Project.objects.all()}
    live = [p for p in projects.values() if p.stage < 8]

    # ---- documents expiring or expired (insurance, permits, DISCO approvals) -------------------------
    for d in Document.objects.filter(expires_at__isnull=False, review_status="checked").select_related("project"):
        days = (d.expires_at - today).days
        p = d.project
        label = DOC_TYPE_LABEL.get(d.doc_type, d.doc_type)
        if days < 0:
            out.append(Alert("document_expired", "critical", f"{label} expired {abs(days)} d ago",
                             f"{p.code} · {d.title}" + (f" · {d.issuer}" if d.issuer else ""),
                             f"/projects/{p.id}/documents", p.id, {"model": "Document", "id": d.id},
                             f"document_expired:{d.id}", _owners(p) + _with_role(users, "director")))
            continue
        for limit, severity in EXPIRY_STEPS:
            if days <= limit:
                out.append(Alert("document_expiring", severity, f"{label} expires in {days} d",
                                 f"{p.code} · {d.title} · {d.expires_at.isoformat()}",
                                 f"/projects/{p.id}/documents", p.id, {"model": "Document", "id": d.id},
                                 f"document_expiring:{d.id}:{limit}", _owners(p) + _with_role(users, "director")))
                break

    # ---- commissioning delegated but not yet recorded ------------------------------------------------
    # Derived, not fired on assignment: run(prune=True) deletes any notification it cannot re-derive, so a
    # one-off would be swept within the hour. As a derived alert it also withdraws itself once the record
    # is checked, which is exactly when the assignee stops needing the reminder.
    done = set(CommissioningRecord.objects.filter(review_status="checked").values_list("project_id", flat=True))
    for p in live:
        if p.commissioning_assignee_id and p.id not in done:
            out.append(Alert("commissioning_assigned", "info", "You are commissioning this site",
                             f"{p.code} · {p.name}",
                             f"/projects/{p.id}/field", p.id, {"model": "Project", "id": p.id},
                             f"commissioning_assigned:{p.id}:{p.commissioning_assignee_id}",
                             [p.commissioning_assignee_id]))

    # ---- maker-checker sitting too long (§4.13 escalation) -------------------------------------------
    # Roles are company-wide, so "everyone who could check this" is most of the company. Tell the people
    # answerable for the project instead, and only fall back to all eligible checkers when it has no owners.
    threshold = int(b.threshold_num("check.escalation_days", 3))
    for item in review_svc.pending_items():
        if not item["overdue"]:
            continue
        p = projects.get(item["projectId"]) if item["projectId"] else None
        perm = review_svc.CHECK_PERM[item["kind"]]
        eligible = [u for u in users if u.id != item["submittedBy"] and rbac.can(u, perm, item["projectId"])]
        owners = set(_owners(p)) if p else set()
        who = [u.id for u in eligible if u.id in owners] or [u.id for u in eligible]
        out.append(Alert("check_overdue", "warning", f"Check waiting {item['ageDays']} d",
                         f"{(p.code + ' · ') if p else ''}{item['title']} — submitted by {b.user_name(item['submittedBy'])}",
                         "/work/reviews", p.id if p else None, {"model": item["kind"], "id": item["id"]},
                         f"check_overdue:{item['kind']}:{item['id']}", who))

    # ---- approvals awaiting a decision ---------------------------------------------------------------
    for a in Approval.objects.filter(status="pending").select_related("project"):
        deciders = [u.id for u in users if approvals_svc.can_decide(u, a)["ok"]]
        if not deciders:
            continue
        age = (now - a.requested_at).days
        out.append(Alert("approval_pending", "warning" if age >= threshold else "info",
                         f"{a.title}", f"Raised by {b.user_name(a.requested_by_id)} {age} d ago"
                         + (f" · {b.fmt(a.amount)}" if a.amount else ""),
                         "/work/approvals", a.project_id, {"model": "Approval", "id": a.id},
                         f"approval_pending:{a.id}", deciders))

    # ---- gate ready but nobody has asked for approval -------------------------------------------------
    for p in live:
        g = gates_svc.gate_status(p.id)
        if g["ready"] and not g["pendingApproval"]:
            out.append(Alert("gate_ready", "info", f"Gate {g['stage']} → {g['nextStage']} ready to request",
                             f"{p.code} · all {len(g['items'])} evidence items checked",
                             f"/projects/{p.id}", p.id, {"model": "Project", "id": p.id},
                             f"gate_ready:{p.id}:{p.stage}", _with_perm(users, "gate.request")))

    # ---- issues past their SLA -------------------------------------------------------------------------
    from . import field as field_svc
    for i in Issue.objects.exclude(status__in=["closed", "wont_fix"]).select_related("project"):
        sla = field_svc.issue_sla(i)
        if not sla["breached"]:
            continue
        p = i.project
        who = [x for x in [i.assignee_id, p.pm_id, p.lead_engineer_id] if x]
        out.append(Alert("issue_sla_breach", "critical" if i.severity in ("critical", "high") else "warning",
                         f"{i.severity.upper()} issue past SLA by {abs(sla['hoursLeft'])} h",
                         f"{p.code} · {i.title}", f"/projects/{p.id}/field", p.id, {"model": "Issue", "id": i.id},
                         f"issue_sla:{i.id}", who))

    # ---- budget pressure --------------------------------------------------------------------------------
    for p in live:
        m = money_svc.money(p.id)
        if not m["planned"]:
            continue
        burn = m["burnPct"]
        if burn < 90:
            continue
        who = _owners(p) + _with_role(users, "finance", "director")
        if burn > 100:
            out.append(Alert("budget_over", "critical", f"{p.code} is {burn}% of budget",
                             f"{b.fmt(m['actual'])} spent of {b.fmt(m['planned'])} — {b.fmt(m['actual'] - m['planned'])} over",
                             f"/projects/{p.id}/money", p.id, {"model": "Project", "id": p.id}, f"budget_over:{p.id}", who))
        else:
            out.append(Alert("budget_warn", "warning", f"{p.code} is {burn}% of budget",
                             f"{b.fmt(m['actual'])} of {b.fmt(m['planned'])} — {b.fmt(m['planned'] - m['actual'])} left",
                             f"/projects/{p.id}/money", p.id, {"model": "Project", "id": p.id}, f"budget_warn:{p.id}", who))

    # ---- stock below reorder level ------------------------------------------------------------------------
    balances = stock_svc.balances()
    items = {i.id: i for i in InventoryItem.objects.filter(is_active=True)}
    wh = b.default_warehouse().id
    for bal in balances:
        it = items.get(bal["itemId"])
        if not it or bal["locationId"] != wh or not bal["belowReorder"]:
            continue
        out.append(Alert("stock_below_reorder", "warning", f"{it.name} at {bal['qtyOnHand']:g} {it.unit}",
                         f"Reorder level {it.reorder_level:g} · suggested order {it.reorder_qty:g}",
                         "/inventory", None, {"model": "InventoryItem", "id": it.id},
                         f"stock_reorder:{it.id}", _with_role(users, "store_keeper") + _with_role(users, "finance")))

    # ---- bills that have not been reconciled ----------------------------------------------------------------
    unmatched = [row for row in __import__("tracker.services.recon", fromlist=["list_qb_bills"]).list_qb_bills() if row["confidence"] != "matched"]
    if unmatched:
        total = sum(Decimal(str(r["totalAmount"])) for r in unmatched)
        out.append(Alert("qb_unmatched", "info", f"{len(unmatched)} QuickBooks bill{'s' if len(unmatched) > 1 else ''} unreconciled",
                         f"{b.fmt(total)} awaiting a match to a purchase order", "/finance/reconciliation", None, None,
                         f"qb_unmatched:{len(unmatched)}", _with_perm(users, "recon.write")))
    return out


@transaction.atomic
def run(prune: bool = True) -> dict:
    """Reconcile the stored notifications against what should currently be raised."""
    now = timezone.now()
    alerts = build()
    seen: set[tuple[str, str]] = set()
    created = updated = 0
    for a in alerts:
        for uid in dict.fromkeys(a.recipients):
            key = (uid, a.dedupe_key)
            if key in seen:
                continue
            seen.add(key)
            shared = {"kind": a.kind, "severity": a.severity, "title": a.title[:200], "body": a.body[:400],
                      "link": a.link, "project_id": a.project_id, "ref": a.ref, "updated_at": now}
            # created_at is only set on insert, so an existing alert keeps its original age
            _, made = Notification.objects.update_or_create(
                recipient_id=uid, dedupe_key=a.dedupe_key, defaults=shared, create_defaults={**shared, "created_at": now},
            )
            created += 1 if made else 0
            updated += 0 if made else 1
    removed = 0
    if prune:
        for row in Notification.objects.all().only("id", "recipient_id", "dedupe_key"):
            if (row.recipient_id, row.dedupe_key) not in seen:
                row.delete()
                removed += 1
    return {"alerts": len(alerts), "created": created, "refreshed": updated, "withdrawn": removed}


# ---------------------------------------------------------------------------------------------------------
# Email channel (§8). One digest per person covering alerts they have not been mailed about yet — never one
# message per alert, which is how notification systems get muted.
# ---------------------------------------------------------------------------------------------------------
SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def _digest_body(user: User, rows: list[Notification], base: str) -> tuple[str, str]:
    rows = sorted(rows, key=lambda n: (SEVERITY_ORDER.get(n.severity, 9), n.created_at))
    crit = [n for n in rows if n.severity == "critical"]
    lead = f"{len(rows)} item{'s' if len(rows) != 1 else ''} need you on the Wyre tracker"
    if crit:
        lead += f", {len(crit)} critical"
    lines = [f"Hello {user.name.split(' ')[0]},", "", lead + ".", ""]
    for n in rows:
        mark = {"critical": "!!", "warning": "!", "info": "-"}.get(n.severity, "-")
        lines.append(f" {mark} {n.title}")
        if n.body:
            lines.append(f"    {n.body}")
        if n.link:
            lines.append(f"    {base}{n.link}")
        lines.append("")
    lines += ["Open the tracker: " + base, "", "You are receiving this because of your role on the Wyre project tracker."]
    text = "\n".join(lines)

    def esc(v: str) -> str:
        return (v or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    items = "".join(
        f'<tr><td style="padding:10px 12px;border-left:3px solid {"#DC2626" if n.severity == "critical" else "#F59E0B" if n.severity == "warning" else "#2563EB"};'
        f'border-bottom:1px solid #E2E8F0"><div style="font-weight:600;color:#0F172A">{esc(n.title)}</div>'
        + (f'<div style="color:#475569;font-size:13px;margin-top:2px">{esc(n.body)}</div>' if n.body else "")
        + (f'<div style="margin-top:4px"><a href="{esc(base + n.link)}" style="color:#5C3592;font-size:13px">Open</a></div>' if n.link else "")
        + "</td></tr>"
        for n in rows)
    html = (f'<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">'
            f'<h2 style="color:#0F172A;font-size:18px;margin:0 0 4px">{esc(lead)}</h2>'
            f'<p style="color:#475569;font-size:13px;margin:0 0 14px">Wyre project tracker</p>'
            f'<table style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">{items}</table>'
            f'<p style="margin-top:16px"><a href="{esc(base)}" style="background:#5C3592;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;font-size:14px">Open the tracker</a></p>'
            f'</div>')
    return text, html


def send_digests(send: bool = False, only_user: str | None = None, override_to: str | None = None) -> dict:
    """Mail each person the alerts they have not been mailed about yet.

    `send=False` (the default) reports what would go out and writes nothing — the safe thing to run first,
    especially against demo data whose addresses are placeholders.
    """
    from . import mailer

    now = timezone.now()
    base = settings.APP_BASE_URL
    qs = Notification.objects.filter(emailed_at__isnull=True).select_related("recipient")
    if only_user:
        qs = qs.filter(recipient_id=only_user)
    by_user: dict[str, list[Notification]] = {}
    for n in qs:
        by_user.setdefault(n.recipient_id, []).append(n)

    planned, sent, skipped, failed = [], 0, [], []
    for uid, rows in by_user.items():
        user = rows[0].recipient
        to = override_to or (user.email or "").strip()
        if not to:
            skipped.append((user.name, "no email address"))
            continue
        subject = f"Wyre tracker: {len(rows)} item{'s' if len(rows) != 1 else ''} need you"
        crit = sum(1 for n in rows if n.severity == "critical")
        if crit:
            subject = f"Wyre tracker: {crit} critical, {len(rows)} total"
        planned.append({"user": user.name, "to": to, "alerts": len(rows), "critical": crit, "subject": subject})
        if not send:
            continue
        text, html = _digest_body(user, rows, base)
        try:
            mailer.send(to, subject, text, html)
            Notification.objects.filter(pk__in=[n.pk for n in rows]).update(emailed_at=now)
            sent += 1
        except mailer.MailError as exc:
            failed.append((user.name, str(exc)))
    return {"planned": planned, "sent": sent, "skipped": skipped, "failed": failed, "configured": mailer.configured(), "dry_run": not send}
