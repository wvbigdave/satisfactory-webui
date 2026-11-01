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

## Bread-Ch4n/FRM-s-WebUI-Source

- Upstream: https://github.com/Bread-Ch4n/FRM-s-WebUI-Source
- Pinned revision: `9f0d01340af1ad17cd6c835c575a6502175e923e`
- License: **no license file is present in the upstream repository.** Reuse of its self-contained visual/UI components here was explicitly authorized by this repository's owner (Dave) on 2026-10-31. Where the upstream later publishes a license, that license supersedes this note.
- Adapted techniques → `satisfactory_webui/web/fx.css` and `fx.js`:
  - `src/components/magicui/magic-card.tsx` mouse-following radial-gradient glow (`handleMouseMove` / `mouseout`) → vanilla-JS `trackMouse` / `resetMouse`.
  - `src/components/magicui/shine-border.tsx` animated gradient border → `.fx-shine`.
  - `src/components/magicui/animated-grid-pattern.tsx` and `dot-pattern.tsx` grid/dot backgrounds → `.fx-grid-bg`.
  - `src/components/magicui/ripple.tsx` concentric pulsing rings → `.fx-ripple-ring`.
  - `src/app/css/globals.css` `.card:hover` orange outer-glow + subtle scale → site-wide `.card:hover`.
- All effects honour `prefers-reduced-motion`. No React/Next/Motion runtime, Tailwind, build step or CDN was adopted; the effects are re-implemented as plain CSS plus a small dependency-free script.
- Data pages (`power`, `overallprod`, `detailedprod`, `map`, `drone`, `resourcesink`) were **NOT** ported: they poll the FRM game mod's endpoints, which is not installed and is not required of any player.

## Frontend libraries (npm, bundled)

The console UI is a React single-page app built with open-source libraries, each
used unmodified under its own license:

| Package | Version | License |
|---|---|---|
| react / react-dom | 19.3.1 | MIT |
| motion | 12.43.0 | MIT |
| recharts | 3.10.1 | MIT |
| lucide-react | 0.545.0 | ISC |
| tailwindcss / @tailwindcss/vite | 4.3.3 | MIT |

Build-time only (not shipped as runtime code): vite 7.3.7 and
@vitejs/plugin-react 5.2.0 (MIT), typescript 5.9.3 (Apache-2.0).

Full license texts are retained in the frontend dependency tree at
`frontend/node_modules/<package>/LICENSE`. The compiled bundle is served from
this host — no CDN, no third-party runtime dependency. Exact pinned versions are
in `frontend/package.json`; the committed build output lives in
`satisfactory_webui/web/app/`.

## FICSIT emblem (default placeholder logo)

- Source: https://satisfactory.wiki.gg/wiki/File:FICSIT_Inc..png (retrieved 2026-11-01)
- Bundled at `frontend/src/assets/ficsit-mark.png`, recoloured for the dark tile.
- **The FICSIT name and emblem are trademarks of Coffee Stain Studios AB.** This
  console is a private, LAN-only tool for one self-hosted Satisfactory server;
  the emblem is used only as the default placeholder brand mark. It is not sold,
  redistributed as a product, or used to imply endorsement, and it is bundled
  locally rather than hotlinked.
- Fully replaceable: upload your own logo or set a short text mark on the
  **Branding & logo** page, which supersedes the bundled artwork.

## Excluded source

No game mod (FRM or SML) is installed or required. Factory production, power, map, inventories, vehicles and named player telemetry remain unavailable because they are not exposed by the vanilla dedicated-server HTTPS API. Player names and unique-player counts are not reconstructed from unreliable logs.

## Implementation documentation

- [Vanilla Dedicated Server HTTPS API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API): QueryServerState, EnumerateSessions, LoadGame and save controls.
- [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html): cpu.stat usage_usec and memory.current measure the entire game service, not its shell wrapper. CPU 100% = one core, memory includes cgroup page cache.
- [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html): StateDirectory and read-only home binds.
- Python stdlib sqlite3/http.server documentation; no new package dependencies.
