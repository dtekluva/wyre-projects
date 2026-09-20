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
        # A nullable enum has to be anyOf under strict mode — type:["string","null"] with null in the
        # enum list is rejected ("Enum value 'proposal' does not match declared type").
        "doc_type": {"anyOf": [{"type": "string", "enum": list(DOC_TYPE_LABEL.keys())}, {"type": "null"}],
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


# ---- delivery notes / stock lists -> lines you can receive ------------------------------------------

STOCK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reference", "supplier", "dated", "lines", "confidence", "notes"],
    "properties": {
        "reference": {"type": ["string", "null"], "description": "Delivery note / waybill / invoice number as printed"},
        "supplier": {"type": ["string", "null"], "description": "Who supplied the goods"},
        "dated": {"type": ["string", "null"], "description": "Date on the document as YYYY-MM-DD, or null"},
        "lines": {
            "type": "array",
            "description": "One entry per line of goods. Skip totals, VAT, delivery charges and anything that is not a physical item.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["description", "qty", "unit", "unit_cost", "serials", "matches_existing"],
                "properties": {
                    "description": {"type": "string", "description": "The item as written on the page, verbatim"},
                    "qty": {"type": "number", "description": "Quantity delivered"},
                    "unit": {"type": ["string", "null"], "description": "pcs, m, kg, rolls — null if not stated"},
                    "unit_cost": {"type": ["number", "null"], "description": "Price per unit if printed, else null. Never divide a total to invent one."},
                    "serials": {"type": "array", "items": {"type": "string"},
                                "description": "Serial numbers printed for THIS line, verbatim. Empty if none."},
                    "matches_existing": {"type": ["string", "null"],
                                         "description": "If this is the same physical product as something already in stock, the EXISTING name exactly as given in the known list. Null if it is new, or if you are not sure."},
                },
            },
        },
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "notes": {"type": ["string", "null"], "description": "Anything a human should check — unreadable digits, a serial you are unsure of, quantities that do not add up"},
    },
}

STOCK_SYSTEM = """You read delivery notes, waybills and supplier invoices for a solar engineering company, so their store keeper does not have to retype them.

Report only what is printed. One entry per line of goods; skip subtotals, VAT, delivery charges and anything that is not a physical item.

Serial numbers are the point of this. They are long, they are often handwritten, and a store keeper typing twenty of them off a page is where errors come from. Copy each one character by character against the line it belongs to. Do not normalise them, do not correct what looks like a typo, do not expand a range like "1001-1005" into five numbers unless the page itself lists them separately. If a character is genuinely unreadable, say which serial and which position in notes rather than guessing — a wrong serial follows a physical unit around for its whole warranty life."""


def _known_block(known: list[str]) -> str:
    """What is already in stock, so the model can recognise a second delivery of the same thing.

    Matching on the string alone is not enough — "Deye SUN-6K inverter" and "Deye 6K inverter" are the
    same product written two ways, and would otherwise become two piles that each look half empty.
    """
    if not known:
        return ("\n\nNothing is in stock yet, so every line is new: leave matches_existing null.")
    listed = "\n".join(f"- {n}" for n in known[:400])
    return f"""

ALREADY IN STOCK — match against this list:
{listed}

For each line, if it is the SAME physical product as one of those, put that existing name in
matches_existing, copied exactly. This is how a second delivery adds to the same pile instead of starting
a new one, so a misspelling, an abbreviation or a different word order should still match.

Be strict about what "same" means. A different rating, capacity or model number is a DIFFERENT product:
a 6 kVA inverter is not a 20 kVA inverter, a 580 W panel is not a 550 W panel, and 4 mm cable is not 6 mm
cable — even where the rest of the name is identical. When the words differ in a way that could be a
different product, leave matches_existing null and let a person decide. A wrongly merged pile is much
harder to notice and unpick than one duplicate name."""

def read_stock_document(data: bytes, mime: str, filename: str = "", known: list[str] | None = None) -> dict:
    """Same shape as read_document: {'fields', 'transcript', 'usage'}."""
    client = _client()
    tool = {"name": "record_delivery", "description": "Record the goods listed on this document.",
            "input_schema": STOCK_SCHEMA, "strict": True}
    msg = client.messages.create(
        model=MODEL, max_tokens=16000, system=STOCK_SYSTEM + _known_block(known or []),
        thinking={"type": "adaptive"}, tools=[tool],
        messages=[{"role": "user", "content": [
            _source_block(data, mime),
            {"type": "text", "text": (
                f"File name: {filename or 'unknown'}\n\n"
                "First transcribe every line of this document verbatim, including every serial number. "
                "Then call record_delivery."
            )},
        ]}],
    )
    if msg.stop_reason == "refusal":
        raise AiError(f"Claude declined to read this document ({getattr(msg.stop_details, 'category', 'unknown')})")
    transcript = "\n".join(b.text for b in msg.content if b.type == "text").strip()
    fields = next((b.input for b in msg.content if b.type == "tool_use" and b.name == "record_delivery"), None)
    if fields is None:
        raise AiError("Claude read the document but returned no lines")
    u = msg.usage
    return {"fields": fields, "transcript": transcript,
            "usage": {"model": msg.model, "input_tokens": u.input_tokens, "output_tokens": u.output_tokens,
                      "cost_usd": round(u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT, 6)}}


DICTATION_SYSTEM = """A store keeper has just spoken aloud what arrived in the warehouse, and a phone transcribed it. Turn their words into stock lines.

This is speech, so expect it to be messy: "three of the Deye six K inverters", "twelve panels, the five eighty watt JA Solar ones", corrections mid-sentence ("two, sorry, three"), and numbers written as words. Take the last thing they said when they correct themselves.

Serial numbers dictated aloud are the risky part. People say "delta yankee six kay two four alpha zero zero eight one seven three nine one" or they spell it out letter by letter. Assemble what they said into a single serial with no spaces, and put it in notes that it was dictated rather than read off a label, so whoever checks this knows to compare it against the physical unit. If you cannot tell where one serial ends and the next begins, say so rather than splitting them on a guess.

If they did not mention a price, leave unit_cost null — never invent one. If they did not give serials for a line, leave the list empty; the person will type them or the item may not be serialised at all."""


def read_stock_dictation(text: str, known: list[str] | None = None) -> dict:
    """Same shape as read_stock_document, from spoken words instead of a page."""
    client = _client()
    tool = {"name": "record_delivery", "description": "Record the goods the store keeper described.",
            "input_schema": STOCK_SCHEMA, "strict": True}
    msg = client.messages.create(
        model=MODEL, max_tokens=16000, system=DICTATION_SYSTEM + _known_block(known or []),
        thinking={"type": "adaptive"}, tools=[tool],
        messages=[{"role": "user", "content": [{"type": "text", "text":
            "What the store keeper said:\n\n" + (text or "").strip() + "\n\nCall record_delivery."}]}],
    )
    if msg.stop_reason == "refusal":
        raise AiError("Claude declined to read that dictation")
    fields = next((b.input for b in msg.content if b.type == "tool_use" and b.name == "record_delivery"), None)
    if fields is None:
        raise AiError("Nothing in that recording looked like a list of goods")
    u = msg.usage
    return {"fields": fields, "transcript": (text or "").strip(),
            "usage": {"model": msg.model, "input_tokens": u.input_tokens, "output_tokens": u.output_tokens,
                      "cost_usd": round(u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT, 6)}}
