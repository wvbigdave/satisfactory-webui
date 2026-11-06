"""Portable defaults shared by all runtime modules.

Environment variables configure a deployment; no site-specific identity or path
is required. The installer writes explicit values for its chosen service user.
"""
import os
from pathlib import Path


HOME = Path.home()
SERVER_DIR = Path(os.environ.get("SATISFACTORY_SERVER_DIR", str(HOME / "server")))
CONFIG_DIR = Path(os.environ.get("SATISFACTORY_CONFIG_DIR", str(SERVER_DIR / "FactoryGame/Saved/Config/LinuxServer")))
SAVE_DIR = Path(os.environ.get("SATISFACTORY_SAVE_DIR", str(HOME / ".config/Epic/FactoryGame/Saved/SaveGames/server")))
STATE_DIR = Path(os.environ.get("SATISFACTORY_STATE_DIR", str(Path(os.environ.get("XDG_STATE_HOME", str(HOME / ".local/state"))) / "satisfactory-webui")))
SERVICE = os.environ.get("SATISFACTORY_SERVICE", "satisfactory.service")
if not SERVICE.endswith('.service') or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.@:-' for c in SERVICE) or SERVICE.startswith('-'):
    raise ValueError("SATISFACTORY_SERVICE must be a systemd service unit name")
CGROUP = Path(os.environ.get("SATISFACTORY_CGROUP", f"/sys/fs/cgroup/system.slice/{SERVICE}"))
STEAM_MANIFEST = Path(os.environ.get("SATISFACTORY_STEAM_MANIFEST", str(SERVER_DIR / "steamapps/appmanifest_1690800.acf")))
GAME_METADATA = Path(os.environ.get("SATISFACTORY_GAME_METADATA", str(SERVER_DIR / "Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version")))
