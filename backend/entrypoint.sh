#!/bin/sh
# Wait for Postgres, apply migrations, seed the RBAC matrix + thresholds, then run the server.
set -e

python - <<'PY'
import os, time, sys
from urllib.parse import urlparse
import psycopg

url = os.environ.get("DATABASE_URL", "")
if url.startswith("postgres"):
    u = urlparse(url)
    for attempt in range(60):
        try:
            psycopg.connect(dbname=u.path.lstrip("/"), user=u.username, password=u.password, host=u.hostname, port=u.port or 5432, connect_timeout=3).close()
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

if [ "$SEED_DEMO" = "1" ]; then
  python manage.py seed_demo
fi

exec "$@"
