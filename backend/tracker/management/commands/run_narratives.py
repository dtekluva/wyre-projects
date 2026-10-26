"""Write any queued period-summary paragraphs. Run by the scheduler; safe to run by hand."""
from django.core.management.base import BaseCommand

from tracker.services import ai, narratives


class Command(BaseCommand):
    help = "Write queued period-summary paragraphs with Claude."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=5, help="Most paragraphs to write in one pass")

    def handle(self, *args, **opts):
        if not ai.configured():
            return
        res = narratives.run_queued(limit=opts["limit"])
        if res["done"] or res["failed"]:
            self.stdout.write(self.style.SUCCESS(f"narratives written={res['done']} failed={res['failed']}"))
