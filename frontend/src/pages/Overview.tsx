import { RefreshCw, Play, RotateCw, Square } from "lucide-react";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { api, type Overview as OverviewData } from "../api";
import { Heatmap, TelemetryChart } from "../components/charts";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, Gauge, KV, Loading, Metric, Panel, SectionHead, StatusPill, useConfirm, useToast } from "../components/ui";
import { fmtBytes, fmtDuration, fmtTime, objectName, phaseName } from "../lib/format";
import { useApi } from "../lib/useApi";

function Hero({ name, online, health }: { name: string; online: boolean; health: string }) {
  return (
    <Panel shine className="relative mb-5 !border-accent2/60 overflow-hidden">
      <div className="ripples" aria-hidden>
        {[120, 220, 320, 420].map((s, i) => (
          <span key={s} className="ripple" style={{ width: s, height: s, opacity: 0.3 - i * 0.06, "--d": `${i * 1.4}s` } as CSSProperties} />
        ))}
      </div>
      <div className="relative z-[1] flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Vanilla / Linux operations</p>
          <h2 className="mt-1 text-[26px] font-semibold tracking-tight">{name}</h2>
          <p className="mt-1 text-[13px] text-muted">One console for your dedicated server. No game mods, nothing for players to install.</p>
        </div>
        <StatusPill ok={online}>{health}</StatusPill>
      </div>
    </Panel>
  );
}

