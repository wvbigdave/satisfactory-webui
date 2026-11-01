# Changelog

All notable changes to the Satisfactory WebUI are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning is SemVer
(`__version__` in `satisfactory_webui/__init__.py` is the single source of truth).

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
