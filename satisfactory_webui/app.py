"""Satisfactory WebUI — LAN admin console HTTP server.

Stdlib-only. Binds to a single private address, admits loopback plus the
configured private subnets, and enforces a random CSRF token + same-Origin
check on every POST. No authentication: every admitted client can administer
the game server, so this must never be exposed through a public proxy without
adding auth and HTTPS first.
"""
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from . import __version__
from . import api, control, fields

# --- Configuration (overridable via environment) ---------------------------
BIND = os.environ.get("SATISFACTORY_BIND", "192.168.4.60")
PORT = int(os.environ.get("SATISFACTORY_PORT", "8082"))
# Comma-separated CIDR subnets admitted in addition to loopback.
NETWORKS = os.environ.get(
    "SATISFACTORY_NETWORKS", "192.168.4.0/22,127.0.0.0/8"
).split(",")
# Exact Host header allowlist (comma-separated).
HOSTS = os.environ.get(
    "SATISFACTORY_HOSTS",
    "192.168.4.60:8082,127.0.0.1:8082,localhost:8082,satisfactory:8082",
).split(",")

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
CONFIG_DIR = "/home/satisfactory/server/FactoryGame/Saved/Config/LinuxServer"
ENGINE_INI = os.path.join(CONFIG_DIR, "Engine.ini")
GAMEUSER_INI = os.path.join(CONFIG_DIR, "GameUserSettings.ini")
STEAM_MANIFEST = "/home/satisfactory/server/steamapps/appmanifest_1690800.acf"
GAME_METADATA = "/home/satisfactory/server/Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version"

_csrf = secrets.token_urlsafe(32)
_poll_lock = threading.Lock()
_poll_cache = {"ts": 0, "data": None}
POLL_TTL = 2.0


# --- IP / Host admission ----------------------------------------------------
def _ip_to_int(ip):
    return int.from_bytes(socket.inet_aton(ip), "big")


def _net_to_range(cidr):
    net, _, bits = cidr.partition("/")
    base = _ip_to_int(net)
    mask = (0xFFFFFFFF << (32 - int(bits))) & 0xFFFFFFFF
    return base & mask, base | (~mask & 0xFFFFFFFF)


_RANGES = []
for c in NETWORKS:
    c = c.strip()
    if c:
        try:
            _RANGES.append(_net_to_range(c))
        except Exception:
            pass


def _client_ip(handler):
    return handler.client_address[0]


def _admitted(ip):
    if ip == "127.0.0.1" or ip == "::1":
        return True
    try:
        n = _ip_to_int(ip)
    except Exception:
        return False
    return any(lo <= n <= hi for lo, hi in _RANGES)


def _host_ok(host):
    return host in HOSTS


# --- Polled live state ------------------------------------------------------
def _fetch_state():
    now = time.time()
    with _poll_lock:
        if _poll_cache["data"] and now - _poll_cache["ts"] < POLL_TTL:
            return _poll_cache["data"]
        out = {
            "ok": False, "ts": now, "error": None,
            "health": None, "state": None, "options": None,
            "advanced": None, "sessions": None, "latestSave": None,
            "saveCount": 0, "service": None,
        }
        try:
            out["health"] = api.health()
            out["state"] = api.server_state()
            out["options"] = api.server_options()
            out["advanced"] = api.advanced_settings()
            sess = api.sessions()
            out["sessions"] = sess
            out["latestSave"] = api.latest_save(sess)
            out["saveCount"] = api.save_count(sess)
            out["service"] = control.status()
            out["ok"] = True
        except Exception as e:
            out["error"] = str(e)
        _poll_cache["data"] = out
        _poll_cache["ts"] = now
        return out


def _disk():
    try:
        st = shutil.disk_usage("/home/satisfactory")
        return {"total": st.total, "used": st.used, "free": st.free}
    except Exception:
        return None


def _journal_tail(lines=200, max_bytes=262144):
    try:
        proc = subprocess.run(
            ["journalctl", "-u", "satisfactory.service", "-n", str(lines),
             "--no-pager", "-o", "short-iso"],
            capture_output=True, text=True, timeout=15,
        )
        text = proc.stdout
        if len(text.encode()) > max_bytes:
            text = text[-max_bytes:]
        return text
    except Exception as e:
        return "journalctl unavailable: " + str(e)


