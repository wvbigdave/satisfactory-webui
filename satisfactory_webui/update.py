"""Server update: detect available Steam builds and apply an update.

The WebUI runs as the unprivileged `satisfactory` user inside a hardened
systemd sandbox (ProtectHome=tmpfs, ReadOnly bind for the game dir), so it
cannot touch /home/satisfactory/server directly. Real work is delegated to the
root-owned sudo allowlist target `/usr/local/sbin/satisfactory-server-update`
(see deploy/satisfactory-server-update), which validates its fixed vocabulary
and re-execs a worker (deploy/satisfactory-server-update-worker) inside a
transient systemd-run unit as the satisfactory user — giving a fresh, writable
mount namespace and a real HOME for steamcmd.

Two long-running, mutating operations are gated here so only one may run at a
time, and neither blocks the request thread:

* ``check`` resolves the latest Steam buildid per branch (info-only, no
  download). It is quaranteed so consecutive calls do not hammer SteamCMD.
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
import subprocess
import threading
import time
from pathlib import Path

STATE_DIR = Path(os.environ.get("SATISFACTORY_STATE_DIR", "/var/lib/satisfactory-webui"))
HELPER = "/usr/local/sbin/satisfactory-server-update"
BRANCHES = ("public", "experimental")
CHECK_QUOTA_SECONDS = 300  # allow one explicit check per 5 minutes
LOG_TAIL = 400  # max lines kept in the in-memory ring + log file

_lock = threading.Lock()
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
        with open("/home/satisfactory/server/steamapps/appmanifest_1690800.acf",
                  encoding="utf-8") as f:
            root = f.read(262144).split("{", 1)[1].split("{", 1)[0]
        pairs = dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', root))
        if pairs.get("appid") == "1690800" and pairs.get("buildid", "").isdigit():
            build_id = pairs["buildid"]
    except (OSError, IndexError, ValueError):
        pass
    try:
        with open("/home/satisfactory/server/Engine/Binaries/Linux/"
                  "FactoryServer-Linux-Shipping.version", encoding="utf-8") as f:
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
        global _job
        try:
            proc = subprocess.run(self.args, capture_output=True, text=True,
                                  timeout=3600)
            _job["exitCode"] = proc.returncode
            if proc.stderr.strip():
                _append_log(proc.stderr.rstrip())
            if proc.returncode != 0:
                _job["error"] = (proc.stderr.strip() or proc.stdout.strip()
                                 or f"exit {proc.returncode}")
        except subprocess.TimeoutExpired:
            _job["exitCode"] = 124
            _job["error"] = "update timed out after 1 hour"
        except OSError as e:
            _job["exitCode"] = -1
            _job["error"] = str(e)
        finally:
            _job["finishedAt"] = _now_iso()
            _job["running"] = False
            _append_log(">>> job finished ({})".format(
                _job["error"] or "ok"))


def _append_log(text):
    for line in text.splitlines():
        _job["log"].append(f"[{time.strftime('%H:%M:%S')}] {line}")
    # Keep the persistent log file in the (writable) StateDirectory too.
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with open(STATE_DIR / "update.log", "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except OSError:
        pass


def _running():
    return _job.get("running", False)


def status():
    """Fast status aggregate for GET /api/update. Never runs any tool."""
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
        if now - _available["ts"] < CHECK_QUOTA_SECONDS and _available["error"] is None:
            return {"quaranteed": True, **status()["available"]}
        if not os.path.exists(HELPER) or not os.access(HELPER, os.X_OK):
            return {"error": f"update helper not available: {HELPER}"}
        _job.update(running=True, mode="check", startedAt=_now_iso(),
                    finishedAt=None, exitCode=None, error=None)
        _append_log(">>> checking available builds via steamcmd (quota "
                    f"{CHECK_QUOTA_SECONDS}s)")

    def _run_check():
        global _available
        try:
            proc = subprocess.run(["sudo", "-n", HELPER, "check"], capture_output=True,
                                  text=True, timeout=600)
            out = proc.stdout
            _append_log(out.rstrip())
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.strip() or f"exit {proc.returncode}")
            by_branch = {}
            for line in out.splitlines():
                m = re.match(r"AVAILABLE ([A-Za-z0-9_]+)=(\d+)", line)
                if m:
                    by_branch[m.group(1)] = m.group(2)
            if not by_branch:
                raise RuntimeError("steamcmd returned no branch buildids")
            _available = {"ts": time.time(), "byBranch": by_branch, "error": None}
        except Exception as e:
            _available = {"ts": time.time(), "byBranch": {}, "error": str(e)}
        finally:
            _job["error"] = _available["error"]
            _job["finishedAt"] = _now_iso()
            _job["exitCode"] = 0 if not _available["error"] else 1
            _job["running"] = False

    threading.Thread(target=_run_check, name="satisfactory-check", daemon=True).start()
    return {"started": True, "quotaSeconds": CHECK_QUOTA_SECONDS}


def start_update(branch, validate=False):
    """Kick off an update for the given branch. Returns (ok, payload)."""
    if branch not in BRANCHES:
        return False, {"error": f"branch must be one of {', '.join(BRANCHES)}"}
    if validate not in (True, False):
        return False, {"error": "validate must be a boolean"}
    with _lock:
        if _running():
            return False, {"error": "an update or check is already running"}
        if not os.path.exists(HELPER) or not os.access(HELPER, os.X_OK):
            return False, {"error": f"update helper not available: {HELPER}"}
        _job.update(running=True, mode=f"update:{branch}", startedAt=_now_iso(),
                    finishedAt=None, exitCode=None, error=None)
        _append_log(f">>> starting update (branch={branch}, validate={validate})")

    args = ["sudo", "-n", HELPER, "update", branch, "yes" if validate else "no"]
    _JobThread(args, f"update-{branch}").start()
    return True, {"started": True, "branch": branch}
