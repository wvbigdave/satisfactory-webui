"""Server update: detect available Steam builds and apply an update.

The WebUI runs as the unprivileged `satisfactory` user inside a hardened
systemd sandbox (ProtectHome=tmpfs, ReadOnly bind for the game dir), so it
cannot write the configured game install directly. Real work is delegated to the
root-owned sudo allowlist target `/usr/local/sbin/satisfactory-server-update`
(see deploy/satisfactory-server-update), which validates its fixed vocabulary
and re-execs a worker (deploy/satisfactory-server-update-worker) inside a
transient systemd-run unit as the satisfactory user — giving a fresh, writable
mount namespace and a real HOME for steamcmd.

Two long-running, mutating operations are gated here so only one may run at a
time, and neither blocks the request thread:

* ``check`` resolves the latest Steam buildid per branch (info-only, no
  download). It is quota-gated so consecutive calls do not hammer SteamCMD.
* ``update`` stops the game service, runs steamcmd app_update for the chosen
  branch (optionally with ``validate``), streams live output to a ring buffer
  and a StateDirectory log, then restarts the game on success.

Installed-version facts are read from disk by app._installed_version(); the
"available" buildids come from the last completed check, never guessed.
"""

from __future__ import annotations

import collections
import datetime
import json
import os
import re
import selectors
import subprocess
import threading
import time
from .config import STATE_DIR, STEAM_MANIFEST, GAME_METADATA

HELPER = os.environ.get("SATISFACTORY_UPDATE_HELPER", "/usr/local/sbin/satisfactory-server-update")
BRANCHES = ("public", "experimental")
CHECK_QUOTA_SECONDS = 300  # allow one explicit check per 5 minutes
LOG_TAIL = 400  # max lines kept in the in-memory ring + log file
LOG_LINE_CHARS = 2048
_log_lines = collections.deque(maxlen=LOG_TAIL)

_lock = threading.RLock()
_job = {"running": False, "mode": None, "startedAt": None, "finishedAt": None,
        "exitCode": None, "error": None, "log": collections.deque(maxlen=LOG_TAIL)}
_available = {"ts": 0.0, "byBranch": {}, "error": None}


def _now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _read_installed():
    """Read the installed Steam buildid and game version straight from disk."""
    build_id = None
    version = None
    changelist = None
    try:
        with open(STEAM_MANIFEST,
                  encoding="utf-8") as f:
            root = f.read(262144).split("{", 1)[1].split("{", 1)[0]
        pairs = dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', root))
        if pairs.get("appid") == "1690800" and pairs.get("buildid", "").isdigit():
            build_id = pairs["buildid"]
    except (OSError, IndexError, ValueError):
        pass
    try:
        with open(GAME_METADATA, encoding="utf-8") as f:
            meta = json.loads(f.read(262144))
        if isinstance(meta, dict):
            gv = meta.get("GameVersion")
            cl = meta.get("Changelist")
            version = str(gv).strip() if isinstance(gv, str) and gv.strip() else None
            changelist = str(cl) if type(cl) is int and cl > 0 else None
    except (OSError, ValueError):
        pass
    return {"steamBuildId": build_id, "gameVersion": version, "changelist": changelist}


class _JobThread(threading.Thread):
    """Run a helper invocation in the background, capturing its output."""

    def __init__(self, args, mode):
        super().__init__(name=f"satisfactory-update-{mode}", daemon=True)
        self.args = args
        self.mode = mode

    def run(self):  # noqa: D102
        code, error = -1, None
        try:
            code, tail = _run_helper(self.args, timeout=3660)
            if code != 0:
                error = "\n".join(tail[-10:]) or f"exit {code}"
        except subprocess.TimeoutExpired:
            code, error = 124, "update timed out after 1 hour"
        except OSError as e:
            error = str(e)
        finally:
            with _lock:
                _append_log(f">>> job finished ({error or 'ok'})")
                _job.update(exitCode=code, error=error, finishedAt=_now_iso(), running=False)