# --- Response helpers -------------------------------------------------------
def _send_json(handler, obj, status=200):
    body = json.dumps(obj).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _send_file(handler, path, content_type):
    try:
        with open(path, "rb") as f:
            body = f.read()
    except OSError:
        _send_json(handler, {"error": "not found"}, 404)
        return
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_body(handler):
    length = int(handler.headers.get("Content-Length", 0) or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw)
    except ValueError:
        return {}


def _origin_ok(handler):
    origin = handler.headers.get("Origin")
    if not origin:
        return True  # non-browser client; CSRF token still required on POST
    host = urlparse(origin).netloc
    return host in HOSTS


# --- Route handlers ---------------------------------------------------------
def _installed_version():
    """Read installed files afresh; Steam IDs, game CLs and UE versions differ."""
    out = {"steamBuildId": None, "gameVersion": None, "changelist": None,
           "steamSource": STEAM_MANIFEST, "gameSource": GAME_METADATA, "errors": []}
    try:
        with open(STEAM_MANIFEST, encoding="utf-8") as f:
            # Only root AppState pairs, never TargetBuildID or nested depot IDs.
            root = f.read(262144).split('{', 1)[1].split('{', 1)[0]
        pairs = dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', root))
        if pairs.get("appid") != "1690800" or not pairs.get("buildid", "").isdigit():
            raise ValueError("missing/invalid AppState appid or buildid")
        out["steamBuildId"] = pairs["buildid"]
    except (OSError, ValueError, IndexError) as e:
        out["errors"].append("Steam manifest unavailable: " + str(e))
    try:
        with open(GAME_METADATA, encoding="utf-8") as f:
            data = json.loads(f.read(262144))
        if not isinstance(data, dict):
            raise ValueError("expected a metadata object")
        version = data.get("GameVersion")
        if isinstance(version, str) and version.strip():
            out["gameVersion"] = version.strip()
        cl = data.get("Changelist")
        if type(cl) is int and cl > 0:
            out["changelist"] = str(cl)
    except (OSError, ValueError) as e:
        out["errors"].append("Game metadata unavailable: " + str(e))
    return out


def _route_overview():
    st = dict(_fetch_state())
    st["disk"] = _disk()
    st["serverVersion"] = _installed_version()
    return st


def _route_saves():
    st = _fetch_state()
    return {"ok": st["ok"], "sessions": st["sessions"],
            "latestSave": st["latestSave"], "saveCount": st["saveCount"],
            "error": st["error"]}


def _route_config():
    st = _fetch_state()
    return {
        "ok": st["ok"],
        "serverOptions": (st["options"] or {}).get("serverOptions", {}),
        "pendingServerOptions": (st["options"] or {}).get("pendingServerOptions", {}),
        "advanced": (st["advanced"] or {}).get("advancedGameSettings", {}),
        "creativeModeEnabled": (st["advanced"] or {}).get("creativeModeEnabled", False),
        "serverFields": fields.SERVER_OPTIONS,
        "advancedFields": fields.ADVANCED_SETTINGS,
        "error": st["error"],
    }


def _route_logs():
    return {"text": _journal_tail()}


def _route_about():
    return {
        "version": __version__,
        "serverVersion": _installed_version(),
        "bind": BIND,
        "port": PORT,
        "networks": NETWORKS,
        "hosts": HOSTS,
        "service": control.status(),
        "listeners": _listeners(),
        "configDir": CONFIG_DIR,
    }


def _listeners():
    try:
        proc = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True, timeout=10)
        return proc.stdout
    except Exception:
        return "ss unavailable"


# --- POST handlers ----------------------------------------------------------
def _post_apply_options(body):
    updated = body.get("updated") or {}
    if not isinstance(updated, dict) or not updated:
        return {"error": "no options to apply"}, 400
    ok, d = api.apply_options(updated)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"applied": list(updated.keys())}, 200


def _post_apply_advanced(body):
    updated = body.get("updated") or {}
    if not isinstance(updated, dict) or not updated:
        return {"error": "no settings to apply"}, 400
    ok, d = api.apply_advanced(updated)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"applied": list(updated.keys())}, 200


