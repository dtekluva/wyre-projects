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

## Run locally

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

## Deploy notes

- `DEBUG=0`, real `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` = the web app origin(s).
- Serve `MEDIA_ROOT` (attachments, documents) from nginx or move `DEFAULT_FILE_STORAGE` to object storage (django-storages).
- `manage.py migrate && manage.py seed_rbac` on every release; create staff users in `/admin/` (assign tracker roles there).
- Nightly job to pull QuickBooks bills from the Wyre backend into `QbBill` (spec §4.10) — not yet wired.
