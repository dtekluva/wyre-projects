from __future__ import annotations

import hashlib
import re
import secrets
from typing import Optional

from django.db import transaction

from ..constants import DOC_TYPE_LABEL
from ..errors import ApiError
from ..models import Attachment, Document, User
from . import base as b


def _sha(upload) -> tuple[str, int]:
    h = hashlib.sha256(); size = 0
    for chunk in upload.chunks():
        h.update(chunk); size += len(chunk)
    upload.seek(0)
    return h.hexdigest(), size


@transaction.atomic
def add_document(actor: User, project_id: str, input: dict, upload=None) -> Document:
    b.require(actor, "document.create", project_id)
    b.project(project_id)
    doc_type = input.get("docType")
    if doc_type not in DOC_TYPE_LABEL:
        raise ApiError("Unknown document type", "invalid")
    title = b.clean(input.get("title"))
    if not title:
        raise ApiError("Title is required", "invalid")
    at = b.now()
    prior = Document.objects.filter(project_id=project_id, doc_type=doc_type).count()
    file_name = b.clean(input.get("fileName")) or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") + ".pdf"
    size = int(input.get("sizeBytes") or 320_000)
    doc = Document(**b.maybe_id(input, Document, "doc"), project_id=project_id, doc_type=doc_type, title=title, status="submitted", issued_at=at,
                   expires_at=b.to_date(input.get("expiresAt"), "Expiry"), issuer=b.clean(input.get("issuer")) or None, version=prior + 1,
                   file_name=file_name, size_bytes=size, created_at=at, created_by=actor, updated_at=at, updated_by=actor)
    b.new_review(doc, actor, at)
    if upload is not None:
        _, doc.size_bytes = _sha(upload)
        doc.file_name = upload.name or file_name
        doc.file.save(upload.name, upload, save=False)
    doc.save()
    b.log(project_id, actor, "document_added", f'{DOC_TYPE_LABEL[doc_type]} — "{title}" submitted (pending check)', None, {"model": "Document", "id": doc.id})
    return doc


def _attachment(actor: User, project_id: Optional[str], input: dict, upload, checked: bool) -> Attachment:
    at = b.now()
    kind = input.get("kind") if input.get("kind") in ("image", "document") else "image"
    att = Attachment(**b.maybe_id(input, Attachment, "att"), project_id=project_id or None, file_name=b.clean(input.get("fileName")) or f"photo-{int(at.timestamp())}.jpg",
                     mime="application/pdf" if kind == "document" else "image/jpeg", size_bytes=int(input.get("sizeBytes") or 1_400_000), kind=kind,
                     captured_at=b.to_dt(input["capturedAt"], "capturedAt") if input.get("capturedAt") else at, gps=input.get("gps") or None,
                     sha256=secrets.token_hex(32), uploaded_by=actor, uploaded_at=at, linked_to=input.get("linkedTo") or None,
                     caption=b.clean(input.get("caption")) or None)
    b.new_review(att, actor, at)
    if upload is not None:
        att.sha256, att.size_bytes = _sha(upload)
        att.file_name = upload.name or att.file_name
        att.mime = getattr(upload, "content_type", None) or att.mime
        att.kind = "image" if att.mime.startswith("image/") else "document"
        att.file.save(upload.name, upload, save=False)
    if checked:
        att.review_status = "checked"; att.check_comment = "Verified through the linked approval"
    att.save()
    return att


@transaction.atomic
def add_attachment(actor: User, project_id: str, input: dict, upload=None) -> Attachment:
    b.require(actor, "attachment.create", project_id)
    b.project(project_id)
    att = _attachment(actor, project_id, input, upload, checked=False)
    b.log(project_id, actor, "attachment_added", f"Uploaded {att.file_name}{' — ' + att.caption if att.caption else ''} (pending check)", None, {"model": "Attachment", "id": att.id})
    return att


@transaction.atomic
def add_evidence(actor: User, input: dict, upload=None) -> Attachment:
    """Evidence attached to an approval-bearing object (e.g. a write-off): the Approval is its four-eyes check (§4.13)."""
    project_id = input.get("projectId") or None
    b.require(actor, "attachment.create", project_id)
    return _attachment(actor, project_id, input, upload, checked=True)
