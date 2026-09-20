"""Invites and password resets (§2.1).

A user has no self-service password change anywhere else in the product, so these two flows are the only
way anybody but a director changes their own credentials. Both hand out a signed link rather than a
password — nothing secret is ever emailed, logged or stored in plain text.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable, Optional

from django.conf import settings
from django.db import transaction

from ..errors import ApiError
from ..models import Role, User
from . import base as b
from . import mailer, tokens

log = logging.getLogger(__name__)

USERNAME_RE = re.compile(r"^[a-z0-9]+(?:\.[a-z0-9]+)+$")   # firstname.lastname


def _link(path: str, token: str) -> str:
    return f"{settings.APP_BASE_URL}/{path}/{token}"


def _send(user: User, subject: str, intro: str, action: str, url: str, footer: str) -> bool:
    """Best-effort. A mail failure must not roll back the account change — the director can resend."""
    text = f"Hi {user.name},\n\n{intro}\n\n{action}:\n{url}\n\n{footer}\n\n— Wyre Tracker"
    html = (f"<p>Hi {user.name},</p><p>{intro}</p>"
            f"<p><a href=\"{url}\" style=\"background:#5C3592;color:#fff;padding:10px 18px;"
            f"border-radius:6px;text-decoration:none;display:inline-block\">{action}</a></p>"
            f"<p style=\"color:#666;font-size:13px\">Or paste this into your browser:<br>{url}</p>"
            f"<p style=\"color:#666;font-size:13px\">{footer}</p>")
    if not mailer.configured():
        log.warning("Mailgun not configured — %s link for %s was not sent: %s", subject, user.email, url)
        return False
    try:
        mailer.send(user.email, subject, text, html)
        return True
    except mailer.MailError:
        log.exception("Could not email %s", user.email)
        return False


# ---- invite -----------------------------------------------------------------------------------------

@transaction.atomic
def invite_user(actor: User, input: dict) -> dict:
    b.require(actor, "users.manage")
    name = b.clean(input.get("name"))
    email = b.clean(input.get("email")).lower()
    username = b.clean(input.get("username")).lower()
    role_codes = [r for r in (input.get("roles") or []) if r]

    if not name:
        raise ApiError("Name is required", "invalid")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ApiError("A valid email address is required", "invalid")
    if not USERNAME_RE.match(username):
        raise ApiError("Username must be firstname.lastname", "invalid")
    if not role_codes:
        raise ApiError("Pick at least one role", "invalid")
    known = set(Role.objects.values_list("code", flat=True))
    unknown = [r for r in role_codes if r not in known]
    if unknown:
        raise ApiError(f"Unknown role: {', '.join(unknown)}", "invalid")
    if User.objects.filter(username=username).exists():
        raise ApiError(f"{username} is already taken", "conflict")
    if User.objects.filter(email__iexact=email).exists():
        raise ApiError(f"{email} already has an account", "conflict")

    user = User(username=username, name=name, email=email, is_active=True)
    user.set_unusable_password()   # cannot sign in until they follow the link and choose one
    user.save()
    user.roles.set(Role.objects.filter(code__in=role_codes))
    sent = _send_invite(user, actor)
    # NOT the chronology: ChronologyEvent.project is non-null and b.log() silently no-ops without one,
    # so a call there would look audited and record nothing. User management is global, the chronology
    # is per-project (§4.2). This goes to the application log until that gap is closed properly.
    log.info("user_invited by=%s username=%s roles=%s emailed=%s", actor.username, username, role_codes, sent)
    return {"user": user, "emailed": sent}


def _send_invite(user: User, actor: User) -> bool:
    return _send(user, "You have been invited to Wyre Tracker",
                 f"{actor.name} has set up an account for you on Wyre Tracker. "
                 f"Your username is <b>{user.username}</b>.",
                 "Choose your password", _link("invite", tokens.make(user, tokens.INVITE)),
                 "This link is good for 7 days and can only be used once.")


def resend_invite(actor: User, user_id: str) -> dict:
    b.require(actor, "users.manage")
    user = b.get_user(user_id)
    if user.has_usable_password():
        raise ApiError(f"{user.name} has already set a password", "conflict")
    return {"user": user, "emailed": _send_invite(user, actor)}


@transaction.atomic
def revoke_invite(actor: User, user_id: str) -> None:
    """Delete an invite that was never accepted. Refuses once the account has been used, because by then
    the person owns chronology rows and deleting them would tear holes in the audit trail."""
    b.require(actor, "users.manage")
    user = b.get_user(user_id)
    if user.has_usable_password():
        raise ApiError(f"{user.name} has already signed in — deactivate the account instead", "conflict")
    name, username = user.name, user.username
    user.delete()
    log.info("invite_revoked by=%s username=%s name=%s", actor.username, username, name)


# ---- password reset ---------------------------------------------------------------------------------

def request_reset(email: str) -> None:
    """Always silent. Telling a stranger whether an address has an account is an account-enumeration
    oracle, so this returns the same way whether or not it matched."""
    user = User.objects.filter(email__iexact=b.clean(email), is_active=True).first()
    if not user:
        return
    _send(user, "Reset your Wyre Tracker password",
          "Somebody asked to reset the password on your Wyre Tracker account. "
          "If that was not you, ignore this email and nothing changes.",
          "Choose a new password", _link("reset", tokens.make(user, tokens.RESET)),
          "This link is good for 2 hours and can only be used once.")


def preview(token: str, salt: str) -> dict:
    """What the set-password screen shows before anyone types: who the link is for."""
    user = tokens.check(token, salt)
    return {"name": user.name, "username": user.username, "email": user.email}


MIN_PASSWORD = 10


@transaction.atomic
def set_password(token: str, salt: str, password: str) -> User:
    user = tokens.check(token, salt)
    pw = password or ""
    if len(pw) < MIN_PASSWORD:
        raise ApiError(f"Password must be at least {MIN_PASSWORD} characters", "invalid")
    if pw.lower() in {user.username.lower(), user.email.lower(), user.name.lower()}:
        raise ApiError("Password must not be your name, username or email", "invalid")
    user.set_password(pw)
    user.save(update_fields=["password"])   # the hash changes, so the link is now spent
    return user
