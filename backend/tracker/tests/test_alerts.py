"""§8 expiry and escalation engine. The engine reconciles rather than appends, so the same run twice changes
nothing and an alert whose cause is gone is withdrawn."""
from __future__ import annotations

from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tracker.models import Document, Notification, Project, User
from tracker.services import alerts, review


class AlertEngineTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)

    def kinds(self):
        return {a.kind for a in alerts.build()}

    def test_run_is_idempotent_and_withdraws_stale_alerts(self):
        first = alerts.run()
        self.assertGreater(first["created"], 0)
        again = alerts.run()
        self.assertEqual(again["created"], 0, "a second run creates nothing")
        self.assertEqual(again["withdrawn"], 0)
        self.assertEqual(Notification.objects.count(), first["created"])
        # resolve every cause and the inbox empties
        Notification.objects.all().delete()
        alerts.build_ = None  # guard against accidental caching
        with self.settings():
            empty = alerts.run()
        self.assertGreater(empty["created"], 0)
        before = Notification.objects.count()
        Document.objects.filter(expires_at__isnull=False).update(expires_at=timezone.now().date() + timedelta(days=400))
        after = alerts.run()
        self.assertLessEqual(Notification.objects.count(), before)
        self.assertNotIn("document_expiring", self.kinds(), "renewed documents stop being chased")

    def test_expiry_steps_and_severity(self):
        d = Document.objects.filter(review_status="checked").first()
        today = timezone.now().date()
        for days, severity in ((5, "critical"), (20, "warning"), (60, "info")):
            Document.objects.filter(pk=d.pk).update(expires_at=today + timedelta(days=days))
            hit = [a for a in alerts.build() if a.dedupe_key.startswith(f"document_expiring:{d.pk}")]
            self.assertEqual(len(hit), 1, f"{days} d out raises exactly one alert, not one per step")
            self.assertEqual(hit[0].severity, severity)
        Document.objects.filter(pk=d.pk).update(expires_at=today - timedelta(days=3))
        expired = [a for a in alerts.build() if a.kind == "document_expired" and a.ref["id"] == d.pk]
        self.assertEqual(len(expired), 1)
        self.assertEqual(expired[0].severity, "critical")

    def test_overdue_checks_prefer_the_people_answerable(self):
        """Roles are company-wide, so 'everyone who could check this' is most of the company. The engine narrows
        to project owners, and only widens when no owner is permitted to check that kind — documents are checked
        by a Lead Engineer or Director, budget lines by Finance, and neither need be assigned to the project."""
        from tracker import rbac
        users = {u.id: u for u in User.objects.filter(is_active=True)}
        overdue = [a for a in alerts.build() if a.kind == "check_overdue"]
        self.assertTrue(overdue, "the seed has checks older than the escalation threshold")
        narrowed = 0
        for a in overdue:
            self.assertTrue(a.recipients, "an alert with nobody to tell is useless")
            perm = review.CHECK_PERM[a.ref["model"]]
            item = next(i for i in review.pending_items() if i["id"] == a.ref["id"])
            eligible = {uid for uid, u in users.items()
                        if uid != item["submittedBy"] and rbac.can(u, perm, a.project_id)}
            self.assertTrue(set(a.recipients) <= eligible, "never tell someone who cannot act")
            owners = set(alerts._owners(Project.objects.get(pk=a.project_id))) if a.project_id else set()
            if owners & eligible:
                self.assertTrue(set(a.recipients) <= owners, "when an owner can check it, only owners are told")
                narrowed += 1
            else:
                self.assertEqual(set(a.recipients), eligible, "with no eligible owner, fall back to whoever can")
        self.assertGreater(narrowed, 0, "at least some alerts should narrow to owners")

    def test_nobody_is_told_to_check_their_own_work(self):
        for a in alerts.build():
            if a.kind != "check_overdue":
                continue
            item = next(i for i in review.pending_items() if i["id"] == a.ref["id"])
            self.assertNotIn(item["submittedBy"], a.recipients, "segregation of duties holds in alerts too")

    def test_api_lists_and_marks_read(self):
        alerts.run()
        c = APIClient()
        r = c.post("/api/v1/auth/token/", {"username": "kunle.adebayo", "password": "wyre-demo-2026"}, format="json")
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        body = c.get("/api/v1/notifications/").json()
        self.assertTrue(body["notifications"])
        self.assertEqual(body["unread"], len(body["notifications"]))
        first = body["notifications"][0]["id"]
        self.assertEqual(c.post("/api/v1/notifications/", {"ids": [first]}, format="json").json()["marked"], 1)
        self.assertEqual(c.get("/api/v1/notifications/").json()["unread"], body["unread"] - 1)
        c.post("/api/v1/notifications/", {"all": True}, format="json")
        self.assertEqual(c.get("/api/v1/notifications/").json()["unread"], 0)
        # one user's inbox is their own
        r = c.post("/api/v1/auth/token/", {"username": "segun.alabi", "password": "wyre-demo-2026"}, format="json")
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        mine = c.get("/api/v1/notifications/").json()
        self.assertTrue(all(n["id"] != first for n in mine["notifications"]))


