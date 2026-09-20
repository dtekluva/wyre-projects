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


class ManageUsersTest(TestCase):
    """Deactivate, change roles, delete — and the guards that stop the company locking itself out."""

    def setUp(self):
        seed_rbac()
        def mk(uid, username, roles, active=True):
            u = User.objects.create(id=uid, username=username, name=username, email=f"{username}@wyreng.com", is_active=active)
            u.set_password("x" * 12); u.save(); u.roles.set(Role.objects.filter(code__in=roles)); return u
        self.boss = mk("u_b", "boss", ["director"])
        self.boss2 = mk("u_b2", "boss.two", ["director"])
        self.tech = mk("u_t", "tech.one", ["tech"])

    def err(self, code, fn, *a):
        with self.assertRaises(ApiError) as cm:
            fn(*a)
        self.assertEqual(cm.exception.code, code, cm.exception.message)
        return cm.exception

    def test_only_users_manage_may_change_anything(self):
        self.err("forbidden", accounts.set_user_roles, self.tech, "u_t", ["director"])
        self.err("forbidden", accounts.set_user_active, self.tech, "u_b", False)
        self.err("forbidden", accounts.delete_user, self.tech, "u_b")

    def test_change_roles(self):
        u = accounts.set_user_roles(self.boss, "u_t", ["techlead", "finance"])
        self.assertEqual(sorted(u.role_codes()), ["finance", "techlead"])
        self.err("invalid", accounts.set_user_roles, self.boss, "u_t", [])
        self.err("invalid", accounts.set_user_roles, self.boss, "u_t", ["wizard"])

    def test_deactivate_blocks_sign_in_and_is_reversible(self):
        u = accounts.set_user_active(self.boss, "u_t", False)
        self.assertFalse(u.is_active)
        from rest_framework_simplejwt.authentication import default_user_authentication_rule as rule
        self.assertFalse(rule(u), "an inactive user must fail the JWT authentication rule")
        self.err("conflict", accounts.set_user_active, self.boss, "u_t", False)
        self.assertTrue(accounts.set_user_active(self.boss, "u_t", True).is_active)

    def test_cannot_lock_yourself_or_everyone_out(self):
        self.err("invalid", accounts.set_user_active, self.boss, "u_b", False)   # self
        self.err("invalid", accounts.delete_user, self.boss, "u_b")              # self
        accounts.set_user_active(self.boss, "u_b2", False)                       # now boss is the only admin
        self.err("invalid", accounts.set_user_roles, self.boss, "u_b", ["tech"])
        self.assertTrue(User.objects.get(pk="u_b").roles.filter(code="director").exists(), "roles rolled back")

    def test_delete_only_when_there_is_no_history(self):
        accounts.delete_user(self.boss, "u_t")
        self.assertFalse(User.objects.filter(pk="u_t").exists())

    def test_delete_refuses_someone_with_history(self):
        from tracker.models import Project, ChronologyEvent
        from django.utils import timezone
        p = Project.objects.create(id="p_x", code="WYR-2026-900", name="X", client_name="C", branch_name="B",
                                   location="L", project_type="solar_battery", stage=0, rag="green",
                                   pm=self.boss, lead_engineer=self.boss, contract_value=1, approved_budget=1,
                                   created_by=self.boss, updated_by=self.boss, created_at=timezone.now(),
                                   updated_at=timezone.now(), retention_percent=5)
        ChronologyEvent.objects.create(project=p, occurred_at=timezone.now(), actor=self.tech,
                                       event_type="note", summary="did a thing")
        e = self.err("conflict", accounts.delete_user, self.boss, "u_t")
        self.assertIn("Deactivate", e.message)
        self.assertTrue(User.objects.filter(pk="u_t").exists())
