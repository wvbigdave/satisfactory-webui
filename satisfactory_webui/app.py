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
from urllib.parse import urlparse, parse_qs, quote

from . import __version__
from . import api, control, fields, monitor, archives, branding, update

# --- Configuration (overridable via environment) ---------------------------
BIND = os.environ.get("SATISFACTORY_BIND", "192.168.4.60")
PORT = int(os.environ.get("SATISFACTORY_PORT", "8082"))
# Comma-separated CIDR subnets admitted in addition to loopback.
NETWORKS = os.environ.get(
    "SATISFACTORY_NETWORKS", "192.168.4.0/22,127.0.0.0/8"
).split(",")
# Exact Host header allowlist (comma-separated).
# SSO boundary (Authelia public vhost): the proxy forwards the authenticated
# identity as the HTTP `Remote-User` header once the user has passed auth; the
# logout endpoint returns to the app. `rd` is the URL-encoded return address.
SSO_LOGOUT_URL = os.environ.get(
    "SATISFACTORY_SSO_LOGOUT", "https://auth.axtriss.site/logout"
)
SSO_RETURN_URL = os.environ.get("SATISFACTORY_SSO_RETURN", "https://satserv.axtriss.site")

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
            out["ok"] = out["state"] is not None and out["health"] is not None
            if not out["ok"]:
                out["error"] = "Game HTTPS API unavailable; Linux monitoring remains available"
        except Exception as e:
            out["error"] = str(e)
        _poll_cache["data"] = out
        _poll_cache["ts"] = now
        return out


def _disk():
    try:
        st = shutil.disk_usage("/home/satisfactory/server")
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


ASSET_TYPES = {
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
}


def _send_asset(handler, path):
    """Serve a built frontend asset from web/app/ with a strict allowlist.

    The path is resolved inside the asset root and rejected if it escapes, so
    traversal (../, absolute, symlink) can never reach outside the build dir.
    """
    rel = path[len("/assets/"):]
    root = os.path.realpath(os.path.join(WEB_DIR, "app", "assets"))
    target = os.path.realpath(os.path.join(root, rel))
    if not (target == root or target.startswith(root + os.sep)):
        _send_json(handler, {"error": "not found"}, 404)
        return
    content_type = ASSET_TYPES.get(os.path.splitext(target)[1].lower(), "application/octet-stream")
    _send_file(handler, target, content_type)


def _send_logo(handler):
    """Serve the operator-supplied branding logo from the state directory.

    The logo is untrusted input rendered through <img>, so it is never parsed as
    a document by the app. As defence in depth an explicit sandboxing CSP is
    added for the case where this URL is opened directly (the global policy
    already blocks inline script; this removes script entirely).
    """
    content_type = branding.load().get("logo")
    path = branding.logo_path(content_type) if content_type else None
    if not path:
        _send_json(handler, {"error": "no logo"}, 404)
        return
    try:
        with open(path, "rb") as f:
            body = f.read()
    except OSError:
        _send_json(handler, {"error": "no logo"}, 404)
        return
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _post_branding(body):
    try:
        return branding.save(body), 200
    except ValueError as e:
        return {"error": str(e)}, 400
    except OSError as e:
        return {"error": f"could not persist branding: {e}"}, 500


def _read_body(handler, limit=65536):
    length = int(handler.headers.get("Content-Length", 0) or 0)
    if length > limit or length < 0:
        raise ValueError(f"request body exceeds {limit // 1024} KiB")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        body = json.loads(raw)
        return body if isinstance(body, dict) else {}
    except ValueError:
        return {}


def _origin_ok(handler):
    origin = handler.headers.get("Origin")
    if not origin:
        return True  # non-browser client; CSRF token still required on POST
    parsed = urlparse(origin)
    # Scheme is transport only: behind an HTTPS proxy the browser Origin is
    # https while the app may still see http from nginx. The Origin netloc
    # must still equal the Host header and be in the allowlist.
    return (parsed.scheme in ("http", "https")
            and parsed.netloc == handler.headers.get("Host")
            and parsed.netloc in HOSTS)


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
    st["resources"] = monitor.resources()
    st["saveStorage"] = monitor.save_sizes()
    st["history"] = monitor.read(hours=6)
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


def _route_sso(headers):
    """Return the single-sign-on identity for the current request.

    The Authelia-auth whitelist vhost forwards the authenticated username as
    the HTTP `Remote-User` header. Without a proxy there is no identity (null),
    but the logout URL is always provided so the UI can render the portal link.
    """
    user = headers.get("Remote-User") or None
    logout_url = f"{SSO_LOGOUT_URL}?rd={quote(SSO_RETURN_URL, safe='')}"
    return {"user": user, "logoutUrl": logout_url, "authenticated": user is not None}


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
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    session = (body.get("session") or "").strip()
    save = (body.get("save") or "").strip()
    if not session or not save:
        return {"error": "session and save required"}, 400
    ok, d = api.load_game(session, save)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"loading": save}, 200


def _post_delete_save(body):
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    session = (body.get("session") or "").strip()
    save = (body.get("save") or "").strip()
    if not session or not save:
        return {"error": "session and save required"}, 400
    ok, d = api.delete_save_file(session, save)
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"deleted": save}, 200


