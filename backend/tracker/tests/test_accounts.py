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


class AlertsWithoutInventoryTest(TestCase):
    """A new install has no warehouse. That must not stop every other alert from being raised."""

    def setUp(self):
        seed_rbac()
        self.boss = User.objects.create(id="u_a", username="a.boss", name="A Boss", email="a@wyreng.com")
        self.boss.set_password("x" * 12); self.boss.save()
        self.boss.roles.set(Role.objects.filter(code="director"))

    def test_build_survives_with_no_warehouse(self):
        from tracker.models import StockLocation
        from tracker.services import alerts
        self.assertFalse(StockLocation.objects.exists(), "precondition: a fresh install has no locations")
        alerts.build()          # used to raise ApiError("No warehouse location configured")
        res = alerts.run(prune=False)
        self.assertIsInstance(res, dict)


class StockWithoutACatalogueTest(TestCase):
    """Nobody registers an item first. A name arrives, it starts being tracked, and the same name
    later adds to the same pile."""

    def setUp(self):
        seed_rbac()
        self.keeper = User.objects.create(id="u_k", username="k", name="K", email="k@wyreng.com")
        self.keeper.set_password("x" * 12); self.keeper.save()
        self.keeper.roles.set(Role.objects.filter(code="store_keeper"))
        self.checker = User.objects.create(id="u_c", username="c", name="C", email="c@wyreng.com")
        self.checker.set_password("x" * 12); self.checker.save()
        self.checker.roles.set(Role.objects.filter(code="finance"))
        from tracker.services import stock
        self.loc = stock.add_location(self.keeper, {"name": "Ikeja", "type": "warehouse"})

    def receive(self, name, qty, serials=None, unit=""):
        from tracker.services import stock
        return stock.receive_stock(self.keeper, {"locationId": self.loc.id, "reason": "note", "attachmentIds": ["a"],
                                                 "lines": [{"name": name, "qty": qty, "unitCost": 100,
                                                            "unit": unit, "serials": serials or []}]})

    def test_first_mention_creates_it_and_later_ones_add_up(self):
        from tracker.models import InventoryItem
        from tracker.services import review, stock
        for m in self.receive("Deye inverter 20kVA", 2):
            review.check(self.checker, "stock_movement", m.id, "checked")
        it = InventoryItem.objects.get()
        self.assertEqual(it.name, "Deye inverter 20kVA")
        self.assertEqual(it.category, "inverter", "category derived from the name")
        self.assertEqual(stock.available(it.id, self.loc.id), 2)

        # same thing, written differently — must not become a second item
        for m in self.receive("deye   INVERTER 20kva", 3):
            review.check(self.checker, "stock_movement", m.id, "checked")
        self.assertEqual(InventoryItem.objects.count(), 1, "casing and spacing must not split the pile")
        self.assertEqual(stock.available(it.id, self.loc.id), 5)

    def test_serials_turn_tracking_on_when_they_first_appear(self):
        from tracker.models import InventoryItem
        self.receive("Pylontech US5000", 1)
        it = InventoryItem.objects.get()
        self.assertFalse(it.is_serialised)
        self.receive("Pylontech US5000", 1, serials=["PYL-0001"])
        it.refresh_from_db()
        self.assertTrue(it.is_serialised, "a delivery that carries serials starts tracking them")

    def test_a_line_still_needs_a_name(self):
        with self.assertRaises(ApiError):
            self.receive("   ", 1)


class SelfReviewTest(TestCase):
    """Finance, Director and Store Keeper may sign off their own work (user decision, 2026-09-20).
    Everyone else still needs a second person."""

    def setUp(self):
        from django.utils import timezone
        from tracker.models import Project
        from tracker.services import stock
        seed_rbac()

        def mk(uid, *roles):
            u = User.objects.create(id=uid, username=uid, name=uid, email=f"{uid}@wyreng.com")
            u.set_password("x" * 12); u.save(); u.roles.set(Role.objects.filter(code__in=roles)); return u

        # Submitting stock needs inventory.write (store keeper); checking it needs inventory.check
        # (finance / techlead). Signing off your OWN stock therefore needs both — which is the shape
        # of a small team where one person wears two hats.
        self.keeper = mk("u_sk", "store_keeper", "finance")
        self.fin = mk("u_fin", "finance")
        self.tech = mk("u_tech", "tech")
        self.lead = mk("u_lead", "techlead")
        self.loc = stock.add_location(self.keeper, {"name": "W", "type": "warehouse"})
        now = timezone.now()
        self.project = Project.objects.create(
            id="p_sr", code="WYR-2026-901", name="Self review", client_name="C", branch_name="B",
            location="L", project_type="solar_battery", stage=0, rag="green", pm=self.lead,
            lead_engineer=self.lead, contract_value=1, approved_budget=1, retention_percent=5,
            created_by=self.lead, updated_by=self.lead, created_at=now, updated_at=now)

    def _receive(self, actor):
        from tracker.services import stock
        return stock.receive_stock(actor, {"locationId": self.loc.id, "reason": "r", "attachmentIds": ["a"],
                                           "lines": [{"name": "Widget", "qty": 1, "unitCost": 10}]})[0]

    def test_a_trusted_role_may_check_their_own(self):
        from tracker.services import review, stock
        m = self._receive(self.keeper)
        review.check(self.keeper, "stock_movement", m.id, "checked")
        m.refresh_from_db()
        self.assertEqual(m.review_status, "checked")
        self.assertEqual(m.submitted_by_id, m.checked_by_id, "the audit trail still shows it was self-checked")
        self.assertEqual(stock.available(m.item_id, self.loc.id), 1)

    def test_their_own_now_appears_in_their_queue(self):
        from tracker.services import review
        m = self._receive(self.keeper)
        self.assertTrue([q for q in review.review_queue(self.keeper) if q["id"] == m.id],
                        "a store keeper must be able to find their own submission in order to check it")

    def test_a_techlead_still_cannot_check_their_own(self):
        """techlead holds visit.check, so this fails on segregation of duties rather than permission."""
        from tracker.services import field, review
        v = field.log_visit(self.lead, self.project.id, {
            "visitType": "routine", "startedAt": "2026-09-20T09:00:00Z", "endedAt": "2026-09-20T11:00:00Z",
            "findings": "f", "actionsTaken": "a", "attachmentIds": ["att1"]})
        with self.assertRaises(ApiError) as cm:
            review.check(self.lead, "site_visit", v.id, "checked")
        self.assertIn("segregation of duties", cm.exception.message)
        self.assertFalse([q for q in review.review_queue(self.lead) if q["id"] == v.id],
                         "and it stays out of their queue")

    def test_rule_is_by_role_not_by_who_submitted(self):
        from tracker import rbac
        self.assertTrue(rbac.may_self_review(self.fin))
        self.assertTrue(rbac.may_self_review(self.keeper))
        self.assertFalse(rbac.may_self_review(self.tech))
        self.assertFalse(rbac.may_self_review(self.lead))