export default function Overview() {
  const { data, error, loading, refresh, tick } = useApi<OverviewData>(api.overview, [], 4000);
  const toast = useToast();
  const confirm = useConfirm();

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;
  const d = data as OverviewData;

  const g = d.state || {};
  const r = d.resources || {};
  const disk = d.disk || {};
  const sizes = d.saveStorage || {};
  const hist = (d.history?.samples || []).slice(-240);

  async function svc(action: "start" | "restart" | "stop") {
    const danger = action === "stop";
    const ok = await confirm({
      title: action === "restart" ? "Restart the game server?" : action === "stop" ? "Stop the game server?" : "Start the game server?",
      body: action === "stop"
        ? "This stops the Satisfactory dedicated server. Connected players will be disconnected and the world will not be saved unless it has autosaved. Continue?"
        : action === "restart"
          ? "This restarts the dedicated server. Connected players will be disconnected. Continue?"
          : "This starts the dedicated server if it is stopped. Continue?",
      danger, confirmLabel: action[0].toUpperCase() + action.slice(1),
    });
    if (!ok) return;
    try { await api.service(action); toast("ok", `Service ${action} requested.`); refresh(); }
    catch (e) { toast("err", e instanceof Error ? e.message : String(e)); }
  }

  return (
    <>
      <PageTitle title="Overview" note={`Live state sampled ${new Date().toLocaleTimeString()} · auto-refresh 4s`} />
      <Hero name={g.activeSessionName || "Dedicated server"} online={!!d.ok} health={d.health || "API offline"} />
      {!d.ok && <div className="mb-4"><ErrorBox message={`Server unreachable: ${d.error || "API unavailable"}`} /></div>}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Connected players" value={g.numConnectedPlayers ?? null} detail={`of ${g.playerLimit ?? "—"} slots`} color="blue" n={g.numConnectedPlayers ?? null} max={g.playerLimit ?? null} digits={0} />
        <Metric label="Average tick rate" value={g.averageTickRate ?? null} detail="TPS · API-reported, not a fixed target" color="green" suffix="" />
        <Metric label="Service memory" value={r.memoryBytes ? r.memoryBytes / 1024 / 1024 : null} detail="MiB · whole service cgroup (includes cache)" color="purple" digits={0} />
        <Metric label="Service CPU" value={r.cpuPercent ?? null} detail={`% · 100% = one core (up to ${r.cpuCores ?? "?"} cores)`} color="orange" n={r.cpuPercent ?? null} max={(r.cpuCores || 1) * 100} suffix="%" />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel glow={false}>
          <SectionHead title="Server pulse" hint="Last 4 hours · 30-second samples · gaps stay unknown" />
          <TelemetryChart samples={hist} field="tps" label="Tick rate" unit="TPS" color="green" />
          <div className="mt-4"><TelemetryChart samples={hist} field="players" label="Concurrent players" unit="players" color="blue" height={150} digits={0} /></div>
        </Panel>

        <Panel glow={false}>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Session / progression</p>
          <h2 className="mb-2 mt-1 text-[15px] font-semibold">Current expedition</h2>
          <KV k="Tech tier" v={g.techTier ?? "—"} />
          <KV k="Game phase" v={phaseName(g.gamePhase)} />
          <KV k="Active schematic" v={objectName(g.activeSchematic)} />
          <KV k="Accumulated game time" v={fmtDuration(g.totalGameDuration)} />
          <KV k="Session state" v={<Chip tone={g.isGamePaused ? "warn" : g.isGameRunning ? "ok" : "bad"}>{g.isGamePaused ? "PAUSED" : g.isGameRunning ? "RUNNING" : "STOPPED"}</Chip>} />
          <KV k="Autoload session" v={g.autoLoadSessionName || "—"} />
          <p className="mt-3 text-[11px] text-muted">Game time is not process uptime. Factory, power and inventories are not exposed by the vanilla API.</p>
        </Panel>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Panel glow={false}>
          <SectionHead title="Storage & saves" hint={sizes.source || undefined} />
          <Gauge value={disk.used} max={disk.total} label="Server filesystem used" color="orange" />
          <div className="mt-3">
            <KV k="Disk free" v={fmtBytes(disk.free)} />
            <KV k="Save storage" v={fmtBytes(sizes.bytes)} />
            <KV k="Latest file size" v={fmtBytes(sizes.latestBytes)} />
            <KV k="API save count" v={d.saveCount ?? "—"} />
            {d.latestSave && <KV k="Latest save" v={d.latestSave.name} />}
            {d.latestSave && <KV k="Saved at" v={d.latestSave.date} />}
          </div>
          {sizes.error && <p className="mt-2 text-[11px] text-warn">{sizes.error}</p>}
        </Panel>

        <Panel glow={false}>
          <SectionHead
            title="Service controls"
            hint="Manual actions only. No scheduled updates, restarts or watchdogs."
            right={<Chip tone={d.service?.ActiveState === "active" ? "ok" : "warn"}>{d.service?.ActiveState || "unknown"}</Chip>}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => svc("start")}><span className="inline-flex items-center gap-1.5"><Play size={13} /> Start</span></Button>
            <Button onClick={() => svc("restart")}><span className="inline-flex items-center gap-1.5"><RotateCw size={13} /> Restart…</span></Button>
            <Button variant="danger" onClick={() => svc("stop")}><span className="inline-flex items-center gap-1.5"><Square size={13} /> Stop…</span></Button>
          </div>
          <div className="mt-4">
            <KV k="Service PID" v={d.service?.ExecMainPID || "—"} />
            <KV k="Sub-state" v={d.service?.SubState || "—"} />
            <KV k="Sampled at" v={fmtTime(d.ts)} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="ghost" onClick={refresh}><span className="inline-flex items-center gap-1.5"><RefreshCw size={12} /> Refresh now</span></Button>
            <span className="text-[10px] text-muted">tick {tick}</span>
          </div>
        </Panel>
      </div>

      {d.history?.heatmap?.length ? (
        <Panel glow={false}>
          <SectionHead title="Player activity · UTC" hint="Mean observed concurrent players by weekday/hour over retained history." />
          <Heatmap cells={d.history.heatmap} />
        </Panel>
      ) : null}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 text-[11px] text-muted">
        Read-only telemetry. Destructive actions require explicit confirmation.
      </motion.div>
    </>
  );
}
