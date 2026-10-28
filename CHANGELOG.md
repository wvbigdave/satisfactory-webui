# Changelog

All notable changes to the Satisfactory WebUI are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning is SemVer
(`__version__` in `satisfactory_webui/__init__.py` is the single source of truth).

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