def _run_helper(args, timeout):
    """Drain merged output live, with bounded lines, memory, and wall time."""
    tail = collections.deque(maxlen=LOG_TAIL)
    deadline = time.monotonic() + timeout
    pending = b""

    def emit(raw):
        line = raw.decode("utf-8", errors="replace")[:LOG_LINE_CHARS]
        tail.append(line)
        _append_log(line)

    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as proc:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(proc.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(args, timeout)
                    if not selector.select(min(remaining, 1)):
                        continue
                    block = os.read(proc.stdout.fileno(), 4096)
                    if not block:
                        break
                    pending += block
                    while b"\n" in pending or len(pending) >= LOG_LINE_CHARS:
                        stop = pending.find(b"\n", 0, LOG_LINE_CHARS)
                        if stop < 0:
                            emit(pending[:LOG_LINE_CHARS])
                            pending = pending[LOG_LINE_CHARS:]
                        else:
                            emit(pending[:stop])
                            pending = pending[stop + 1:]
                if pending:
                    emit(pending)
                return proc.wait(timeout=max(0.01, deadline - time.monotonic())), list(tail)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()


def _append_log(text):
    with _lock:
        for line in text.splitlines():
            line = line[:LOG_LINE_CHARS]
            _job["log"].append(f"[{time.strftime('%H:%M:%S')}] {line}")
            _log_lines.append(line)
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            target = STATE_DIR / "update.log"
            temporary = STATE_DIR / ".update.log.tmp"
            temporary.write_text("\n".join(_log_lines) + "\n", encoding="utf-8")
            os.replace(temporary, target)
        except OSError:
            pass


def _running():
    return _job.get("running", False)


def status():
    """Fast status aggregate for GET /api/update. Never runs any tool."""
    with _lock:
        return _status()


def _status():
    installed = _read_installed()
    avail = dict(_available.get("byBranch") or {})
    latest = avail.get("public")
    installed_id = installed["steamBuildId"]
    update_available = bool(latest and installed_id and latest != installed_id)
    return {
        "installed": installed,
        "available": {"byBranch": avail, "checkedAt": _available["ts"] or None,
                      "error": _available.get("error")},
        "updateAvailable": update_available,
        "branches": list(BRANCHES),
        "job": {k: _job[k] for k in ("running", "mode", "startedAt", "finishedAt",
                                     "exitCode", "error")},
        "logTail": list(_job["log"])[-int(LOG_TAIL):],
        "helper": HELPER,
    }


def check():
    """Resolve the latest buildid per branch. Quota-gated: one explicit check
    per CHECK_QUOTA_SECONDS unless a previous check already resolved it."""
    global _available
    now = time.time()
    with _lock:
        if _running():
            return {"error": "an update or check is already running"}
        if now - _available["ts"] < CHECK_QUOTA_SECONDS:
            return {"quotaLimited": True, **status()["available"]}
        if not os.path.exists(HELPER) or not os.access(HELPER, os.X_OK):
            return {"error": f"update helper not available: {HELPER}"}
        _job.update(running=True, mode="check", startedAt=_now_iso(),
                    finishedAt=None, exitCode=None, error=None)
        _append_log(">>> checking available builds via steamcmd (quota "
                    f"{CHECK_QUOTA_SECONDS}s)")

    def _run_check():
        global _available
        try:
            code, tail = _run_helper(["/usr/bin/sudo", "-n", HELPER, "check"], timeout=660)
            if code != 0:
                raise RuntimeError("\n".join(tail[-10:]) or f"exit {code}")
            by_branch = {}
            for line in tail:
                m = re.match(r"AVAILABLE ([A-Za-z0-9_]+)=(\d+)", line)
                if m and m.group(1) in BRANCHES:
                    by_branch[m.group(1)] = m.group(2)
            if not by_branch:
                raise RuntimeError("steamcmd returned no branch buildids")
            result = {"ts": time.time(), "byBranch": by_branch, "error": None}
        except Exception as e:
            result = {"ts": time.time(), "byBranch": {}, "error": str(e)}
        finally:
            with _lock:
                _available = result
                _job.update(error=result["error"], finishedAt=_now_iso(),
                            exitCode=0 if not result["error"] else 1, running=False)

    threading.Thread(target=_run_check, name="satisfactory-check", daemon=True).start()
    return {"started": True, "quotaSeconds": CHECK_QUOTA_SECONDS}


def start_update(branch, validate=False):
    """Kick off an update for the given branch. Returns (ok, payload)."""
    if not isinstance(branch, str) or branch not in BRANCHES:
        return False, {"error": f"branch must be one of {', '.join(BRANCHES)}"}
    if type(validate) is not bool:
        return False, {"error": "validate must be a boolean"}
    with _lock:
        if _running():
            return False, {"error": "an update or check is already running"}
        if not os.path.exists(HELPER) or not os.access(HELPER, os.X_OK):
            return False, {"error": f"update helper not available: {HELPER}"}
        _job.update(running=True, mode=f"update:{branch}", startedAt=_now_iso(),
                    finishedAt=None, exitCode=None, error=None)
        _append_log(f">>> starting update (branch={branch}, validate={validate})")

    args = ["/usr/bin/sudo", "-n", HELPER, "update", branch, "yes" if validate else "no"]
    _JobThread(args, f"update-{branch}").start()
    return True, {"started": True, "branch": branch}
