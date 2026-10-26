"""Period summaries — the Claude-written opening paragraph for each project in the Activity report.

Cached per project and window: a paragraph asked for in the last 48 h is reused, whoever opens the report and however
often (user's rule, 2026-10-26). Requests are queued and written in a background thread straight after the request
commits; the scheduler drains anything a restart left behind. The model sees the chronology with money amounts removed,
so the paragraph never leaks figures to people without money rights.
"""
from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Optional

from django.db import connection, transaction
from django.utils import timezone

from ..errors import ApiError
from ..gates import STAGES
from ..models import ChronologyEvent, Issue, Project, ProjectNarrative, User
from . import ai
from . import base as b

log = logging.getLogger(__name__)
TTL = timedelta(hours=48)
_MONEY = re.compile(r"(?:₦|NGN\s?|N(?=\d))\s?[\d,]+(?:\.\d+)?(?:\s?[KMBkmb](?![A-Za-z]))?")


def strip_money(s: str) -> str:
    return _MONEY.sub("(amount)", s or "")


def fresh(project_id: str, window_key: str) -> Optional[ProjectNarrative]:
    return (ProjectNarrative.objects.filter(project_id=project_id, window_key=window_key, requested_at__gte=b.now() - TTL)
            .exclude(status="failed").order_by("-requested_at").first())


@transaction.atomic
def request_narratives(actor: User, input: dict) -> list[ProjectNarrative]:
    if not ai.configured():
        raise ApiError("Written summaries need Claude — no API key is configured", "conflict")
    frm = b.to_date(input.get("from"), "from"); to = b.to_date(input.get("to"), "to")
    key = b.clean(input.get("windowKey"))[:40]
    if not frm or not to or frm > to:
        raise ApiError("Pick a complete period", "invalid")
    if (to - frm).days > 366:
        raise ApiError("A summary covers a year at most", "invalid")
    if not key:
        raise ApiError("A period window is required", "invalid")
    out: list[ProjectNarrative] = []; made: list[str] = []
    for it in (input.get("items") or [])[:30]:
        pid = (it or {}).get("projectId")
        b.require(actor, "project.read", pid)
        p = b.project(pid)
        n = fresh(p.id, key)
        if n is None:
            n = ProjectNarrative.objects.create(**b.maybe_id(it, ProjectNarrative, "nar"), project=p, window_key=key, period_from=frm, period_to=to,
                                                status="queued", requested_by=actor, requested_at=b.now())
            made.append(n.id)
        out.append(n)
    if made:
        transaction.on_commit(lambda: _kick(made))
    return out


def _kick(ids: list[str]) -> None:
    """Write them now rather than on the scheduler's next tick, so the report fills in within seconds."""
    def work():
        try:
            run_queued(limit=len(ids), ids=ids)
        except Exception:                                   # the scheduler will retry anything left queued
            log.exception("narrative kick failed")
        finally:
            connection.close()
    threading.Thread(target=work, daemon=True, name="narratives").start()


def facts(p: Project, frm, to) -> str:
    tz = timezone.get_current_timezone()
    start = datetime.combine(frm, time.min, tzinfo=tz); end = datetime.combine(to + timedelta(days=1), time.min, tzinfo=tz)
    evs = list(ChronologyEvent.objects.filter(project=p, occurred_at__gte=start, occurred_at__lt=end).order_by("occurred_at"))
    lines = [f"{timezone.localtime(e.occurred_at):%a %d %b} · {e.event_type} · {strip_money(e.summary)[:170]}" for e in evs][-200:]
    open_issues = list(Issue.objects.filter(project=p, voided_at__isnull=True).exclude(status__in=["closed", "wont_fix"]))
    sev: dict[str, int] = {}
    for i in open_issues:
        sev[i.severity] = sev.get(i.severity, 0) + 1
    stage = next((s["name"] for s in STAGES if s["stage"] == p.stage), f"Stage {p.stage}")
    head = (f"Project: {p.name} ({p.code}) for {p.client_name}, {p.location}.\n"
            f"Stage now: {stage}. Status: {p.rag}" + (f" — {strip_money(p.rag_reason)}" if p.rag_reason else "") + ".\n"
            f"Period: {frm:%d %b %Y} to {to:%d %b %Y}.\n")
    body = (f"{len(evs)} recorded events in the period" + (f" (the last {len(lines)} shown)" if len(evs) > len(lines) else "") + ":\n"
            + ("\n".join(lines) if lines else "(none)"))
    tail = (f"\nStill open at the end of the period: {len(open_issues)} issue{'' if len(open_issues) == 1 else 's'}"
            + (" (" + ", ".join(f"{n} {k}" for k, n in sorted(sev.items())) + ")" if sev else "") + ".")
    return head + body + tail


def run_queued(limit: int = 5, ids: Optional[list[str]] = None) -> dict:
    done = failed = 0
    qs = ProjectNarrative.objects.filter(status="queued")
    if ids:
        qs = qs.filter(id__in=ids)
    for n in list(qs.select_related("project").order_by("requested_at")[:limit]):
        # claim it: the request thread and the scheduler may both reach for the same row
        if ProjectNarrative.objects.filter(pk=n.pk, status="queued").update(status="running") != 1:
            continue
        try:
            res = ai.write_narrative(facts(n.project, n.period_from, n.period_to))
            n.status = "done"; n.text = res["text"]; n.model_name = res["usage"]["model"][:60]
            n.cost_usd = Decimal(str(res["usage"]["cost_usd"])); n.error = ""; done += 1
        except Exception as e:                              # recorded on the row; the reader sees why
            n.status = "failed"; n.error = str(e)[:300]; failed += 1
        n.finished_at = b.now(); n.save()
    return {"done": done, "failed": failed}
