"""Reading documents with Claude (spec §9 evidence, §8 expiry).

Bounded and assistive, never autonomous: this module produces a *suggestion*. Nothing here writes a
record — accepting one goes through the same service a human typing the form would call, so validation,
actor capture and the review queue all apply unchanged.

Inert without ANTHROPIC_API_KEY, the same discipline as the Mailgun transport: an unconfigured install
reports honestly that it did nothing rather than half-working.
"""
from __future__ import annotations

import base64
import logging
from typing import Optional

from django.conf import settings

from ..constants import DOC_TYPE_LABEL

log = logging.getLogger(__name__)

# $5 / $25 per million tokens. A scanned permit is a few thousand input tokens — fractions of a cent.
MODEL = getattr(settings, "ANTHROPIC_MODEL", "") or "claude-opus-5"
PRICE_IN, PRICE_OUT = 5.00 / 1_000_000, 25.00 / 1_000_000

# What the model is allowed to return. strict + additionalProperties:false means the arguments are
# guaranteed to validate, so the caller never parses a hopeful blob.
DOC_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "doc_type", "issuer", "issued_at", "expires_at", "reference", "confidence", "notes"],
    "properties": {
        "title": {"type": ["string", "null"], "description": "Short human title for this document, e.g. 'Public liability insurance — Leadway'"},
        "doc_type": {"type": ["string", "null"], "enum": [*DOC_TYPE_LABEL.keys(), None],
                     "description": "Which kind of evidence this is, from the fixed list"},
        "issuer": {"type": ["string", "null"], "description": "Organisation that issued it, exactly as printed"},
        "issued_at": {"type": ["string", "null"], "description": "Date of issue as YYYY-MM-DD, or null if not printed"},
        "expires_at": {"type": ["string", "null"], "description": "Date it expires as YYYY-MM-DD, or null if it does not expire or is not printed"},
        "reference": {"type": ["string", "null"], "description": "Policy, permit or certificate number as printed"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"],
                       "description": "low when the scan is unclear or the fields were inferred rather than read"},
        "notes": {"type": ["string", "null"], "description": "Anything a human should check — poor scan, ambiguous date format, conflicting dates"},
    },
}

SYSTEM = """You read scanned documents for a solar engineering company's project tracker: permits, \
insurance certificates, DISCO approvals, structural certificates, delivery notes and the like.

Report only what is printed on the page. If a field is not present, return null — do not infer it, do not \
guess a year, do not convert a partial date into a full one. Nigerian documents usually write dates \
DD/MM/YYYY; if a date is genuinely ambiguous, return your best reading and say so in notes.

An expiry date is the single most important field: it drives the alerting that tells this company a permit \
is about to lapse. If the document shows a validity period rather than an expiry date, compute the end date \
and say so in notes. If you cannot read it confidently, return null and set confidence to low. A wrong date \
is far worse than a missing one — a missing one gets typed in, a wrong one silently mis-fires the alert."""


def configured() -> bool:
    return bool(getattr(settings, "ANTHROPIC_API_KEY", ""))


class AiError(RuntimeError):
    pass


def _client():
    if not configured():
        raise AiError("Claude is not configured (set ANTHROPIC_API_KEY)")
    import anthropic
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


def _source_block(data: bytes, mime: str) -> dict:
    """PDFs go in as document blocks, images as image blocks. No OCR step either way."""
    b64 = base64.standard_b64encode(data).decode()
    if mime == "application/pdf":
        return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
    if mime in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        return {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
    raise AiError(f"Cannot read {mime or 'that file type'} — PDF, JPEG, PNG, GIF and WebP only")


def read_document(data: bytes, mime: str, filename: str = "") -> dict:
    """Return {'fields': {...}, 'transcript': str, 'usage': {...}}.

    The transcript is kept so a checker can see what the model saw, rather than trusting a JSON blob
    that appeared from nowhere.
    """
    client = _client()
    tool = {
        "name": "record_document",
        "description": "Record the fields read from this document.",
        "input_schema": DOC_SCHEMA,
        "strict": True,
    }
    msg = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        tools=[tool],
        messages=[{"role": "user", "content": [
            _source_block(data, mime),
            {"type": "text", "text": (
                f"File name: {filename or 'unknown'}\n\n"
                "First transcribe every piece of text you can read on this document, verbatim. "
                "Then call record_document with the fields."
            )},
        ]}],
    )
    if msg.stop_reason == "refusal":
        raise AiError(f"Claude declined to read this document ({getattr(msg.stop_details, 'category', 'unknown')})")

    transcript = "\n".join(b.text for b in msg.content if b.type == "text").strip()
    fields: Optional[dict] = next((b.input for b in msg.content if b.type == "tool_use" and b.name == "record_document"), None)
    if fields is None:
        raise AiError("Claude read the document but returned no fields")

    u = msg.usage
    return {
        "fields": fields,
        "transcript": transcript,
        "usage": {
            "model": msg.model,
            "input_tokens": u.input_tokens,
            "output_tokens": u.output_tokens,
            "cost_usd": round(u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT, 6),
        },
    }
