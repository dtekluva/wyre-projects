"""Spec §3 stage gates — evidence must be *checked* documents; exit needs a formal Approval by the stage's approver roles."""
from __future__ import annotations

from django.db import transaction

from ..constants import DOC_TYPE_LABEL
from ..errors import ApiError
from ..gates import STAGES
from ..models import Approval, Document, User
from . import base as b


def gate_status(project_id: str) -> dict:
    p = b.project(project_id); d = STAGES[p.stage]
    if d.get("terminal"):
        return {"stage": p.stage, "name": d["name"], "nextStage": None, "items": [], "ready": False, "approverRoles": [], "pendingApproval": None, "terminal": True}
    items = []
    for doc_type in d["evidence"]:
        doc = Document.objects.filter(project=p, doc_type=doc_type).order_by("-submitted_at", "-id").first()
        state = "missing" if not doc else "ok" if doc.review_status == "checked" else "pending" if doc.review_status == "pending" else "rejected"
        items.append({"docType": doc_type, "label": DOC_TYPE_LABEL[doc_type], "state": state, "document": doc})
    pending = Approval.objects.filter(project=p, kind="gate", status="pending").first()
    return {"stage": p.stage, "name": d["name"], "nextStage": p.stage + 1, "items": items, "ready": all(i["state"] == "ok" for i in items),
            "approverRoles": list(d["approverRoles"]), "pendingApproval": pending, "terminal": False}


@transaction.atomic
def request_gate(actor: User, project_id: str) -> Approval:
    b.require(actor, "gate.request", project_id)
    g = gate_status(project_id)
    if g["terminal"]:
        raise ApiError("Project is closed", "conflict")
    if g["pendingApproval"]:
        raise ApiError("A gate approval is already pending", "conflict")
    if not g["ready"]:
        raise ApiError("Gate evidence is not complete — every item must be checked", "invalid")
    nxt = STAGES[g["nextStage"]]
    ap = Approval.objects.create(project_id=project_id, kind="gate", title=f"Gate {g['stage']} → {g['nextStage']} · {STAGES[g['stage']]['short']} → {nxt['short']}",
                                 description=f"All gate-{g['stage']} evidence checked: {', '.join(i['label'] for i in g['items'])}.",
                                 requested_by=actor, requested_at=b.now(), required_roles=g["approverRoles"], decisions=[], status="pending", target_stage=g["nextStage"])
    b.log(project_id, actor, "gate_requested", f"{ap.title} — approval requested", None, {"model": "Approval", "id": ap.id})
    return ap
