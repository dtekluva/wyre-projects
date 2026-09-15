"""Mail each person a digest of their new §8 alerts. Dry by default — pass --send to actually deliver."""
from django.core.management.base import BaseCommand

from tracker.services import alerts


class Command(BaseCommand):
    help = "Email a digest of new alerts. Reports without sending unless --send is given."

    def add_arguments(self, parser):
        parser.add_argument("--send", action="store_true", help="Actually deliver (otherwise report only)")
        parser.add_argument("--user", help="Limit to one user id, e.g. u_pm1")
        parser.add_argument("--to", help="Override every recipient address — for testing delivery safely")

    def handle(self, *args, **opts):
        r = alerts.send_digests(send=opts["send"], only_user=opts.get("user"), override_to=opts.get("to"))
        if not r["configured"]:
            self.stdout.write(self.style.WARNING("Mailgun is not configured — set MAILGUN_API_KEY to enable delivery"))
        for p in r["planned"]:
            self.stdout.write(f"  {p['to']:<34} {p['alerts']:>3} alerts ({p['critical']} critical)  {p['subject']}")
        for name, why in r["skipped"]:
            self.stdout.write(self.style.WARNING(f"  skipped {name}: {why}"))
        for name, why in r["failed"]:
            self.stdout.write(self.style.ERROR(f"  FAILED {name}: {why}"))
        verb = "would send" if r["dry_run"] else "sent"
        self.stdout.write(self.style.SUCCESS(f"{verb} {len(r['planned']) if r['dry_run'] else r['sent']} digest(s)"))
