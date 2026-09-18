# MQTT ingestion watchdog

## Why

On 2026-09-18 `wyremqtt.service` sat `active (running)` with zero restarts, both its MQTT broker and MongoDB
connections open, and 5 seconds of CPU across 51 minutes — while writing nothing to the database for 46
minutes. Every liveness signal reported healthy. The ADW300 external path had silently lost its subscription,
most likely during three reboots inside one minute.

The lesson: *process alive* is not *data flowing*. This watchdog checks the only thing that matters, whether
rows are still landing, and restarts the one service responsible for a path that has gone quiet.

## What it does

Compares the newest write per `source_type` in `wyremqtt.mqtt_processed_logs` against a staleness threshold:

| source_type | service |
|---|---|
| `awt200` | `wyremqttawt200.service` |
| `adw300_external` | `wyremqtt.service` |

## Safety

- **Mongo unreachable → do nothing.** "I cannot see the data" must never be treated as "the data stopped",
  or a network blip restarts every service on the box.
- **A path that has never written is skipped** — there is no baseline to call it stale against.
- **Allowlist.** Only the two units above can be restarted, so a bad config cannot touch anything else.
- **One restart per run**, a 10-minute per-service cooldown, and a cap of 4 per hour. A genuinely dead
  upstream therefore produces a few restarts and a loud log, never a restart loop.
- After restarting it waits 20 s and re-checks, so the log says whether it actually helped.

## Install

```bash
scp watchdog.py root@137.184.64.23:/opt/wyre-watchdog/watchdog.py
scp wyre-watchdog.{service,timer} root@137.184.64.23:/etc/systemd/system/
ssh root@137.184.64.23 'systemctl daemon-reload && systemctl enable --now wyre-watchdog.timer'
```

## Operate

```bash
python3 /opt/wyre-watchdog/watchdog.py --dry-run   # report, never act
journalctl -u wyre-watchdog.service -n 40          # what it has been doing
systemctl list-timers wyre-watchdog.timer          # when it next runs
```

Tune via `Environment=` lines in the unit: `STALE_MINUTES`, `COOLDOWN_MINUTES`, `MAX_RESTARTS_PER_HOUR`.
Raise `STALE_MINUTES` if a low-volume path produces false positives; 15 minutes suits the observed rates,
where AWT200 writes continuously and ADW300 external writes several times a minute.
