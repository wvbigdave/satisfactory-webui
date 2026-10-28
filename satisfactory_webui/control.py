"""systemd service control for the Satisfactory dedicated server.

The WebUI runs as the `satisfactory` user. It controls the game service via a
fixed sudo allowlist (see deploy/satisfactory-webui.sudoers) — only the three
exact systemctl commands below, no shell, no daemon-reload, no edit.
"""
import subprocess

SERVICE = "satisfactory.service"
ALLOWED = {"start", "stop", "restart"}


def _run(action):
    if action not in ALLOWED:
        raise ValueError("action not allowed: " + action)
    # sudo -n: never prompt. The allowlist grants NOPASSWD for these exact cmds.
    proc = subprocess.run(
        ["sudo", "-n", "systemctl", action, SERVICE],
        capture_output=True, text=True, timeout=30,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def status():
    """Return the systemd ActiveState/SubState for the game service."""
    try:
        proc = subprocess.run(
            ["systemctl", "show", SERVICE, "-p", "ActiveState", "-p", "SubState",
             "-p", "LoadState", "-p", "ExecMainPID"],
            capture_output=True, text=True, timeout=15,
        )
        out = {}
        for line in proc.stdout.splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                out[k] = v
        return out
    except Exception as e:
        return {"ActiveState": "unknown", "error": str(e)}


def action(action):
    """Perform a service action; returns (ok, message)."""
    if action not in ALLOWED:
        return False, "action not allowed"
    rc, out, err = _run(action)
    if rc != 0:
        return False, (err or out or "systemctl failed with exit " + str(rc))
    return True, (out or "ok")