class EmailDigestTest(TestCase):
    """The email channel is inert until configured, batches per person, and never repeats itself."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)

    def test_dry_run_reports_without_sending_or_marking(self):
        alerts.run()
        r = alerts.send_digests(send=False)
        self.assertTrue(r["dry_run"])
        self.assertTrue(r["planned"], "the seed raises alerts for several people")
        self.assertEqual(r["sent"], 0)
        self.assertEqual(Notification.objects.filter(emailed_at__isnull=False).count(), 0, "a dry run writes nothing")
        # one digest per person, not one per alert
        self.assertEqual(len({p["to"] for p in r["planned"]}), len(r["planned"]))
        self.assertTrue(all(p["alerts"] >= 1 for p in r["planned"]))

    def test_refuses_to_send_when_unconfigured(self):
        from tracker.services import mailer
        alerts.run()
        with self.settings(MAILGUN_API_KEY=""):
            self.assertFalse(mailer.configured())
            r = alerts.send_digests(send=True)
            self.assertEqual(r["sent"], 0)
            self.assertTrue(r["failed"], "every attempt fails loudly rather than silently doing nothing")
        self.assertEqual(Notification.objects.filter(emailed_at__isnull=False).count(), 0)

    def test_sends_once_then_stops(self):
        from tracker.services import mailer
        alerts.run()
        calls = []
        with self.settings(MAILGUN_API_KEY="test-key", MAILGUN_DOMAIN="mg.example.com"):
            original = mailer.send
            mailer.send = lambda to, subject, text, html=None, timeout=20: calls.append((to, subject)) or {"id": "ok"}
            try:
                first = alerts.send_digests(send=True)
                self.assertGreater(first["sent"], 0)
                self.assertEqual(len(calls), first["sent"])
                self.assertEqual(Notification.objects.filter(emailed_at__isnull=True).count(), 0)
                calls.clear()
                second = alerts.send_digests(send=True)
                self.assertEqual(second["sent"], 0, "nothing new to say, so nothing is sent")
                self.assertEqual(calls, [])
            finally:
                mailer.send = original

    def test_digest_body_carries_every_alert_and_escapes_html(self):
        alerts.run()
        user = User.objects.get(pk="u_pm1")
        rows = list(Notification.objects.filter(recipient=user))
        rows[0].title = "Permit <script>alert(1)</script> & co"
        text, html = alerts._digest_body(user, rows, "https://tracker.example.com")
        self.assertIn(user.name.split(" ")[0], text)
        self.assertIn("https://tracker.example.com", text)
        self.assertNotIn("<script>", html, "titles are untrusted text, not markup")
        self.assertIn("Permit &lt;script&gt;alert(1)&lt;/script&gt; &amp; co", html, "escaped once, in the right order")
        for n in rows[1:5]:
            self.assertIn(n.title, html, "every alert appears in the digest, not just the first few")
            self.assertIn(n.title, text)
