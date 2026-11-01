"""Server branding: a customizable name, tagline, accent colour and logo.

Stored in the systemd StateDirectory (`SATISFACTORY_STATE_DIR`, default
`/var/lib/satisfactory-webui`) so it survives updates and is writable under the
service sandbox. Nothing here is game data — it only affects how the console
presents itself.

All input is validated and bounded: the name/tagline/mark are length-capped,
the accent must be a hex colour, and a logo upload must be a small raster image
(SVG is accepted but served with a sandboxing CSP — see `logo_response_headers`).
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import tempfile
from pathlib import Path

STATE_DIR = Path(os.environ.get("SATISFACTORY_STATE_DIR", "/var/lib/satisfactory-webui"))
BRANDING_FILE = STATE_DIR / "branding.json"
LOGO_DIR = STATE_DIR / "branding"

MAX_NAME = 40
MAX_TAGLINE = 120
MAX_MARK = 3
MAX_LOGO_BYTES = 512 * 1024

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
# Raster formats plus SVG. SVG is image/svg+xml and is only ever rendered via
# <img>, and is served with `default-src 'none'; sandbox` so embedded script
# cannot execute even if opened directly.
LOGO_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "svg": "image/svg+xml",
}
DATA_URL = re.compile(r"^data:image/(png|jpe?g|webp|gif|svg\+xml);base64,(.+)$", re.DOTALL)

DEFAULTS = {
    "name": "Satisfactory Ops",
    "tagline": "Pioneering efficiency beyond Earth, one conveyor at a time.",
    "mark": "",
    "accent": "#ff963e",
    "logo": None,
}


def _clip(value, limit):
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def load():
    """Return the current branding merged over defaults. Never raises."""
    data = dict(DEFAULTS)
    try:
        with open(BRANDING_FILE, encoding="utf-8") as f:
            stored = json.load(f)
        if isinstance(stored, dict):
            for key in ("name", "tagline", "mark", "accent", "logo"):
                if key in stored:
                    data[key] = stored[key]
    except (OSError, ValueError):
        pass
    # Re-validate on read so a hand-edited file cannot break the UI.
    data["name"] = _clip(data.get("name"), MAX_NAME) or DEFAULTS["name"]
    data["tagline"] = _clip(data.get("tagline"), MAX_TAGLINE)
    data["mark"] = _clip(data.get("mark"), MAX_MARK)
    accent = data.get("accent")
    data["accent"] = accent if isinstance(accent, str) and HEX_COLOR.match(accent) else DEFAULTS["accent"]
    logo = data.get("logo")
    data["logo"] = logo if isinstance(logo, str) and logo in LOGO_TYPES.values() else None
    return data


def _write_atomic(payload):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(STATE_DIR), prefix=".branding-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
        os.replace(tmp, BRANDING_FILE)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def save(body):
    """Validate and persist branding. Raises ValueError on bad input."""
    current = load()
    name = _clip(body.get("name"), MAX_NAME)
    if not name:
        raise ValueError("name is required")
    tagline = _clip(body.get("tagline"), MAX_TAGLINE)
    mark = _clip(body.get("mark"), MAX_MARK)
    accent = body.get("accent", current["accent"])
    if not isinstance(accent, str) or not HEX_COLOR.match(accent):
        raise ValueError("accent must be a #rrggbb hex colour")

    logo = current["logo"]
    clear = body.get("clearLogo") is True
    upload = body.get("logoDataUrl")
    if clear and upload:
        raise ValueError("cannot both clear and upload a logo")
    if clear:
        _remove_logo_file()
        logo = None
    elif upload is not None:
        logo = _store_logo(upload)

    payload = {"name": name, "tagline": tagline, "mark": mark, "accent": accent, "logo": logo}
    _write_atomic(payload)
    return payload


def _remove_logo_file():
    if not LOGO_DIR.is_dir():
        return
    for path in LOGO_DIR.iterdir():
        if path.is_file() and path.name.startswith("logo."):
            try:
                path.unlink()
            except OSError:
                pass


def _store_logo(data_url):
    if not isinstance(data_url, str):
        raise ValueError("logo must be a data URL")
    match = DATA_URL.match(data_url.strip())
    if not match:
        raise ValueError("logo must be a base64 data URL (png, jpeg, webp, gif or svg)")
    kind = "jpeg" if match.group(1) in ("jpeg", "jpg") else match.group(1).replace("svg+xml", "svg")
    try:
        blob = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("logo data is not valid base64")
    if not blob:
        raise ValueError("logo is empty")
    if len(blob) > MAX_LOGO_BYTES:
        raise ValueError(f"logo exceeds {MAX_LOGO_BYTES // 1024} KiB")

    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    _remove_logo_file()
    target = LOGO_DIR / f"logo.{kind}"
    fd, tmp = tempfile.mkstemp(dir=str(LOGO_DIR), prefix=".logo-")
    with os.fdopen(fd, "wb") as f:
        f.write(blob)
    os.replace(tmp, target)
    return LOGO_TYPES[kind]


def logo_path(content_type):
    """Resolve the stored logo file for a given MIME type, or None."""
    if content_type not in LOGO_TYPES.values():
        return None
    ext = [k for k, v in LOGO_TYPES.items() if v == content_type and k != "jpg"][0]
    for candidate in LOGO_DIR.glob(f"logo.{ext}"):
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
    return None