def _post_delete_session(body):
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
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
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    ok, d = api.shutdown()
    if not ok:
        return {"error": d.get("errorMessage") or d.get("errorCode") or str(d)}, 400
    return {"shutdown": True}, 200


def _post_service(body):
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    action = body.get("action")
    ok, msg = control.action(action)
    if not ok:
        return {"error": msg}, 400
    return {"service": control.status(), "message": msg}, 200


# --- HTTP handler -----------------------------------------------------------
def _post_backup(body):
    return archives.create(body.get("name")), 200


def _post_remove_backup(body):
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    return archives.remove(body.get("name")), 200


def _post_update_check(body):
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    return update.check(), 200


def _post_update_start(body):
    if body.get("confirm") is not True:
        return {"error": "explicit confirmation required"}, 400
    branch = (body.get("branch") or "").strip() or "public"
    ok, payload = update.start_update(branch, validate=body.get("validate") is True)
    if not ok:
        return payload, 400
    return payload, 200


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self._security_headers()
        super().end_headers()

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; "
                         "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")

    def _check(self):
        if not _admitted(_client_ip(self)):
            _send_json(self, {"error": "network rejected"}, 403)
            return False
        if not _host_ok(self.headers.get("Host", "")):
            _send_json(self, {"error": "host rejected"}, 403)
            return False
        return True

    def _stream(self):
        """Server-sent events: push the overview snapshot on an interval.

        Each connection reuses the cached poll state, so this is cheap. The
        stream closes after ~10 minutes and the browser reconnects, which also
        bounds how long a worker thread is held. Nothing here mutates state.
        """
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        deadline = time.monotonic() + 600
        try:
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.flush()
            while time.monotonic() < deadline:
                payload = json.dumps(_route_overview(), separators=(",", ":"))
                self.wfile.write(f"event: overview\ndata: {payload}\n\n".encode())
                self.wfile.flush()
                time.sleep(3)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass

    def do_GET(self):
        if not self._check():
            return
        path = urlparse(self.path).path
        if path == "/api/version":
            _send_json(self, {"version": __version__})
        elif path == "/api/session":
            _send_json(self, {"csrf": _csrf})
        elif path == "/api/sso":
            _send_json(self, _route_sso(self.headers))
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
        elif path == "/api/history":
            try:
                hours = int(parse_qs(urlparse(self.path).query).get("hours", [24])[0])
                if hours not in (1, 6, 24, 168):
                    raise ValueError("unsupported range")
                _send_json(self, monitor.read(hours))
            except ValueError as e:
                _send_json(self, {"error": str(e)}, 400)
        elif path == "/api/backups":
            _send_json(self, archives.list_backups())
        elif path in ("/api/download-save", "/api/download-backup"):
            try:
                name = parse_qs(urlparse(self.path).query).get("name", [""])[0]
                opener = archives.open_save if path.endswith("-save") else archives.open_backup
                with opener(name) as source:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    from urllib.parse import quote
                    self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(name, safe=""))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", str(os.fstat(source.fileno()).st_size))
                    self.end_headers()
                    shutil.copyfileobj(source, self.wfile, 256*1024)
            except (OSError, ValueError) as e:
                _send_json(self, {"error": str(e)}, 400)
        elif path == "/api/credits":
            with open(os.path.join(WEB_DIR, "credits.json"), encoding="utf-8") as f:
                _send_json(self, json.load(f))
        elif path == "/api/branding":
            _send_json(self, branding.load())
        elif path == "/api/update":
            _send_json(self, update.status())
        elif path == "/api/logo":
            _send_logo(self)
        elif path == "/api/stream":
            self._stream()
        elif path == "/":
            _send_file(self, os.path.join(WEB_DIR, "app", "index.html"), "text/html; charset=utf-8")
        elif path.startswith("/assets/"):
            _send_asset(self, path)
        elif path.startswith("/api/"):
            _send_json(self, {"error": "not found"}, 404)
        else:
            # SPA fallback: any non-API, non-asset path serves the app shell.
            # Client-side routing (History API) depends on this.
            _send_file(self, os.path.join(WEB_DIR, "app", "index.html"), "text/html; charset=utf-8")

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
        # Branding accepts a logo upload, so it gets a larger bounded body.
        limit = 1024 * 1024 if path == "/api/branding" else 65536
        try:
            body = _read_body(self, limit)
        except (ValueError, TypeError) as e:
            self.close_connection = True
            _send_json(self, {"error": str(e)}, 400)
            return
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
            "/api/backup": _post_backup,
            "/api/remove-backup": _post_remove_backup,
            "/api/branding": _post_branding,
            "/api/update/check": _post_update_check,
            "/api/update/start": _post_update_start,
        }
        fn = routes.get(path)
        if not fn:
            _send_json(self, {"error": "not found"}, 404)
            return
        try:
            obj, status = fn(body)
        except (ValueError, OSError) as e:
            obj, status = {"error": str(e)}, 400
        except Exception as e:
            obj, status = {"error": str(e)}, 500
        _send_json(self, obj, status)

    def log_message(self, format, *args):
        pass


def main():
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    monitor.start(_fetch_state, _disk)
    print(f"Satisfactory WebUI v{__version__} on {BIND}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
