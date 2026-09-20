#!/usr/bin/env python3
"""Deploy webhook for tracker.wyreng.com — stdlib only, Python 3.8+.

Listens on loopback (nginx fronts it at /hooks/). GitHub Actions calls POST /hooks/deploy with {sha, ref}
after the test job is green; the request is HMAC-SHA256 signed with DEPLOY_HOOK_SECRET. A request with a
bad signature is refused before its body is read as anything. Only refs/heads/main is deployed. One deploy
runs at a time; a second request while one is running gets 409 and Actions retries.

GET /hooks/deploy/status returns the last deploy's state so the Actions job can wait for the result
instead of pretending 202 meant "done".
"""
import hmac
import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ.get("DEPLOY_HOOK_SECRET", "").encode()
SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/opt/wyre-tracker/ops/deploy-hook/deploy.sh")
STATE = os.environ.get("DEPLOY_STATE", "/opt/wyre-tracker/.deployed")
LOG = os.environ.get("DEPLOY_LOG", "/var/log/wyre-deploy.log")
PORT = int(os.environ.get("DEPLOY_PORT", "9001"))
BRANCH = os.environ.get("DEPLOY_REF", "refs/heads/main")
MAX_BODY = 16 * 1024

_lock = threading.Lock()   # held while a deploy runs


def log(msg: str) -> None:
    line = "[%s] hook: %s\n" % (datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), msg)
    sys.stderr.write(line)
    try:
        with open(LOG, "a") as f:
            f.write(line)
    except OSError:
        pass


def read_state() -> dict:
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def run_deploy(sha: str) -> None:
    try:
        with open(LOG, "a") as out:
            out.write("\n===== deploy %s requested %s =====\n" % (sha, datetime.now(timezone.utc).isoformat()))
            out.flush()
            rc = subprocess.call([SCRIPT, sha], stdout=out, stderr=subprocess.STDOUT)
        log("deploy %s finished rc=%s state=%s" % (sha[:8], rc, read_state().get("state")))
    finally:
        _lock.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "wyre-deploy-hook/1"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quieter than the default; the deploy log is the record
        pass

    def do_GET(self):
        if self.path.rstrip("/") == "/hooks/deploy/status":
            st = read_state()
            st["running"] = _lock.locked()
            return self._send(200, st)
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/hooks/deploy":
            return self._send(404, {"error": "not found"})
        if not SECRET:
            log("refused: DEPLOY_HOOK_SECRET is not configured")
            return self._send(503, {"error": "hook not configured"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._send(413, {"error": "bad body size"})
        raw = self.rfile.read(length)
        given = self.headers.get("X-Signature-256", "")
        expected = "sha256=" + hmac.new(SECRET, raw, sha256).hexdigest()
        if not hmac.compare_digest(given, expected):
            log("refused: bad signature from %s" % self.client_address[0])
            return self._send(401, {"error": "bad signature"})
        try:
            data = json.loads(raw.decode())
            sha, ref = str(data.get("sha", "")), str(data.get("ref", ""))
        except (ValueError, AttributeError):
            return self._send(400, {"error": "bad json"})
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            return self._send(400, {"error": "sha must be 40 hex chars"})
        if ref != BRANCH:
            log("ignored: ref %s is not %s" % (ref, BRANCH))
            return self._send(200, {"ignored": True, "reason": "not %s" % BRANCH})
        if not _lock.acquire(blocking=False):
            return self._send(409, {"error": "a deploy is already running", "running": read_state().get("sha")})
        log("accepted: deploy %s" % sha[:8])
        threading.Thread(target=run_deploy, args=(sha,), daemon=True).start()
        self._send(202, {"accepted": True, "sha": sha})


if __name__ == "__main__":
    if not SECRET:
        log("WARNING: DEPLOY_HOOK_SECRET is empty — every deploy request will be refused with 503")
    log("listening on 127.0.0.1:%d, deploying %s via %s" % (PORT, BRANCH, SCRIPT))
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
