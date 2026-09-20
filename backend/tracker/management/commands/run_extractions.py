"""Drain the extraction queue. Run by the scheduler; safe to run by hand."""
from django.core.management.base import BaseCommand

from tracker.services import ai, extractions


class Command(BaseCommand):
    help = "Read any queued documents with Claude and record what they say."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=5, help="Most files to read in one pass")

    def handle(self, *args, **opts):
        if not ai.configured():
            self.stdout.write("Claude is not configured — nothing to do")
            return
        res = extractions.run_queued(limit=opts["limit"])
        if res["done"] or res["failed"]:
            self.stdout.write(self.style.SUCCESS(f"extractions read={res['done']} failed={res['failed']}"))
