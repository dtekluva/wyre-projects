# Wyre Tracker — backend

Standalone Django 5.2 + DRF project that implements the same surface as the web app's mock API
(`packages/api/src/client.ts`). Every rule in the spec — RBAC (§2), stage gates (§3), actor capture and
maker-checker (§4.13), approvals with threshold routing (§5), the stock ledger with weighted-average cost (§4.15) —
is enforced here, server-side. The web app switches from mock to live data with no UI changes.

## Layout

```
backend/
  config/            settings (env-driven), urls, wsgi
  tracker/
    models.py        domain models — string PKs so ids match the mock (e.g. loc_wh)
    rbac.py          §2.2 matrix (seeded into RolePermission, editable by Admin), can()/roles_on()
    gates.py         §3 stages, evidence doc types, approver roles
    services/        the rules — one module per area (projects, documents, review, gates, approvals, money, stock, recon, field)
    serializers.py   model → JSON in the exact shape of packages/api/src/types.ts; snapshot(user) = scoped read model
    commands.py      registry: one command per MockApi mutation (same argument names; actor from the JWT)
    views.py, urls.py
    management/commands/seed_rbac.py   idempotent roles + matrix + §11 thresholds (run on every deploy)
    management/commands/seed_demo.py   demo data set identical to the mock (never on production data)
    tests/test_rules.py                port of packages/api/test/flow.test.mjs + HTTP tests
```

## API (all under `/api/v1/`, JWT bearer auth)

| Endpoint | Purpose |
|---|---|
| `POST auth/token/` `{username, password}` | access + refresh tokens + user |
| `POST auth/token/refresh/` | new access token |
| `GET me/` | signed-in user with role codes |
| `GET snapshot/` | everything the user may see (projects they are a member of; global roles see all). The web app computes gates, money, balances and queues from this locally. |
| `POST commands/<name>/` | one mutation; JSON body, or multipart with `payload` JSON + `file`. Returns `{result, snapshot}` (`?snapshot=0` to skip). Errors: `{code, message}` with 400 invalid · 403 forbidden · 404 not_found · 409 conflict. |
| `GET reviews/`, `GET approvals/mine/`, `GET projects/<id>/money/`, `GET stock/balances/`, `GET finance/qb-bills/` | server-side views of the derived data (for reports / other clients) |

Commands accept a client-generated `id` (`prefix_8hex`) on created records so the web app can apply changes
optimistically and the field PWA's offline queue replays with stable ids.

## Run with Docker (recommended)

```bash
cd backend
cp .env.docker.example .env.docker     # set POSTGRES_PASSWORD and SECRET_KEY
docker compose --env-file .env.docker up -d --build
```

Two containers: `db` (Postgres 16, data in the `pgdata` volume) and `api` (gunicorn on
http://localhost:8000, uploads in the `media` volume). The entrypoint waits for Postgres, runs
`migrate` and `seed_rbac` on every start, and runs `seed_demo` when `SEED_DEMO=1`.

```bash
docker compose --env-file .env.docker logs -f api        # logs
docker compose --env-file .env.docker exec api python manage.py createsuperuser
docker compose --env-file .env.docker exec api python manage.py test tracker
docker compose --env-file .env.docker down               # stop (keeps data)
docker compose --env-file .env.docker down -v            # stop and delete the database + uploads
```

Web app against it: `VITE_API_URL=http://localhost:8000/api/v1 npm run dev`.
Postgres is also published on `localhost:5433` for `psql` inspection.

## Run locally without Docker

```bash
cd backend
python3.13 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # set DATABASE_URL (Postgres) and SECRET_KEY
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_rbac
.venv/bin/python manage.py seed_demo          # optional demo users/projects; password printed
.venv/bin/python manage.py runserver 8000
```

Web app against it: `VITE_API_URL=http://localhost:8000/api/v1 npm run dev` (or copy `apps/web/.env.example`).
Tests: `.venv/bin/python manage.py test tracker`.

## Uploads (spec §9)

Uploads go to DigitalOcean Spaces when `SPACES_BUCKET` is set, and to `MEDIA_ROOT` on disk otherwise, so local
development and the demo need no credentials.

```bash
SPACES_BUCKET=wyre-tracker
SPACES_REGION=fra1
SPACES_KEY=...
SPACES_SECRET=...
SPACES_URL_EXPIRY=900      # seconds a signed download link stays valid
```

Keep the bucket **private**. Every read is served as a short-lived pre-signed URL generated per request, so no
object is ever publicly readable.

Keys are content-addressed as `attachments/<project>/<sha256><ext>` and `documents/<project>/<sha256><ext>`:

- identical bytes always land on the same key, so re-uploading the same photo cannot create a second copy;
- a different file can never take an existing key, which is how "originals are never overwritten" is enforced;
- the sha256 stored on the row is the hash of the bytes actually received, computed server-side.

## Alerts (spec §8)

`run_alerts` derives every alert that should currently exist and reconciles it against the stored
notifications, so it is idempotent and self-healing — an alert whose cause has gone is withdrawn, not left to
rot. Run it as often as you like; hourly is plenty.

```bash
docker compose --env-file .env.docker exec api python manage.py run_alerts --dry-run   # what would be raised
docker compose --env-file .env.docker exec api python manage.py run_alerts             # reconcile
docker compose --env-file .env.docker exec api python manage.py send_alert_emails      # report, sends nothing
docker compose --env-file .env.docker exec api python manage.py send_alert_emails --send --to you@example.com
```

Covered: documents expiring at 90 / 30 / 7 days and expired, checks past the escalation threshold, approvals
awaiting a decision, gates ready to request, issues past SLA, budget at 90 % and over 100 %, stock below reorder,
and unreconciled QuickBooks bills. Recipients are narrowed to the people answerable for a project, widening only
when nobody assigned is permitted to act — roles are company-wide, so "everyone who could" is most of the company.

Email is one digest per person covering what they have not been told about yet, never one message per alert.
It is inert until `MAILGUN_API_KEY` is set, and `send_alert_emails` reports without sending unless `--send`
is given. Use `--to` to route a real test to a single address.

### The schedule

A third container, `scheduler`, runs the jobs — not a host cron entry, so the schedule travels with the
deployment instead of living on whoever's machine set it up. It uses the same image, needs no cron daemon, and
restarts with everything else.

```
ALERTS_INTERVAL_MINUTES=60   # reconcile this often
DIGEST_AT=07:30              # local time (TIME_ZONE, currently Africa/Lagos)
DIGEST_ENABLED=0             # 1 to actually send; 0 reports and sends nothing
DIGEST_TO=                   # optional: force every digest to one address while testing
```

`docker compose logs -f scheduler` shows each run. A job that throws is logged and the scheduler carries on;
it reconciles once at boot so the app is never stale after a restart.

**Leave `DIGEST_ENABLED=0` until the user accounts are real people.** The demo accounts use placeholder
addresses at the live wyreng.com domain, so sending to them would bounce mail off a real domain and cost you
sending reputation.

## Deploy notes

- `DEBUG=0`, real `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` = the web app origin(s).
- The same compose file runs on a server; put nginx in front for TLS and to serve `/media/`.
- Serve `MEDIA_ROOT` (attachments, documents) from nginx or move `DEFAULT_FILE_STORAGE` to object storage (django-storages).
- `manage.py migrate && manage.py seed_rbac` on every release; create staff users in `/admin/` (assign tracker roles there).
- Nightly job to pull QuickBooks bills from the Wyre backend into `QbBill` (spec §4.10) — not yet wired.
