"""Satisfactory HTTPS API client — loopback only, unverified TLS.

The server runs with FG.DedicatedServer.AllowInsecureLocalAccess=1 in
Engine.ini, so the HTTPS API on 127.0.0.1:7777 answers without an auth token.
This module is the single place that talks to the game API; the WebUI never
talks to the game directly. All functions are pinned to the documented
Satisfactory HTTPS API (satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API).
"""
import json
import ssl
import threading
import time
from urllib import request, error

API = "https://127.0.0.1:7777/api/v1"
CTX = ssl._create_unverified_context()
TIMEOUT = 6

# Functions that require admin privileges on the game server. With
# AllowInsecureLocalAccess=1 on loopback they still answer without a token.
ADMIN_FUNCTIONS = {
    "ApplyServerOptions", "ApplyAdvancedGameSettings", "SaveGame", "LoadGame",
    "DeleteSaveFile", "DeleteSaveSession", "CreateNewGame", "RunCommand",
    "Shutdown", "SetAutoLoadSessionName", "RenameServer", "SetClientPassword",
    "SetAdminPassword", "UploadSaveGame", "DownloadSaveGame",
}

_lock = threading.Lock()


def call(fn, data=None):
    """POST one API function. Returns the parsed JSON body (dict)."""
    payload = {"function": fn, "data": data or {}}
    req = request.Request(
        API,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, context=CTX, timeout=TIMEOUT) as r:
        body = r.read()
        return json.loads(body) if body else {"status": r.status}


def safe_call(fn, data=None):
    """call() that never raises; returns (ok, data_or_error)."""
    try:
        return True, call(fn, data)
    except error.HTTPError as e:
        try:
            return False, json.loads(e.read(8192))
        except ValueError:
            return False, {"error": "HTTP " + str(e.code)}
    except (OSError, ValueError) as e:
        return False, {"error": type(e).__name__ + ": " + str(e)}


def health():
    ok, d = safe_call("HealthCheck", {"ClientCustomData": ""})
    if not ok:
        return None
    return d.get("data", {}).get("health")


def server_state():
    """QueryServerState -> the serverGameState dict, or None."""
    ok, d = safe_call("QueryServerState")
    if not ok:
        return None
    return d.get("data", {}).get("serverGameState")


def server_options():
    """GetServerOptions -> {'serverOptions': {...}, 'pendingServerOptions': {...}}."""
    ok, d = safe_call("GetServerOptions")
    if not ok:
        return None
    return d.get("data", {})


def advanced_settings():
    """GetAdvancedGameSettings -> {'creativeModeEnabled': bool, 'advancedGameSettings': {...}}."""
    ok, d = safe_call("GetAdvancedGameSettings")
    if not ok:
        return None
    return d.get("data", {})


def sessions():
    """EnumerateSessions -> list of session dicts (each with saveHeaders)."""
    ok, d = safe_call("EnumerateSessions")
    if not ok:
        return None
    return d.get("data", {}).get("sessions", [])


def latest_save(sessions_list=None):
    """Most recent save across all sessions, or None."""
    sessions_list = sessions_list if sessions_list is not None else sessions()
    if not sessions_list:
        return None
    best = None
    for sess in sessions_list:
        for h in sess.get("saveHeaders", []):
            dt = h.get("saveDateTime", "")
            if dt and (best is None or dt > best[0]):
                best = (dt, h.get("saveName"))
    if best:
        return {"date": best[0], "name": best[1]}
    return None


def save_count(sessions_list=None):
    sessions_list = sessions_list if sessions_list is not None else sessions()
    try:
        return sum(len(s.get("saveHeaders", [])) for s in sessions_list)
    except Exception:
        return 0


def apply_options(updated):
    """ApplyServerOptions. Returns (ok, data)."""
    return safe_call("ApplyServerOptions", {"UpdatedServerOptions": updated})


def apply_advanced(updated):
    """ApplyAdvancedGameSettings. Returns (ok, data)."""
    return safe_call("ApplyAdvancedGameSettings", {"AppliedAdvancedGameSettings": updated})


def save_game(name):
    return safe_call("SaveGame", {"SaveName": name})


def load_game(session, save):
    return safe_call("LoadGame", {"SessionName": session, "SaveName": save})


def delete_save_file(session, save):
    return safe_call("DeleteSaveFile", {"SessionName": session, "SaveName": save})


def delete_save_session(session):
    return safe_call("DeleteSaveSession", {"SessionName": session})


def run_command(command):
    return safe_call("RunCommand", {"Command": command})


def shutdown():
    return safe_call("Shutdown")


def set_autoload(session):
    return safe_call("SetAutoLoadSessionName", {"SessionName": session})


def rename_server(name):
    return safe_call("RenameServer", {"ServerName": name})


def set_client_password(password):
    return safe_call("SetClientPassword", {"Password": password})


def set_admin_password(password):
    return safe_call("SetAdminPassword", {"Password": password})


def create_new_game(session, map_name="", starting_location="", skip_onboarding=True,
                    advanced=None, custom=None):
    data = {
        "NewGameData": {
            "SessionName": session,
            "MapName": map_name,
            "StartingLocation": starting_location,
            "SkipOnboarding": skip_onboarding,
            "AdvancedGameSettings": advanced or {},
            "CustomOptionsOnlyForModding": custom or {},
        }
    }
    return safe_call("CreateNewGame", data)
