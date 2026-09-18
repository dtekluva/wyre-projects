#!/usr/bin/env python3
"""Ingestion watchdog for the Wyre MQTT box.

Why this exists: on 2026-09-18 `wyremqtt.service` sat `active (running)` with zero restarts, both its broker
and database connections open, and delivered nothing for 46 minutes. Every liveness signal said healthy. The
only true signal is whether rows are still landing, so that is what this checks.

It compares the newest write per `source_type` in Mongo against a staleness threshold and restarts the one
service responsible for a stalled path.

Deliberate safety properties:
  * If Mongo cannot be reached it does NOTHING. "I cannot see the data" must never be confused with
    "the data stopped", or a network blip would restart every service on the box.
  * A path that has never written is ignored — there is no baseline to call it stale against.
  * Only services on ALLOWED may be restarted, so a bad config cannot take out something unrelated.
  * One restart per run, a per-service cooldown, and an hourly cap, so a genuinely dead upstream produces a
    handful of restarts and a loud log rather than a restart loop.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ENV_FILE = Path(os.environ.get("WYRE_ENV", "/home/wyremqtt/.env"))
STATE_FILE = Path(os.environ.get("WATCHDOG_STATE", "/var/lib/wyre-watchdog/state.json"))

# source_type in Mongo -> the systemd unit that produces it
PATHS = {
    "awt200": "wyremqttawt200.service",
    "adw300_external": "wyremqtt.service",
}
ALLOWED = set(PATHS.values())

STALE_MINUTES = int(os.environ.get("STALE_MINUTES", "15"))
COOLDOWN_MINUTES = int(os.environ.get("COOLDOWN_MINUTES", "10"))
MAX_RESTARTS_PER_HOUR = int(os.environ.get("MAX_RESTARTS_PER_HOUR", "4"))


def log(msg: str) -> None:
    print(f"[watchdog {datetime.now(timezone.utc).astimezone():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def mongo_uri() -> str:
    for line in ENV_FILE.read_text().splitlines():
        m = re.match(r'\s*[A-Z_]*MONGO[A-Z_]*\s*=\s*"?([^"\n]+)"?', line)
        if m and "mongodb" in m.group(1):
            return m.group(1).strip()
    raise SystemExit(f"no mongodb URI found in {ENV_FILE}")


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except Exception as exc:
        log(f"could not persist state: {exc}")


def newest_writes() -> dict[str, datetime]:
    """Newest write per source_type. Raises if Mongo is unreachable — the caller must then do nothing."""
    from pymongo import MongoClient, DESCENDING
    client = MongoClient(mongo_uri(), tlsAllowInvalidCertificates=True,
                         serverSelectionTimeoutMS=20000, connectTimeoutMS=20000)
    coll = client["wyremqtt"]["mqtt_processed_logs"]
    out: dict[str, datetime] = {}
    for source in PATHS:
        doc = coll.find_one({"source_type": source}, sort=[("_id", DESCENDING)], projection={"_id": 1})
        if doc:
            out[source] = doc["_id"].generation_time
    client.close()
    return out


def restart(unit: str, dry_run: bool) -> bool:
    if unit not in ALLOWED:
        log(f"refusing to restart {unit}: not in the allowlist")
        return False
    if dry_run:
        log(f"DRY RUN: would restart {unit}")
        return False
    r = subprocess.run(["systemctl", "restart", unit], capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        log(f"restarted {unit}")
        return True
    log(f"FAILED to restart {unit}: {r.stderr.strip()[:200]}")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="report only, never restart")
    ap.add_argument("--stale-minutes", type=int, default=STALE_MINUTES)
    args = ap.parse_args()

    try:
        newest = newest_writes()
    except Exception as exc:
        # Cannot see the data: say so and stop. Restarting blind would be worse than waiting.
        log(f"cannot reach Mongo ({type(exc).__name__}: {exc}) — taking no action")
        return 0

    now = datetime.now(timezone.utc)
    state = load_state()
    history = [t for t in state.get("restarts", []) if now - datetime.fromisoformat(t) < timedelta(hours=1)]

    stalled: list[tuple[str, str, float]] = []
    for source, unit in PATHS.items():
        if source not in newest:
            log(f"{source}: never written, nothing to compare — skipping")
            continue
        age = (now - newest[source]).total_seconds() / 60
        mark = "STALE" if age > args.stale_minutes else "ok"
        log(f"{source:<18} last write {age:6.1f} min ago  [{mark}]")
        if age > args.stale_minutes:
            stalled.append((source, unit, age))

    if not stalled:
        state["restarts"] = history
        save_state(state)
        return 0

    if len(history) >= MAX_RESTARTS_PER_HOUR:
        log(f"{len(stalled)} path(s) stalled but {len(history)} restarts already this hour — holding off, "
            f"this needs a human")
        save_state({**state, "restarts": history})
        return 1

    # one per run: restart the worst offender, then let the next tick judge the result
    source, unit, age = max(stalled, key=lambda s: s[2])
    last = state.get("last_restart", {}).get(unit)
    if last and now - datetime.fromisoformat(last) < timedelta(minutes=COOLDOWN_MINUTES):
        log(f"{unit} restarted {int((now - datetime.fromisoformat(last)).total_seconds() // 60)} min ago — "
            f"within the {COOLDOWN_MINUTES} min cooldown, waiting")
        return 1

    log(f"{source} stalled for {age:.1f} min — restarting {unit}")
    if restart(unit, args.dry_run):
        history.append(now.isoformat())
        state.setdefault("last_restart", {})[unit] = now.isoformat()
        state["restarts"] = history
        save_state(state)
        time.sleep(20)
        try:
            after = newest_writes()
            fresh = (now - after[source]).total_seconds() / 60 if source in after else None
            log(f"post-restart check: {source} last write {fresh:.1f} min ago" if fresh is not None
                else f"post-restart check: {source} still has no writes")
        except Exception as exc:
            log(f"post-restart check failed: {type(exc).__name__}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
