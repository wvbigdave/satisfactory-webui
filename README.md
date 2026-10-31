# Satisfactory WebUI

**LAN admin console for the Axtriss Satisfactory dedicated server — live state, save management, configuration, logs and systemd service controls.**

## Deployment

| Item | Value |
|---|---|
| Code | `/opt/satisfactory-webui` |
| Service | `satisfactory-webui.service` (dedicated `satisfactory` account) |
| Game | Satisfactory dedicated server (CT 200, 192.168.4.60) |
| API | HTTPS API on `127.0.0.1:7777` (`AllowInsecureLocalAccess=1`) |
| Configuration | `Engine.ini`, `GameUserSettings.ini` (read-only to this console) |
| Runtime dependencies | Python 3 standard library, systemd, sudo, iproute2 |

## Capabilities

| Page | Verified source / behavior |
|---|---|
| Overview | Live server state via HTTPS API, systemd state, disk usage; confirmed start/stop/restart |
| Saves | Enumerate sessions/saves, load a save, save now, delete a save file |
| Configuration | Edit and apply Server Options and Advanced Game Settings via the API, with field help |
| Server logs | Bounded journal tail of `satisfactory.service` |
| About & ports | Version, bind address, admitted networks, config dir, listeners |

## Security boundary

**This is not an authenticated console. Every admitted client can administer the
game server.** Bind it to a trusted network only — by default it listens on one
private address and admits loopback plus the configured private subnets — and do
not expose it through a public proxy without adding authentication and HTTPS
first.

| Control | Scope |
|---|---|
| Bind / admission | Single private bind address; loopback plus configurable private subnets; exact Host allowlist |
| CSRF | Random process token, custom header, required same Origin for every POST |
| Browser policy | CSP without inline script/style, frame denial, no CORS, no-store, nosniff |
| API access | Loopback only; the game API is never exposed to the browser |
| Privilege | Root-owned code; runs as the `satisfactory` account; sudo allows only three exact systemctl commands; systemd limits filesystem, devices and memory |

## Install / update

Copy the complete tracked source to the target host (e.g. `/opt/satisfactory-webui`).

```sh
# On the target host, after copying this repository:
sudo sh /opt/satisfactory-webui/deploy/install.sh
sudo systemctl status satisfactory-webui.service
```

Set the bind address, port, admitted subnets and Host allowlist via `Environment=`
lines in the unit (see `deploy/satisfactory-webui.service`). The installer tests
before enabling, validates the sudoers file, installs only the supplied
service/allowlist, and restarts the console. It does not restart or rewrite the
game.

| Operation | Command |
|---|---|
| Console journal | `sudo journalctl -u satisfactory-webui -n 100 --no-pager` |
| Game journal | `sudo journalctl -u satisfactory -n 200 --no-pager` |
| Disable console | `sudo systemctl disable --now satisfactory-webui` |
| Tests | `python3 -m unittest discover -s tests -v` |
| JS syntax | `node --check satisfactory_webui/web/app.js` (developer machine only) |
| Frontend regressions | `node --test tests/test_frontend.js` (developer machine only; no npm packages) |

## Versioning

| Policy | Detail |
|---|---|
| Version source | `satisfactory_webui/__init__.py` |
| Presentation | Server-rendered version footer on every route, `/api/version` |
| Releases | SemVer; changes recorded in [CHANGELOG.md](CHANGELOG.md) |
| Public-ready | Not claimed: authentication and HTTPS are required before public exposure |

### Installed game-server version

Overview and About expose the same `serverVersion` object returned by
`/api/overview` and `/api/about`, even if the game's HTTPS API is offline:

- **Steam build ID**: root `buildid` in
  `/home/satisfactory/server/steamapps/appmanifest_1690800.acf` (App ID 1690800),
  not `TargetBuildID`, depot manifest IDs, or a latest-release lookup.
- **Game version** and **game changelist (CL)**: explicit `GameVersion` and
  `Changelist` fields in
  `/home/satisfactory/server/Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version`.
  Unreal Engine `MajorVersion`/`MinorVersion` are not the game version.
- Missing/unreadable metadata is **Unknown**, with source paths and errors
  displayed. Files are read on each request so updates need no WebUI restart.
  These describe installed files, not proof of which executable a running
  process loaded. The WebUI footer and `/api/version` remain UI-only SemVer.

Implementation references: [Satisfactory HTTPS API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API)
for live game state, [MDN hidden](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden)
for completed status removal. The loading bug was lifecycle state left set after
rendering, not an API polling failure or CSS overriding the hidden attribute.
