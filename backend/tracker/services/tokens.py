"""Single-use, expiring links for invites and password resets.

The payload carries the user id and a fingerprint of their current password hash. Setting a password
changes that hash, so a link stops working the moment it is used — no server-side token table to store,
expire or clean up, and a leaked email from last month is already dead.
"""
from __future__ import annotations

import hashlib
from typing import Optional, Tuple

from django.core import signing

from ..errors import ApiError
from ..models import User

INVITE = "wyre.invite"
RESET = "wyre.reset"

INVITE_MAX_AGE = 7 * 24 * 3600   # a new starter may not read email the same day
RESET_MAX_AGE = 2 * 3600         # short: the person asked for it seconds ago


def _fingerprint(user: User) -> str:
    """Six chars of the password hash. Not a secret — the token is already signed; this only ties the
    link to one state of the account so using it invalidates it."""
    return hashlib.sha256((user.password or "").encode()).hexdigest()[:6]


def make(user: User, salt: str) -> str:
    return signing.dumps({"u": user.id, "f": _fingerprint(user)}, salt=salt)


def check(token: str, salt: str) -> User:
    max_age = INVITE_MAX_AGE if salt == INVITE else RESET_MAX_AGE
    try:
        data = signing.loads(token, salt=salt, max_age=max_age)
    except signing.SignatureExpired:
        raise ApiError("That link has expired. Ask for a new one.", "invalid")
    except signing.BadSignature:
        raise ApiError("That link is not valid.", "invalid")
    user = User.objects.filter(pk=data.get("u")).first()
    if not user:
        raise ApiError("That link is not valid.", "invalid")
    if _fingerprint(user) != data.get("f"):
        raise ApiError("That link has already been used. Ask for a new one.", "invalid")
    return user
