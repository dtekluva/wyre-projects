#!/bin/bash
# Deploy one exact commit to production. Called by hook.py; safe to run by hand: ./deploy.sh <sha>
#
#   fetch → reset --hard <sha> → build api + web → up -d → health check (API answers 401)
#   on any failure after the checkout: reset to the previous sha, rebuild, restart, and say so.
#
# The api container runs `migrate` on start, so schema changes ride along. A rollback does NOT reverse
# migrations — they are written to be additive for exactly this reason.
set -uo pipefail
SHA="${1:?usage: deploy.sh <sha>}"
DIR=/opt/wyre-tracker
STATE="$DIR/.deployed"
COMPOSE="docker compose -f docker-compose.prod.yml"
export DOCKER_BUILDKIT=0   # 20.10's BuildKit hung pulling in this project before (see build.sh)
cd "$DIR" || exit 1

prev=$(git rev-parse HEAD)
t() { date -u +%H:%M:%S; }
state() { printf '{"sha":"%s","prev":"%s","state":"%s","at":"%s","note":"%s"}\n' "$SHA" "$prev" "$1" "$(date -u +%FT%TZ)" "${2:-}" > "$STATE"; }
build()  { echo "[$(t)] building api + web"; $COMPOSE build api web 2>&1 | grep -E "Successfully tagged|ERROR|error:" ; return "${PIPESTATUS[0]}"; }
up()     { echo "[$(t)] restarting"; $COMPOSE up -d api scheduler web 2>&1 | grep -E "Started|Error"; }
health() {
  echo "[$(t)] health check"
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/v1/snapshot/ || true)
    if [ "$code" = "401" ]; then echo "[$(t)] api up (401 as expected)"; return 0; fi
    sleep 3
  done
  echo "[$(t)] api did not come up (last code: ${code:-none})"; return 1
}

state running
echo "[$(t)] deploy $SHA (was $prev)"
git fetch -q origin           || { state failed "git fetch failed"; exit 1; }
git cat-file -e "$SHA^{commit}" 2>/dev/null || { state failed "commit $SHA not on origin"; exit 1; }
git reset -q --hard "$SHA"    || { state failed "checkout failed"; exit 1; }

if build && up && health; then
  state ok
  echo "[$(t)] DONE — $SHA live"
  exit 0
fi

echo "[$(t)] FAILED — rolling back to $prev"
git reset -q --hard "$prev"
if build && up && health; then
  state rolled_back "new build failed or was unhealthy; $prev restored"
  echo "[$(t)] rolled back, $prev live again"
else
  state failed "rollback to $prev is ALSO unhealthy — needs a human"
  echo "[$(t)] ROLLBACK UNHEALTHY — manual intervention required"
fi
exit 1