def _post_save(body):
    name = (body.get("name") or "").strip()
    if not name:
        return {"error": "save name required"}, 400
    ok, d = api.save_game(name)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"saved": name}, 200


def _post_load(body):
    session = (body.get("session") or "").strip()
    save = (body.get("save") or "").strip()
    if not session or not save:
        return {"error": "session and save required"}, 400
    ok, d = api.load_game(session, save)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"loading": save}, 200


def _post_delete_save(body):
    session = (body.get("session") or "").strip()
    save = (body.get("save") or "").strip()
    if not session or not save:
        return {"error": "session and save required"}, 400
    ok, d = api.delete_save_file(session, save)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"deleted": save}, 200


def _post_delete_session(body):
    session = (body.get("session") or "").strip()
    if not session:
        return {"error": "session required"}, 400
    ok, d = api.delete_save_session(session)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"deleted": session}, 200


def _post_command(body):
    cmd = (body.get("command") or "").strip()
    if not cmd:
        return {"error": "command required"}, 400
    ok, d = api.run_command(cmd)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"sent": cmd}, 200


def _post_shutdown(body):
    ok, d = api.shutdown()
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"shutdown": True}, 200


def _post_service(body):
    action = body.get("action")
    ok, msg = control.action(action)
    if not ok:
        return {"error": msg}, 400
    return {"service": control.status(), "message": msg}, 200


# --- HTTP handler -----------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; "
                         "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")

    def _check(self):
        if not _admitted(_client_ip(self)):
            self.send_response(403)
            self.end_headers()
            return False
        if not _host_ok(self.headers.get("Host", "")):
            self.send_response(403)
            self.end_headers()
            return False
        return True

    def do_GET(self):
        if not self._check():
            return
        path = urlparse(self.path).path
        if path == "/api/version":
            _send_json(self, {"version": __version__})
        elif path == "/api/session":
            _send_json(self, {"csrf": _csrf})
        elif path == "/api/overview":
            _send_json(self, _route_overview())
        elif path == "/api/saves":
            _send_json(self, _route_saves())
        elif path == "/api/config":
            _send_json(self, _route_config())
        elif path == "/api/logs":
            _send_json(self, _route_logs())
        elif path == "/api/about":
            _send_json(self, _route_about())
        elif path == "/":
            _send_file(self, os.path.join(WEB_DIR, "index.html"), "text/html; charset=utf-8")
        elif path == "/app.js":
            _send_file(self, os.path.join(WEB_DIR, "app.js"), "application/javascript; charset=utf-8")
        elif path == "/style.css":
            _send_file(self, os.path.join(WEB_DIR, "style.css"), "text/css; charset=utf-8")
        elif path.startswith("/api/"):
            _send_json(self, {"error": "not found"}, 404)
        else:
            # SPA fallback: any non-API path serves the single-page app shell.
            _send_file(self, os.path.join(WEB_DIR, "index.html"), "text/html; charset=utf-8")

    def do_POST(self):
        if not self._check():
            return
        if not _origin_ok(self):
            _send_json(self, {"error": "cross-origin request rejected"}, 403)
            return
        if self.headers.get("X-CSRF-Token") != _csrf:
            _send_json(self, {"error": "invalid CSRF token"}, 403)
            return
        path = urlparse(self.path).path
        body = _read_body(self)
        routes = {
            "/api/apply-options": _post_apply_options,
            "/api/apply-advanced": _post_apply_advanced,
            "/api/save": _post_save,
            "/api/load": _post_load,
            "/api/delete-save": _post_delete_save,
            "/api/delete-session": _post_delete_session,
            "/api/command": _post_command,
            "/api/shutdown": _post_shutdown,
            "/api/service": _post_service,
        }
        fn = routes.get(path)
        if not fn:
            _send_json(self, {"error": "not found"}, 404)
            return
        try:
            obj, status = fn(body)
        except Exception as e:
            obj, status = {"error": str(e)}, 500
        _send_json(self, obj, status)

    def log_message(self, format, *args):
        pass


def main():
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"Satisfactory WebUI v{__version__} on {BIND}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
