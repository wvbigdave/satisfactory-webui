# 🏭 Satisfactory WebUI

**A self-hosted Linux admin console for Satisfactory dedicated servers.**

[![Version 0.7.7](https://badges.axtriss.site/badge/version-0.7.7-blue)](CHANGELOG.md) ![Platform: Linux](https://badges.axtriss.site/badge/platform-Linux-lightgrey?logo=linux) ![Backend: Python 3](https://badges.axtriss.site/badge/backend-Python%203-3776AB?logo=python&logoColor=black) ![Frontend: React](https://badges.axtriss.site/badge/frontend-React-61DAFB?logo=react&logoColor=black) ![Deployment: systemd](https://badges.axtriss.site/badge/deployment-systemd-555555?logo=systemd)

---

## Getting the code

Clone the repository from GitHub (the public mirror of
`gitea.axtriss.site/wvbigdave/satisfactory-webui`) and install it from the
clone:

```sh
git clone https://github.com/wvbigdave/satisfactory-webui.git
cd satisfactory-webui
```

If you prefer the self-hosted source, clone from Gitea instead:

```sh
git clone https://gitea.axtriss.site/wvbigdave/satisfactory-webui.git
```

Use the [install script](#installation) in the checkout to deploy it. A
self-contained `install.sh` and automatic-update script are planned for the
1.0 release; until then, install from a full clone and upgrade by pulling,
then rerunning the installer.

## Features

| Area | Supported functionality |
|---|---|
| Overview | Vanilla game API state, live SSE with polling fallback, systemd status, disk and cgroup metrics |
| History | Seven-day local SQLite history and observed concurrent-player activity by UTC hour |
| Saves | List, download, save, load and delete; confirmation before saving, loading or deleting |
| Backups | Manual verified snapshots, downloads and explicit removal; no automatic pruning or restore |
| Configuration | Server options and advanced game settings through the game API |
| Logs | Journal tail of the configured game service |
| Updates | Manual Steam build checks and public/experimental updates, with optional file validation |
| Branding | Name, tagline, accent colour, text mark and logo |

No game mods or external asset CDN are required. Account names, paths, network
addresses, API endpoint and game service name are configurable. The application
is Linux/systemd-based; Windows service management is not supported.

## Requirements

- Linux with systemd and cgroup v2.
- Python 3, sudo, journalctl and iproute2.
- A Satisfactory dedicated server with an accessible HTTPS API.
- SteamCMD for the optional manual update feature.
- Node/npm only when developing or rebuilding the frontend. Built assets are included.

## Installation

Use the existing **unprivileged game-service account** and actual game/save
directories. The installer does not create accounts or install the game.

```sh
sh deploy/install.sh --help

# Replace the example account, paths and game unit with your own.
sh deploy/install.sh --user games --server-dir /srv/satisfactory \
  --save-dir /srv/satisfactory-saves --service factory.service --dry-run

sudo sh deploy/install.sh --user games --server-dir /srv/satisfactory \
  --save-dir /srv/satisfactory-saves --service factory.service
```

The server, save and config directories must exist and be readable by the
selected account. `--save-dir` must contain the `.sav` files. See `--help` for
custom group, code/config paths, SteamCMD, API, network, cgroup and SSO options.

The installer validates configuration, runs backend tests and installs
root-owned code at `/opt/satisfactory-webui` by default. It restarts **only the
WebUI**, not the game. The unit and sudoers files under `deploy/` are templates;
do not install them directly.

## Access

The default listener is **127.0.0.1:8082**, with loopback-only admission. Open
`http://127.0.0.1:8082` on the server, or use an SSH tunnel from your workstation:

```sh
ssh -N -L 8082:127.0.0.1:8082 your-user@your-server
```

Then open `http://localhost:8082`. For LAN access, pass your own `--bind`,
`--networks` and `--hosts` values to the installer. Hosts are matched exactly,
including a non-default port; admission uses the connecting client/proxy IP,
not forwarded IP headers.

**There is no built-in WebUI authentication. Every admitted client can
administer the game.** Public access requires an authenticated HTTPS reverse
proxy and a firewall preventing direct backend access. Optional SSO identity
and logout settings are display/integration features, not authorization.

## Configuration

| Installed file | Purpose |
|---|---|
| `/etc/satisfactory-webui/webui.env` | Runtime configuration |
| `/etc/satisfactory-webui/update.conf` | Root-owned update-helper account, paths and service policy |
| `/etc/satisfactory-webui/secrets.env` | Optional credentials; create root-owned with mode `0600` |
| `/etc/systemd/system/satisfactory-webui.service` | Generated sandboxed console unit |
| `/etc/sudoers.d/satisfactory-webui` | Generated game-control allowlist |
| `/var/lib/satisfactory-webui` | Installed service's history, backups, branding and update log |

Runtime settings are shared through `satisfactory_webui/config.py` and the
environment:

| Variable | Default / purpose |
|---|---|
| `SATISFACTORY_BIND`, `SATISFACTORY_PORT` | `127.0.0.1`, `8082`; IPv4 listener |
| `SATISFACTORY_NETWORKS` | `127.0.0.0/8`; admitted IPv4 CIDRs |
| `SATISFACTORY_HOSTS` | Bind address, loopback and localhost with the configured port |
| `SATISFACTORY_SERVER_DIR` | `~/server` |
| `SATISFACTORY_SAVE_DIR` | `~/.config/Epic/FactoryGame/Saved/SaveGames/server` |
| `SATISFACTORY_CONFIG_DIR` | `SERVER_DIR/FactoryGame/Saved/Config/LinuxServer` |
| `SATISFACTORY_STATE_DIR` | Without the installer: `$XDG_STATE_HOME/satisfactory-webui`, falling back to `~/.local/state/satisfactory-webui` |
| `SATISFACTORY_SERVICE` | `satisfactory.service` |
| `SATISFACTORY_CGROUP` | `/sys/fs/cgroup/system.slice/SERVICE`; override for custom slices |
| `SATISFACTORY_STEAM_MANIFEST` | `SERVER_DIR/steamapps/appmanifest_1690800.acf` |
| `SATISFACTORY_GAME_METADATA` | `SERVER_DIR/Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version` |
| `SATISFACTORY_API_URL` | `https://127.0.0.1:7777/api/v1` |
| `SATISFACTORY_API_TOKEN` | Optional game API bearer token |
| `SATISFACTORY_API_VERIFY_TLS` | `0` for numeric loopback, `1` otherwise; remote verification cannot be disabled |
| `SATISFACTORY_UPDATE_HELPER` | `/usr/local/sbin/satisfactory-server-update` |
| `SATISFACTORY_SSO_LOGOUT`, `SATISFACTORY_SSO_RETURN` | Optional proxy logout/return URLs; unset by default |

For tokenless local game API access, configure the game's
`AllowInsecureLocalAccess=1` setting. Otherwise supply a valid
`SATISFACTORY_API_TOKEN` in `secrets.env`. Remote game APIs require trusted TLS
certificates. The API client does not use environment proxies or follow redirects.

Rerun the installer when changing the game account, unit or sandbox paths so
runtime settings and privilege policy remain aligned. Custom metadata paths
outside the bound directories also require matching sandbox access.

## Operations and upgrades

```sh
sudo systemctl status satisfactory-webui.service
sudo journalctl -u satisfactory-webui.service -n 100 --no-pager
sudo systemctl restart satisfactory-webui.service
sudo systemctl disable --now satisfactory-webui.service
```

Before upgrading, back up the installed code and generated configuration.
Update your source, preview with `--dry-run`, and rerun the installer using
**the same deployment options**. It regenerates `webui.env`, `update.conf`,
the unit and sudoers; manual edits are not merged. It does not rewrite
`secrets.env`. Preserve persistent state when rolling back.

Game updates are separate, explicitly confirmed actions that disconnect
players. Update helpers are limited to one hour; checks to ten minutes. A
timeout may leave the game stopped: inspect its journal and installed files
before starting it manually. Output is bounded to 400 lines of at most 2,048
characters per line.

Backups are local, manual snapshots—not off-host recovery. Limits are 32 files,
512 MiB total, 64 MiB per file and 64 MiB free-space headroom. Download copies
to another machine for off-host protection. No automatic backup, update,
restart schedule or pruning policy is enabled.

## Development and checks

From the repository root:

```sh
python3 -m unittest discover -s tests -v
node --test tests/test_frontend.js
shellcheck deploy/install.sh deploy/satisfactory-server-update deploy/satisfactory-server-update-worker
uvx ruff check satisfactory_webui deploy/install.py --select F
uvx bandit -r satisfactory_webui deploy/install.py
```

Frontend:

```sh
cd frontend
npm ci
npm run typecheck
npm test
npm run build
npm audit
```

Commit rebuilt `satisfactory_webui/web/app/` assets with frontend changes.
`SATISFACTORY_DEV_PROXY` overrides Vite's development API target, which defaults
to `http://127.0.0.1:8082`.

Review Bandit's TLS and subprocess findings: the self-signed TLS exception is
restricted to numeric loopback addresses, and subprocesses use argument lists
rather than shell commands. These findings are not a clean security-audit claim.

## Provenance

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `licenses/`, `/credits`
and [CHANGELOG.md](CHANGELOG.md). The bundled FICSIT emblem is a replaceable
placeholder with a trademark notice. The console version in
`satisfactory_webui/__init__.py` is separate from the installed game's version.
