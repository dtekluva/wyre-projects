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
from django.db.models import ProtectedError

from ..errors import ApiError
from html import escape

from ..constants import ROLE_LABEL
from .. import rbac
from ..models import Role, User
from . import base as b
from . import email_templates as T
from . import mailer, tokens

log = logging.getLogger(__name__)

# Deliberately permissive (2026-09-20): firstname.lastname was a convention, not a requirement, and it
# excluded single-word handles, initials and anything with a hyphen. Still an identifier, though — it has
# to survive a URL, a login box and a sort, so no spaces, no @, and it starts and ends alphanumeric.
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,38}[a-z0-9]$")
USERNAME_RULE = "Username can use letters, numbers, dots, dashes and underscores (2-40 characters)"


def _link(path: str, token: str) -> str:
    return f"{settings.APP_BASE_URL}/{path}/{token}"


def _send(user: User, subject: str, *, preheader: str, heading: str, greeting: str,
          body_html: str, text_body: str, rows: list[tuple[str, str]], action: str, url: str,
          note: str, footer: str) -> bool:
    """Best-effort. A mail failure must not roll back the account change — the director can resend.

    Every message goes out as both parts: plain text for readers who refuse HTML (and for the ones who
    will paste it into a terminal), and the table-based HTML for everyone else."""
    facts = "\n".join(f"{k}: {v}" for k, v in rows)
    text = (f"{greeting}\n\n{text_body}\n\n{facts}\n\n{action}:\n{url}\n\n{note}\n\n{footer}\n\n— Wyre Tracker")
    html = T.layout(preheader=preheader, heading=heading, greeting=greeting,
                    body_html=T.paragraph(body_html) + T.facts(rows),
                    action=action, url=url, note=note, footer=footer)
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
        raise ApiError(USERNAME_RULE, "invalid")
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
    roles = ", ".join(ROLE_LABEL.get(r, r) for r in user.role_codes()) or "—"
    return _send(
        user, f"{actor.name} has invited you to Wyre Tracker",
        preheader=f"Set your password and sign in as {user.username}.",
        heading="You have an account",
        greeting=f"Hi {user.name.split(' ')[0]},",
        body_html=(f"<b>{escape(actor.name)}</b> has set up a Wyre Tracker account for you. It is where "
                   f"Wyre runs its projects — site visits, documents, approvals and the evidence behind them. "
                   f"Choose a password and you are in."),
        text_body=(f"{actor.name} has set up a Wyre Tracker account for you. Choose a password and you are in."),
        rows=[("Username", user.username), ("Your roles", roles), ("Invited by", actor.name)],
        action="Choose your password",
        url=_link("invite", tokens.make(user, tokens.INVITE)),
        note="This link works once and expires in 7 days. If it has run out, ask whoever invited you to send another.",
        footer="You are receiving this because a Wyre Tracker administrator created an account for this address.")


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
    _send(
        user, "Reset your Wyre Tracker password",
        preheader="Choose a new password — the link lasts 2 hours.",
        heading="Reset your password",
        greeting=f"Hi {user.name.split(' ')[0]},",
        body_html=("Somebody asked to reset the password on your Wyre Tracker account. If that was you, "
                   "use the button below. If it was not, ignore this email — nothing has changed and your "
                   "current password still works."),
        text_body=("Somebody asked to reset the password on your Wyre Tracker account. If that was not you, "
                   "ignore this email — nothing has changed."),
        rows=[("Username", user.username), ("Account", user.email)],
        action="Choose a new password",
        url=_link("reset", tokens.make(user, tokens.RESET)),
        note="This link works once and expires in 2 hours. Requesting another replaces it.",
        footer="You are receiving this because a password reset was requested for this address.")


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


# ---- managing existing people -------------------------------------------------------------------------

def _other_admins(user: User):
    """Active people other than `user` who can still manage users. The guard against locking the whole
    company out of its own admin screen."""
    return [u for u in User.objects.filter(is_active=True).exclude(pk=user.pk).prefetch_related("roles")
            if rbac.can(u, "users.manage")]


@transaction.atomic
def set_user_roles(actor: User, user_id: str, role_codes: list[str]) -> User:
    b.require(actor, "users.manage")
    user = b.get_user(user_id)
    codes = [c for c in dict.fromkeys(role_codes or []) if c]
    if not codes:
        raise ApiError("Everyone needs at least one role", "invalid")
    known = set(Role.objects.values_list("code", flat=True))
    unknown = [c for c in codes if c not in known]
    if unknown:
        raise ApiError(f"Unknown role: {', '.join(unknown)}", "invalid")

    user.roles.set(Role.objects.filter(code__in=codes))
    user.refresh_from_db()
    # Re-check AFTER the change: dropping your own director role, with nobody else holding it, would
    # leave the system with no way back in.
    if not _other_admins(actor) and not rbac.can(user if user.pk == actor.pk else actor, "users.manage"):
        raise ApiError("That would leave nobody able to manage users. Give someone else the role first.", "invalid")
    log.info("roles_changed by=%s username=%s roles=%s", actor.username, user.username, codes)
    return user


@transaction.atomic
def set_user_active(actor: User, user_id: str, active: bool) -> User:
    """Deactivating is the normal way to remove somebody: they cannot sign in, their history stays
    intact, and it is reversible on their first day back."""
    b.require(actor, "users.manage")
    user = b.get_user(user_id)
    if user.pk == actor.pk and not active:
        raise ApiError("You cannot deactivate your own account", "invalid")
    if not active and rbac.can(user, "users.manage") and not _other_admins(actor):
        raise ApiError("That is the last account that can manage users", "invalid")
    if user.is_active == active:
        raise ApiError(f"{user.name} is already {'active' if active else 'deactivated'}", "conflict")
    user.is_active = active
    user.save(update_fields=["is_active"])
    # An access token already issued stays valid until it expires (12 h), so this is not an instant
    # ejection — it stops the next sign-in and the next refresh.
    log.info("user_%s by=%s username=%s", "reactivated" if active else "deactivated", actor.username, user.username)
    return user


@transaction.atomic
def delete_user(actor: User, user_id: str) -> None:
    """Only for accounts that never did anything. Eighteen models reference User with PROTECT, so anyone
    who raised, checked or approved so much as one thing cannot be deleted — that is the audit trail
    doing its job, and deactivating is the right answer instead."""
    b.require(actor, "users.manage")
    user = b.get_user(user_id)
    if user.pk == actor.pk:
        raise ApiError("You cannot delete your own account", "invalid")
    if rbac.can(user, "users.manage") and not _other_admins(actor):
        raise ApiError("That is the last account that can manage users", "invalid")
    name, username = user.name, user.username
    try:
        user.delete()
    except ProtectedError:
        raise ApiError(
            f"{name} has history in the system and cannot be deleted — their name is attached to work "
            f"that has to stay auditable. Deactivate the account instead.", "conflict")
    log.info("user_deleted by=%s username=%s name=%s", actor.username, username, name)
