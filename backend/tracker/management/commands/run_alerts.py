"""Recompute §8 notifications. Idempotent — schedule it as often as you like (hourly is plenty)."""
from django.core.management.base import BaseCommand

from tracker.services import alerts


class Command(BaseCommand):
    help = "Rebuild in-app notifications: expiries, overdue checks, pending approvals, SLA breaches, budget and stock alerts."

    def add_arguments(self, parser):
        parser.add_argument("--keep-stale", action="store_true", help="Do not withdraw alerts whose condition has passed")
        parser.add_argument("--dry-run", action="store_true", help="Report what would be raised without writing")

    def handle(self, *args, **opts):
        if opts["dry_run"]:
            found = alerts.build()
            by_kind: dict[str, int] = {}
            for a in found:
                by_kind[a.kind] = by_kind.get(a.kind, 0) + 1
            for kind, n in sorted(by_kind.items(), key=lambda x: -x[1]):
                self.stdout.write(f"  {n:>4}  {kind}")
            self.stdout.write(self.style.SUCCESS(f"{len(found)} alert(s) would be raised across {sum(len(a.recipients) for a in found)} recipient slots"))
            return
        result = alerts.run(prune=not opts["keep_stale"])
        self.stdout.write(self.style.SUCCESS(
            f"{result['alerts']} alerts → {result['created']} new, {result['refreshed']} refreshed, {result['withdrawn']} withdrawn"))
