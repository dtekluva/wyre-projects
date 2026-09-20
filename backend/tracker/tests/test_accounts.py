"""Invite and password-reset flows — mainly the properties that make the links safe."""
from __future__ import annotations

from unittest import mock

from django.test import TestCase

from tracker.errors import ApiError
from tracker.models import Role, User
from tracker.services import accounts, tokens
from tracker.management.commands.seed_rbac import seed_rbac


class AccountsTest(TestCase):
    def setUp(self):
        seed_rbac()
        self.boss = User.objects.create(id="u_boss", username="the.boss", name="The Boss", email="boss@wyreng.com")
        self.boss.set_password("x" * 12)
        self.boss.save()
        self.boss.roles.set(Role.objects.filter(code="director"))
        self.tech = User.objects.create(id="u_t", username="a.tech", name="A Tech", email="tech@wyreng.com")
        self.tech.set_password("y" * 12)
        self.tech.save()
        self.tech.roles.set(Role.objects.filter(code="tech"))

    def err(self, code, fn, *a, **k):
        with self.assertRaises(ApiError) as cm:
            fn(*a, **k)
        self.assertEqual(cm.exception.code, code, cm.exception.message)
        return cm.exception

    def invite(self, **over):
        data = {"name": "New Starter", "email": "new@wyreng.com", "username": "new.starter", "roles": ["tech"]}
        data.update(over)
        return accounts.invite_user(self.boss, data)

    # ---- invite ----
    def test_only_users_manage_may_invite(self):
        self.err("forbidden", self.invite_as_tech)

    def invite_as_tech(self):
        return accounts.invite_user(self.tech, {"name": "X", "email": "x@wyreng.com", "username": "x.y", "roles": ["tech"]})

    def test_invite_creates_a_user_who_cannot_yet_sign_in(self):
        with mock.patch.object(accounts.mailer, "configured", return_value=False):
            res = self.invite()
        u = res["user"]
        self.assertFalse(u.has_usable_password(), "an invited user must not have a usable password")
        self.assertEqual(sorted(u.role_codes()), ["tech"])
        self.assertFalse(res["emailed"], "reports honestly that no mail went out")

    def test_invite_validation(self):
        with mock.patch.object(accounts.mailer, "configured", return_value=False):
            self.err("invalid", self.invite, name="")
            self.err("invalid", self.invite, email="nope")
            self.err("invalid", self.invite, username="a b")        # no spaces
            self.err("invalid", self.invite, username="x")           # too short
            self.err("invalid", self.invite, username=".leading")    # must start alphanumeric
            self.err("invalid", self.invite, username="a" * 41)      # too long
            self.err("invalid", self.invite, roles=[])
            self.err("invalid", self.invite, roles=["wizard"])
            self.invite()
            self.err("conflict", self.invite)                                  # same username
            self.err("conflict", self.invite, username="other.name")           # same email

    # ---- the link ----
    def test_link_is_single_use(self):
        with mock.patch.object(accounts.mailer, "configured", return_value=False):
            u = self.invite()["user"]
        t = tokens.make(u, tokens.INVITE)
        self.assertEqual(accounts.preview(t, tokens.INVITE)["username"], "new.starter")
        accounts.set_password(t, tokens.INVITE, "correct horse battery")
        self.err("invalid", accounts.set_password, t, tokens.INVITE, "another password")
        self.err("invalid", accounts.preview, t, tokens.INVITE)

    def test_link_does_not_work_across_flows(self):
        t = tokens.make(self.tech, tokens.RESET)
        self.err("invalid", accounts.set_password, t, tokens.INVITE, "a" * 12)

    def test_tampered_or_expired_link_is_refused(self):
        t = tokens.make(self.tech, tokens.RESET)
        self.err("invalid", accounts.set_password, t + "x", tokens.RESET, "a" * 12)
        with mock.patch("django.core.signing.loads", side_effect=__import__("django.core.signing", fromlist=["x"]).SignatureExpired("old")):
            self.err("invalid", accounts.set_password, t, tokens.RESET, "a" * 12)

    def test_password_rules(self):
        t = tokens.make(self.tech, tokens.RESET)
        self.err("invalid", accounts.set_password, t, tokens.RESET, "short")
        self.err("invalid", accounts.set_password, t, tokens.RESET, self.tech.username)
        accounts.set_password(t, tokens.RESET, "a good enough password")
        self.tech.refresh_from_db()
        self.assertTrue(self.tech.check_password("a good enough password"))

    # ---- reset request ----
    def test_reset_request_is_silent_about_unknown_addresses(self):
        with mock.patch.object(accounts, "_send") as send:
            accounts.request_reset("nobody@example.com")
            send.assert_not_called()
            accounts.request_reset("TECH@wyreng.com")          # case-insensitive
            send.assert_called_once()

    # ---- resend / revoke ----
    def test_resend_and_revoke_only_while_pending(self):
        with mock.patch.object(accounts.mailer, "configured", return_value=False):
            u = self.invite()["user"]
            accounts.resend_invite(self.boss, u.id)
            accounts.set_password(tokens.make(u, tokens.INVITE), tokens.INVITE, "now i have one")
            self.err("conflict", accounts.resend_invite, self.boss, u.id)
            self.err("conflict", accounts.revoke_invite, self.boss, u.id)

    def test_single_word_and_hyphenated_usernames_are_fine(self):
        """The firstname.lastname rule was a convention; these were all wrongly refused before."""
        with mock.patch.object(accounts.mailer, "configured", return_value=False):
            for i, name in enumerate(["ada", "a.obi", "ada-obi", "ada_obi", "ada.o.obi", "tech01"]):
                u = accounts.invite_user(self.boss, {"name": f"P{i}", "email": f"p{i}@wyreng.com",
                                                     "username": name, "roles": ["tech"]})["user"]
                self.assertEqual(u.username, name)

    def test_revoke_deletes_a_pending_invite(self):
        with mock.patch.object(accounts.mailer, "configured", return_value=False):
            u = self.invite()["user"]
        accounts.revoke_invite(self.boss, u.id)
        self.assertFalse(User.objects.filter(pk=u.id).exists())
