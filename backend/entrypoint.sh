#!/bin/sh
# Wait for Postgres, apply migrations, seed the RBAC matrix + thresholds, then run the server.
set -e

python - <<'PY'
import os, time, sys
import psycopg

url = os.environ.get("DATABASE_URL", "")
if url.startswith("postgres"):
    for attempt in range(60):
        try:
            # the whole URL, not picked-apart pieces: psycopg speaks libpq conninfo, so ?sslmode=require
            # and friends survive — a managed cluster rejects the connection without them
            psycopg.connect(url, connect_timeout=5).close()
            print("database ready", flush=True)
            break
        except Exception as exc:
            print(f"waiting for database ({attempt + 1}/60): {exc.__class__.__name__}", flush=True)
            time.sleep(2)
    else:
        sys.exit("database did not become ready")
PY

python manage.py migrate --noinput
python manage.py seed_rbac
# whitenoise serves from STATIC_ROOT, so the admin's assets have to be collected into it first
python manage.py collectstatic --noinput --clear >/dev/null

if [ "$SEED_DEMO" = "1" ]; then
  python manage.py seed_demo
fi

exec "$@"
