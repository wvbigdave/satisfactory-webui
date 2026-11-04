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

### v0.3 unified Linux console

- Responsive industrial sidebar/dashboard with category-colored metrics,
  native SVG history charts and accessible capacity gauges; no CDN dependencies.
- One background sampler records real vanilla API TPS/player counts, Linux
  **whole-service cgroup** CPU/memory, filesystem usage and save sizes every 30s.
  SQLite history persists in `/var/lib/satisfactory-webui/history.sqlite`, bounded
  to seven days / 20,161 samples. Charts are downsampled to at most 600 points;
  unavailable samples remain gaps, not fabricated zeroes. CPU 100% means one core;
  cgroup memory includes cache and is not process RSS. Heatmap is observed mean
  concurrent players by UTC weekday/hour, not named users or unique-player counts.
- Manual save snapshots and streamed downloads, stored separately in
  `/var/lib/satisfactory-webui/backups`: 32 files, 512 MiB total, 64 MiB per file,
  64 MiB disk headroom. Full storage refuses new copies; **no automatic pruning**.
  Source saves are read-only in the sandbox; changing files are rejected.
  Snapshot names are server-generated; SHA-256 returned on creation.
- Explicit confirmation before game stop/restart/start, load/delete, applying
  options/settings or overwriting a named save. Mutation APIs retain CSRF and
  exact same-origin checks; body size is bounded. No autonomous game policy added.
- Upstream code vs design references are documented precisely in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and visible `/credits` with full
  unmodified licenses and pinned revisions.

| Feature | Status / reason |
|---|---|
| Overview, history, UTC count activity | Supported: vanilla API and Linux only |
| Saves/downloads/manual backup vault | Supported: no game mutation for snapshot/download |
| Existing config, logs, versions, ports, service controls | Retained; no changes applied during rollout |
| Scheduled backups/restarts/updates/pruning, watchdog, notifications | Manual backups, stop/start/restart and on-demand server updates supported; time-based scheduling, pruning, watchdog and notifications are not enabled (policy requires separate explicit approval) |
| Automatic/periodic update checks | Not enabled by default — the Update server page runs an explicit, quota-gated check and applies updates on demand |
| Restore/upload, arbitrary shell/console UI | Deferred: destructive/security-sensitive; download recovery copies first |
| Factory/power/map/inventory/vehicle data, individual player identities | Unavailable from vanilla API; FRM/mod-required work deferred |
| Pioneer HQ Go/React/GraphQL and Windows PowerShell runtime | Not bundled: incompatible/mod-dependent; compatible ideas integrated natively |
| Public access | Not supported without a separate authenticated HTTPS boundary |

New routes: `/update`, `/history`, `/backups`, `/credits`. JSON read endpoints:
`/api/update` (installed + latest-available build + job state), `/api/history?hours=1|6|24|168`, `/api/backups`, `/api/credits`.
Read-only attachment endpoints: `/api/download-save?name=<filename.sav>` and
`/api/download-backup?name=<archive.sav>`. POST `/api/backup` takes `name`;
`/api/remove-backup` takes `name` and `confirm: true`. All POSTs require the
session CSRF header. Local snapshots are not off-host disaster recovery.

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

Before replacing code, archive `/opt/satisfactory-webui`, the WebUI unit and
sudoers allowlist under a root-only timestamped directory. Record both the
`satisfactory` service MainPID and its game-binary child PID; neither should
change. Installer restarts **only the WebUI**. Roll back by restoring that code
and unit, `systemctl daemon-reload`, then restarting `satisfactory-webui` only.
Do not remove `/var/lib/satisfactory-webui` when rolling back; it contains history
and manual archives. `StateDirectory=` creates its restricted writable directory.

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
| Frontend typecheck | `cd frontend && npx tsc --noEmit` (developer machine only) |
| Frontend build | `cd frontend && npm install && node node_modules/vite/bin/vite.js build` |
| Frontend regressions | `node --test tests/test_frontend.js` (developer machine only; no npm packages) |

### Frontend (React SPA)

The UI is a React 19 + TypeScript single-page app: Vite 7, Tailwind CSS 4,
Motion, Recharts and lucide-react. Source lives in `frontend/`; the **built
output is committed** to `satisfactory_webui/web/app/` and served by the same
Python stdlib server. The target host needs **no Node toolchain at runtime**.

```sh
cd frontend
npm install                      # once; esbuild's postinstall script must be approved
node node_modules/vite/bin/vite.js build   # writes ../satisfactory_webui/web/app/
```

Rebuild and redeploy whenever anything under `frontend/src/` changes; commit the
regenerated `web/app/` in the same commit (hashed asset filenames change).
`/assets/*` is served by a dedicated handler with an extension allowlist and
`realpath` containment — traversal is rejected with 404. The build emits no
inline script or style, so the `'self'` CSP is unchanged.

### Branding and live data

- **Branding** (`/branding`) stores name, tagline, accent colour and logo in the
  systemd StateDirectory (`/var/lib/satisfactory-webui/branding.json` plus
  `branding/logo.<ext>`), so it survives deploys. `GET /api/branding` reads it,
  `POST /api/branding` writes it (CSRF required, ≤1 MiB body for the upload),
  and `GET /api/logo` serves the uploaded image with a sandboxing CSP. The
  bundled FICSIT emblem is the default placeholder — see THIRD_PARTY_NOTICES.md
  for its trademark note — and any custom logo or text mark supersedes it.
- **Live streaming**: `GET /api/stream` is a Server-Sent Events endpoint that
  pushes the overview snapshot every 3 s and closes after ~10 minutes so the
  worker thread is not held indefinitely; the browser reconnects automatically.
  The UI shows a LIVE badge while streaming and silently falls back to polling.
  Note that a browser automation tool waiting on a page "load" event can appear
  to hang while the stream is open — navigate on a timer instead.

## Versioning

| Policy | Detail |
|---|---|
| Version source | `satisfactory_webui/__init__.py` |
| Presentation | Client-rendered footer and header badge on every route, `/api/version` |
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

The service uses `ProtectHome=tmpfs` with a read-only server directory bind and
an explicit writable config-directory bind. Binding directories avoids pinning
old metadata inodes if Steam replaces files during an update. Other home data
remains hidden. See [systemd sandboxing](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#ProtectHome=).

Implementation references: [Satisfactory HTTPS API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API)
for live game state. In the React frontend, every fetch goes through one
`useApi` hook that always resolves loading and error state, so a page can never
strand a spinner (the original vanilla app left lifecycle state set after
rendering — see the loading-bug history in [CHANGELOG.md](CHANGELOG.md)).
