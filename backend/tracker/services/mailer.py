"""Mailgun transport for the §8 email channel.

Uses the standard library rather than `requests` so the backend keeps one less dependency, and is deliberately
inert unless configured: with no `MAILGUN_API_KEY` the sender refuses, so a database full of placeholder
addresses cannot mail real people by accident.
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterable

from django.conf import settings

log = logging.getLogger(__name__)


class MailError(RuntimeError):
    pass


def configured() -> bool:
    return bool(settings.MAILGUN_API_KEY and settings.MAILGUN_DOMAIN)


def send(to: str | Iterable[str], subject: str, text: str, html: str | None = None, timeout: int = 20) -> dict:
    """Send one message. Raises MailError on failure so the caller decides whether that is fatal."""
    if not configured():
        raise MailError("Mailgun is not configured (set MAILGUN_API_KEY)")
    recipients = [to] if isinstance(to, str) else [r for r in to if r]
    if not recipients:
        raise MailError("No recipients")

    fields: list[tuple[str, str]] = [("from", settings.MAILGUN_FROM), ("subject", subject), ("text", text)]
    fields += [("to", r) for r in recipients]          # repeated field, not a joined string
    if html:
        fields.append(("html", html))

    url = f"{settings.MAILGUN_BASE}/{settings.MAILGUN_DOMAIN}/messages"
    body = urllib.parse.urlencode(fields).encode()
    token = base64.b64encode(f"api:{settings.MAILGUN_API_KEY}".encode()).decode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Basic {token}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"status": resp.status, "body": raw[:300]}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise MailError(f"Mailgun {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise MailError(f"Could not reach Mailgun: {e.reason}") from e
