# Changelog

All notable changes to the Satisfactory WebUI are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning is SemVer
(`__version__` in `satisfactory_webui/__init__.py` is the single source of truth).

## [0.6.2] - 2026-11-01

### Added
- **Backup vault manual snapshot control** (`/backups`): a "Create snapshot"
  field at the top of the page backs up an existing save by its name directly
  from the vault (Enter or button), with a working state and a tip pointing to
  the per-save Snapshot button on Sessions & saves.

### Changed
- **Configuration page cleanup**: removed the raw config-key line (e.g.
  `FG.WeatherPreset`) that rendered in monospace below every field — it added
  noise and the filter already matches by key, so nothing is lost.

### Fixed
- **Save-name resolution** (`archives._open`): the Sessions & saves page lists
  save names without the `.sav` extension and passes them to the download and
  Snapshot endpoints, but the archive layer strictly required a `.sav`
  filename — so per-save **Download** and **Snapshot** returned HTTP 400. A
  bare name is now resolved by appending `.sav` (after the same strict
  path/traversal validation), so download and snapshots work from both the
  Saves page and the new vault control.

## [0.6.1] - 2026-11-01

### Added
- **Configuration filter bar** (backported from the ATS / openOMSI consoles): a
  "Find an option…" field at the top of `/config` filters both panels live as
  you type, matching a field by its key, label, or help text, with a live
  match count and per-panel empty states. Implemented the React way — a
  `useMemo`-derived entry list, so filtering re-renders only the visible
  fields and never mutates the working edit state.

## [0.6.0] - 2026-11-01

### Added
- **Branding & logo** (`/branding`): customizable console name, tagline, accent
  colour and logo, persisted in the service StateDirectory and applied across the
  whole UI (header tile, sidebar, hero and theme accent). Backend in
  `satisfactory_webui/branding.py`; routes `GET/POST /api/branding` and
  `GET /api/logo`. Uploads are validated (raster/SVG, ≤512 KiB) and the logo is
  served with a sandboxing CSP.
- **Live streaming**: `GET /api/stream` pushes the overview snapshot over
  Server-Sent Events every 3 s. The UI shows a LIVE badge and falls back to
  polling automatically if the stream cannot be established.
- Default placeholder mark: the FICSIT emblem, credited with its provenance and
  trademark note and replaceable at any time in Branding & logo.

### Changed
- **Frontend code splitting**: routes are lazy-loaded and `recharts`/`motion` are
  separate vendor chunks, so the initial page load dropped from ~235 kB to
  ~129 kB gzip; charts stream in after the metrics paint.
- Removed the repeated "no game mods / nothing for players to install" notice
  from the interface — it now appears once, as provenance, on the Credits page.

## [0.5.0] - 2026-11-01

### Changed
- **Frontend rebuilt as a React 19 + TypeScript single-page app** (Vite 7,
  Tailwind CSS 4, Motion, Recharts, lucide-react), replacing the vanilla
  HTML/CSS/JS pages. The bundled output is committed to
  `satisfactory_webui/web/app/` and served by the same stdlib server, so the
  target host still needs no Node toolchain at runtime.
- New interaction layer: client-side routing with animated page transitions,
  a Ctrl+K command palette, live polling with animated counters, interactive
  charts with range windows, and an explicit confirmation dialog for every
  destructive action.
- `app.py` now serves `/assets/*` through a dedicated handler with an extension
  allowlist and realpath containment (traversal rejected with 404), and serves
  the built SPA shell as the fallback for client-side routes.

### Added
- `frontend/` (Vite project) committed alongside the built output; see README
  for the build command.

### Notes
- No game mod is installed or required; the FRM data pages remain out of scope.
- CSP is unchanged (`'self'`, no inline); the build emits no inline script/style.

## [0.4.0] - 2026-10-31

### Added
- Visual effects layer (`web/fx.css`, `web/fx.js`), re-implementing the
  self-contained MagicUI techniques from Bread-Ch4n/FRM-s-WebUI-Source as plain,
  dependency-free CSS/JS: mouse-following MagicCard glow, ShineBorder animated
  border on heroes, animated grid background, ripple rings and a site-wide
  orange card hover glow. All effects honour `prefers-reduced-motion`.
- `/fx.css` and `/fx.js` are served explicitly (same-origin, CSP-safe).
- FRM-s-WebUI-Source credited in `credits.json`, the visible `/credits` page and
  `THIRD_PARTY_NOTICES.md` at pinned revision, with an explicit reuse-
  authorization note (upstream ships no license file; owner authorized reuse).

### Notes
- No game mod is installed or required. FRM data pages (power, production, map,
  drone, resource sink) are intentionally not ported; the vanilla API cannot
  supply their data.

## [0.3.0] - 2026-10-31

### Added
- Unified responsive Linux/vanilla operations dashboard, orange industrial
  sidebar, category-colored capacity gauges, session/progression and metadata.
- Persistent bounded 30-second API/Linux history, six honest telemetry charts,
  1h/6h/24h/7d windows and UTC observed-concurrent-player activity heatmap.
- Constrained manual snapshot vault, SHA-256 creation receipt and streamed save/
  archive downloads. Explicit removal only; no pruning, restore or game writes.
- Visible Credits with pinned MIT upstreams and complete license texts; precise
  code-reuse versus inspiration notices. No mod or player install required.

### Fixed / hardened
- Offline API no longer appears healthy; null observations remain unknown.
- Measure game cgroup, not its shell MainPID; chart gaps survive downsampling.
- Explicit destructive confirmations, quoted-attribute escaping, bounded request
  bodies, exact origin-to-Host validation, headers on all HTTP responses.
- Retain loading lifecycle regressions and installed version/build distinctions.

## [0.2.1] - 2026-10-31

### Fixed
- Reveal installed metadata inside the WebUI's systemd mount sandbox using
  `ProtectHome=tmpfs` and explicit server read-only/config writable bind mounts.
  `ReadOnlyPaths` alone did not undo the previous `ProtectHome=true` hiding.
  Other home data remains hidden; no game service or files are modified.

## [0.2.0] - 2026-10-31

### Fixed
- Clear the initial `Loading…` status and `aria-busy` after all five page loads,
  including API errors and network failures. Preserve later action messages.

### Added
- Overview and About show installed game version, game changelist and Steam
  build ID separately from the WebUI version. Metadata is read afresh from the
  installed Steam appmanifest and FactoryServer `.version` file; unavailable
  values remain Unknown. Installed files are not proof of the running version.
- Dependency-free frontend lifecycle regressions and installed-metadata tests.

## [0.1.0] - 2026-10-28

Initial release — LAN admin console for the Axtriss Satisfactory dedicated server.

### Added
- Overview page: live server state (health, session, players, phase, tier, tick
  rate, uptime, autoload), latest save, disk usage, and systemd service controls.
- Saves page: enumerate sessions and save files, load a save, save now, delete a
  save file.
- Configuration page: edit and apply Server Options and Advanced Game Settings
  through the game's HTTPS API, with concise field help.
- Server logs page: bounded journal tail of `satisfactory.service`.
- About & ports page: version, bind address, admitted networks, config dir,
  service state, and live listeners.
- Security: binds to a single private address, admits loopback + configured
  private subnets, exact Host allowlist, random CSRF token + same-Origin check
  on every POST, CSP/frame-denial/nosniff headers, systemd hardening, and a
  fixed sudo allowlist for service control.
- Data source: the game's HTTPS API on `127.0.0.1:7777` (enabled by
  `FG.DedicatedServer.AllowInsecureLocalAccess=1` in Engine.ini).
