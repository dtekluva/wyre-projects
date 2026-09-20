"""Long-running scheduler for the §8 alert engine.

Runs as its own container in the compose stack rather than as a host cron entry, so the schedule travels with
the deployment instead of living on whichever laptop happened to set it up. Standard library only — no cron
daemon in the image, no extra dependency.

  ALERTS_INTERVAL_MINUTES   how often to reconcile alerts (default 60)
  DIGEST_AT                 local time to send the email digest, HH:MM (default 07:30)
  DIGEST_ENABLED            1 to actually send; anything else reports and sends nothing
  DIGEST_TO                 optional override address — every digest goes here instead of the real recipients
"""
from __future__ import annotations

import os
import signal
import time
from datetime import datetime, timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone


def _hhmm(raw: str, fallback: tuple[int, int]) -> tuple[int, int]:
    try:
        h, m = raw.split(":")
        h, m = int(h), int(m)
        if 0 <= h < 24 and 0 <= m < 60:
            return h, m
    except Exception:
        pass
    return fallback


class Command(BaseCommand):
    help = "Run the alert engine on a schedule (reconcile periodically, email a digest once a day)."

    def handle(self, *args, **opts):
        interval = max(1, int(os.environ.get("ALERTS_INTERVAL_MINUTES", "60")))
        digest_h, digest_m = _hhmm(os.environ.get("DIGEST_AT", "07:30"), (7, 30))
        digest_on = os.environ.get("DIGEST_ENABLED", "0") == "1"
        digest_to = (os.environ.get("DIGEST_TO") or "").strip() or None

        stopping = {"now": False}
        signal.signal(signal.SIGTERM, lambda *_: stopping.__setitem__("now", True))
        signal.signal(signal.SIGINT, lambda *_: stopping.__setitem__("now", True))

        self.say(f"scheduler up · reconcile every {interval} min · digest at {digest_h:02d}:{digest_m:02d} "
                 f"({'enabled' if digest_on else 'reporting only'}"
                 + (f", forced to {digest_to}" if digest_to else "") + f") · timezone {timezone.get_current_timezone()}")

        next_reconcile = timezone.localtime()              # once at boot, so the app is never stale on start
        next_digest = self._next_digest(timezone.localtime(), digest_h, digest_m)

        while not stopping["now"]:
            now = timezone.localtime()
            if now >= next_reconcile:
                self.safely("run_alerts")
                next_reconcile = now + timedelta(minutes=interval)
            # Cheap when the queue is empty (one indexed count), so it rides the same tick as everything
            # else rather than earning its own timer.
            self.safely("run_extractions")
            if now >= next_digest:
                args_ = ["--send"] if digest_on else []
                if digest_to:
                    args_ += ["--to", digest_to]
                self.safely("send_alert_emails", *args_)
                next_digest = self._next_digest(now + timedelta(minutes=1), digest_h, digest_m)
            # wake often enough to notice a SIGTERM promptly, but not so often that it busies a core
            for _ in range(30):
                if stopping["now"]:
                    break
                time.sleep(1)
        self.say("scheduler stopped")

    @staticmethod
    def _next_digest(after: datetime, h: int, m: int) -> datetime:
        target = after.replace(hour=h, minute=m, second=0, microsecond=0)
        return target if target > after else target + timedelta(days=1)

    def say(self, msg: str) -> None:
        self.stdout.write(f"[scheduler {timezone.localtime():%Y-%m-%d %H:%M:%S}] {msg}", ending="\n")
        self.stdout.flush()

    def safely(self, command: str, *args: str) -> None:
        """A failing job must never take the scheduler down with it."""
        try:
            self.say(f"running {command} {' '.join(args)}".strip())
            call_command(command, *args)
        except Exception as exc:                                   # noqa: BLE001 - deliberately broad
            self.say(f"{command} FAILED: {type(exc).__name__}: {exc}")
