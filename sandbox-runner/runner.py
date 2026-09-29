"""
HireOS sandbox runner — the only component allowed to launch sandbox containers
or talk to the SQL sandbox. Next.js never touches Docker.

  * binds to 127.0.0.1 only (not configurable)
  * every execution request must carry an HMAC-SHA256 signature over
    timestamp, method, path and body hash (30 s window, replay-protected)
  * bounded concurrency and a bounded wait queue — never a general compute service
  * refuses to start if HireOS production secrets are present in its environment
  * never logs request bodies (candidate code, queries, test data)
"""

import hashlib
import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import code_exec  # noqa: E402
import sql_exec  # noqa: E402

RUNNER_VERSION = "sandbox-runner-v1"
HOST = "127.0.0.1"
MAX_BODY = 2 * 1024 * 1024
SKEW_S = 30
MAX_CONCURRENT = 2
MAX_WAITING = 4
FORBIDDEN_ENV = (
    "DATABASE_URL", "AUTH_SECRET", "OLLAMA_API_KEY", "POSTGRES_PASSWORD",
    "SMTP_PASS", "DJANGO_SECRET_KEY", "JWT_SECRET",
)


class State:
    def __init__(self, secret, sql_cfg, manifest):
        self.secret = secret.encode()
        self.sql_cfg = sql_cfg
        self.manifest = manifest
        self.slots = threading.BoundedSemaphore(MAX_CONCURRENT)
        self.waiting = 0
        self.lock = threading.Lock()
        self.seen = {}
        self.sql_ready = False
        self.provision_lock = threading.Lock()

    def remember(self, sig):
        now = time.time()
        with self.lock:
            for k in [k for k, exp in self.seen.items() if exp < now]:
                del self.seen[k]
            if sig in self.seen:
                return False
            self.seen[sig] = now + 2 * SKEW_S
            return True


STATE = None


def sign(secret, ts, method, path, body):
    msg = "%s.%s.%s.%s" % (ts, method, path, hashlib.sha256(body).hexdigest())
    return hmac.new(secret, msg.encode(), hashlib.sha256).hexdigest()


class Handler(BaseHTTPRequestHandler):
    server_version = "hireos-sandbox"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        started = time.monotonic()
        status = self._handle_post()
        sys.stderr.write("[runner] POST %s -> %d (%d ms)\n" % (self.path, status, (time.monotonic() - started) * 1000))

    def _handle_post(self):
        if self.path not in ("/v1/code/execute", "/v1/sql/execute"):
            self._send(404, {"error": "not found"})
            return 404
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            self._send(413, {"error": "bad body size"})
            return 413
        body = self.rfile.read(length)

        ts = self.headers.get("X-HireOS-Timestamp", "")
        sig = self.headers.get("X-HireOS-Signature", "")
        if not ts.isdigit() or abs(time.time() - int(ts)) > SKEW_S:
            self._send(401, {"error": "unauthorized"})
            return 401
        expected = sign(STATE.secret, ts, "POST", self.path, body)
        if not hmac.compare_digest(expected, sig) or not STATE.remember(sig):
            self._send(401, {"error": "unauthorized"})
            return 401

        try:
            payload = json.loads(body)
        except ValueError:
            self._send(400, {"error": "bad json"})
            return 400

        with STATE.lock:
            if STATE.waiting >= MAX_WAITING + MAX_CONCURRENT:
                self._send(503, {"error": "busy"})
                return 503
            STATE.waiting += 1
        try:
            if not STATE.slots.acquire(timeout=30):
                self._send(503, {"error": "busy"})
                return 503
            try:
                if self.path == "/v1/code/execute":
                    result = code_exec.execute(payload)
                else:
                    if STATE.sql_cfg is None:
                        result = {"status": "INFRA_ERROR"}
                    else:
                        with STATE.provision_lock:
                            if not STATE.sql_ready:
                                sql_exec.provision(STATE.sql_cfg, STATE.manifest)
                                STATE.sql_ready = True
                        result = sql_exec.execute(STATE.sql_cfg, STATE.manifest, payload)
            finally:
                STATE.slots.release()
        except (code_exec.BadRequest, sql_exec.BadRequest) as exc:
            self._send(400, {"error": str(exc)})
            return 400
        except Exception as exc:  # never leak internals to the caller
            sys.stderr.write("[runner] internal error: %s\n" % exc.__class__.__name__)
            self._send(500, {"error": "internal error"})
            return 500
        finally:
            with STATE.lock:
                STATE.waiting -= 1

        result["runnerVersion"] = RUNNER_VERSION
        self._send(200, result)
        return 200


def main():
    global STATE
    leaked = [k for k in FORBIDDEN_ENV if os.environ.get(k)]
    if leaked:
        sys.stderr.write("[runner] refusing to start: production secrets present in environment: %s\n" % ", ".join(leaked))
        sys.exit(2)
    secret = os.environ.get("SANDBOX_RUNNER_SECRET", "")
    if len(secret) < 32:
        sys.stderr.write("[runner] SANDBOX_RUNNER_SECRET missing or too short\n")
        sys.exit(2)
    port = int(os.environ.get("SANDBOX_RUNNER_PORT", "8010"))

    try:
        sql_cfg = sql_exec.Config(os.environ)
    except RuntimeError as exc:
        sys.stderr.write("[runner] SQL sandbox disabled: %s\n" % exc)
        sql_cfg = None
    manifest = sql_exec.load_manifest()
    STATE = State(secret, sql_cfg, manifest)

    removed = code_exec.sweep_leftovers()
    sys.stderr.write("[runner] swept %d leftover sandbox containers\n" % max(removed, 0))
    if sql_cfg is not None:
        try:
            sql_exec.provision(sql_cfg, manifest)
            STATE.sql_ready = True
            sys.stderr.write("[runner] SQL sandbox provisioned (%d tasks)\n" % len(manifest))
        except Exception as exc:
            sys.stderr.write("[runner] SQL sandbox not ready yet (%s); will retry on demand\n" % exc.__class__.__name__)

    server = ThreadingHTTPServer((HOST, port), Handler)
    server.daemon_threads = True
    sys.stderr.write("[runner] %s listening on http://%s:%d\n" % (RUNNER_VERSION, HOST, port))
    server.serve_forever()


if __name__ == "__main__":
    main()
