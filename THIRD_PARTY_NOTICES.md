# Third-party notices and provenance

All upstreams were inspected at the pinned revisions below. Code reuse is explicitly distinguished from design/API reference. Complete unmodified license text is preserved in `licenses/` and the visible `/credits` page. No CDN, npm or pip runtime dependency is added.

## Svennix/Satisfactory_Ultimate_Dashboard

- Upstream: https://github.com/Svennix/Satisfactory_Ultimate_Dashboard
- Pinned revision: `e644aad9ed709d5e6b12b94fbd14b9b83675255a`
- License: MIT; full original copyright/license in `licenses/Satisfactory_Ultimate_Dashboard.LICENSE`.
- Adapted code: www/app.js fmtDur → satisfactory_webui/web/app.js fmtDuration (unknown-value guard added). Inspiration only: metric cards, separate system/history panels and count-activity heatmap. New Linux sampling, SVG charts and UTC observed-count aggregation are original; no PowerShell, player log inference or automatic policies imported.

## saffronjam/pioneer-hq

- Upstream: https://github.com/saffronjam/pioneer-hq
- Pinned revision: `1b341bfa3087eb4dec5f693946482165a8b0a9c3`
- License: MIT; full original copyright/license in `licenses/pioneer-hq.LICENSE`.
- Design inspiration only: purposeful sidebar, industrial orange, category-colored gauges and telemetry cards (dashboard/src/components/gauge/gauge.tsx inspected). No code/assets copied; Go/React/GraphQL/FRM stack is not installed. The vanilla API cannot supply factory, power, map or inventory telemetry.

## kazuninishiki/satisfactory-admin

- Upstream: https://github.com/kazuninishiki/satisfactory-admin
- Pinned revision: `bb88a1f6d5e434e2a58151c7c6634ce77eb902a0`
- License: MIT; full original copyright/license in `licenses/satisfactory-admin.LICENSE`.
- Reference only: satisfactory_admin.py SatisfactoryAPI methods and Linux administration workflows. Existing stdlib API wrapper retained; no Tkinter UI, connection profiles, base64 credential storage or source copied.

## Jayy001/PyFactoryBridge

- Upstream: https://github.com/Jayy001/PyFactoryBridge
- Pinned revision: `bc5bb91688324b0d4aa80f4bc21af951ab5b1f88`
- License: MIT; full original copyright/license in `licenses/PyFactoryBridge.LICENSE`.
- Adapted code: pyfactorybridge/__init__.py load_game request properties → satisfactory_webui/api.py load_game, explicit SaveName and EnableAdvancedGameSettings=False; session argument retained for compatibility. Download method reviewed; actual snapshots/downloads here use original constrained read-only Linux file access, not requests dependencies.

## Excluded source

FRM-s-WebUI-Source: no detected license; **no code copied**. No FRM or other game mod is installed or required. Player names, unique player counts, production, power, map, inventory and vehicle features are not invented or reconstructed from unreliable logs.

## Implementation documentation

- [Vanilla Dedicated Server HTTPS API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API): QueryServerState, EnumerateSessions, LoadGame and save controls.
- [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html): cpu.stat usage_usec and memory.current measure the entire game service, not its shell wrapper. CPU 100% = one core, memory includes cgroup page cache.
- [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html): StateDirectory and read-only home binds.
- Python stdlib sqlite3/http.server documentation; no new package dependencies.
