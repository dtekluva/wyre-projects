"""Queue, run, accept, reject.

Requesting is cheap and synchronous; running is not, so it happens in the scheduler container. A
30-second vision call has no business inside an HTTP request.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from django.db import transaction
from django.utils import timezone

from ..errors import ApiError
from ..models import Attachment, Document, Extraction, User
from . import ai
from . import base as b
from . import documents as docs

log = logging.getLogger(__name__)

SOURCES = {"document": Document, "attachment": Attachment}


@transaction.atomic
def request_extraction(actor: User, source_kind: str, source_id: str, target: str = "document_meta",
                       text: str = "") -> Extraction:
    """Anyone who may act on the result may ask a model to read the file — or the spoken words.

    A dictation has no file: the phone already turned speech into text, so the transcript arrives with
    the request and Claude only has to give it structure.
    """
    if source_kind == "dictation":
        b.require(actor, "inventory.write")
        said = (text or "").strip()
        if len(said) < 10:
            raise ApiError("Nothing was recorded — say what arrived and try again", "invalid")
        if not ai.configured():
            raise ApiError("Dictation is not switched on — no Claude API key is configured", "conflict")
        return Extraction.objects.create(source_kind="dictation", source_id="", target="stock_lines",
                                         status="queued", transcript=said[:200_000],
                                         requested_by=actor, requested_at=b.now())
    model = SOURCES.get(source_kind)
    if model is None:
        raise ApiError(f"Cannot read a {source_kind}", "invalid")
    if target not in ("document_meta", "stock_lines"):
        raise ApiError(f"Cannot read a file for {target}", "invalid")
    src = b.get_or_404(model, source_id, "Document" if source_kind == "document" else "Attachment")
    # Reading a delivery note is a store-keeper job; reading a permit is a document job.
    b.require(actor, "inventory.write" if target == "stock_lines" else "document.update",
              None if target == "stock_lines" else src.project_id)
    if not ai.configured():
        raise ApiError("Document reading is not switched on — no Claude API key is configured", "conflict")
    if not src.file:
        raise ApiError("That document has no file attached", "invalid")
    pending = Extraction.objects.filter(source_kind=source_kind, source_id=source_id,
                                        status__in=["queued", "running"]).first()
    if pending:
        raise ApiError("That document is already being read", "conflict")
    return Extraction.objects.create(project_id=src.project_id, source_kind=source_kind, source_id=source_id,
                                     target=target, status="queued",
                                     requested_by=actor, requested_at=b.now())


def run_one(ext: Extraction) -> Extraction:
    """Called by the scheduler. Never raises — a failure is recorded on the row so the UI can show it."""
    ext.status = "running"
    ext.save(update_fields=["status"])
    try:
        if ext.source_kind == "dictation":
            out = ai.read_stock_dictation(ext.transcript)
        else:
            src = b.get_or_404(SOURCES[ext.source_kind], ext.source_id, "Document")
            with src.file.open("rb") as fh:
                data = fh.read()
            mime = _mime_of(src.file_name)
            reader = ai.read_stock_document if ext.target == "stock_lines" else ai.read_document
            out = reader(data, mime, src.file_name)
        ext.transcript = out["transcript"][:200_000]
        ext.fields = out["fields"]
        ext.model_name = out["usage"]["model"]
        ext.input_tokens = out["usage"]["input_tokens"]
        ext.output_tokens = out["usage"]["output_tokens"]
        ext.cost_usd = out["usage"]["cost_usd"]
        ext.status = "done"
    except Exception as exc:                       # noqa: BLE001 — the row is the error channel
        log.exception("extraction %s failed", ext.id)
        ext.error = f"{exc.__class__.__name__}: {exc}"[:2000]
        ext.status = "failed"
    ext.finished_at = timezone.now()
    ext.save()
    return ext


def run_queued(limit: int = 5) -> dict:
    done = failed = 0
    for ext in Extraction.objects.filter(status="queued").order_by("requested_at")[:limit]:
        run_one(ext)
        done += ext.status == "done"
        failed += ext.status == "failed"
    return {"done": done, "failed": failed}


def _mime_of(name: str) -> str:
    n = (name or "").lower()
    for suffix, mime in ((".pdf", "application/pdf"), (".png", "image/png"), (".webp", "image/webp"),
                         (".gif", "image/gif"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg")):
        if n.endswith(suffix):
            return mime
    return ""


@transaction.atomic
def accept_extraction(actor: User, extraction_id: str, values: Optional[dict] = None) -> Document:
    """Apply the (possibly edited) values. Deliberately goes through documents.update_document rather
    than writing fields here, so nothing reaches the database on a path a human could not have taken."""
    ext = b.get_or_404(Extraction, extraction_id, "Extraction")
    if ext.status not in ("done", "failed"):
        raise ApiError(f"That reading is {ext.status}", "conflict")
    if ext.status == "failed":
        raise ApiError("That reading failed — nothing to accept", "conflict")
    if ext.target != "document_meta":
        raise ApiError("That reading is not document details — submit it from the inventory screen", "invalid")
    chosen = {**(ext.fields or {}), **(values or {})}
    doc = docs.update_document(actor, ext.source_id, {
        "title": chosen.get("title"),
        "docType": chosen.get("doc_type"),
        "issuer": chosen.get("issuer"),
        "issuedAt": chosen.get("issued_at"),
        "expiresAt": chosen.get("expires_at"),
    })
    ext.status, ext.decided_by, ext.decided_at = "accepted", actor, b.now()
    ext.save(update_fields=["status", "decided_by", "decided_at"])
    return doc


@transaction.atomic
def reject_extraction(actor: User, extraction_id: str) -> Extraction:
    ext = b.get_or_404(Extraction, extraction_id, "Extraction")
    b.require(actor, "document.update", ext.project_id)
    ext.status, ext.decided_by, ext.decided_at = "rejected", actor, b.now()
    ext.save(update_fields=["status", "decided_by", "decided_at"])
    return ext
