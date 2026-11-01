import { useState } from "react";
import { api, type History as HistoryData } from "../api";
import { Heatmap, TelemetryChart } from "../components/charts";
import { PageTitle } from "../components/Layout";
import { Chip, ErrorBox, Loading, Panel, SectionHead } from "../components/ui";
import { useApi } from "../lib/useApi";

const WINDOWS = [
  { hours: 1, label: "1 h" },
  { hours: 6, label: "6 h" },
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 d" },
];

export default function History() {
  const [hours, setHours] = useState(6);
  const { data, error, loading } = useApi<HistoryData>(() => api.history(hours), [hours], 15000);

  return (
    <>
      <PageTitle title="Telemetry & activity" note="30-second Linux/API sampling · seven-day rolling retention · persists across restarts" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w.hours}
            onClick={() => setHours(w.hours)}
            className={[
              "rounded-md border px-3 py-1.5 text-[12px] transition",
              hours === w.hours ? "border-accent bg-accent/15 text-accent" : "border-edge bg-panel2 text-muted hover:text-ink",
            ].join(" ")}
          >
            {w.label}
          </button>
        ))}
        {data && (
          <span className="ml-auto flex gap-2">
            <Chip tone="accent">{data.totalSamples ?? 0} samples</Chip>
            <Chip>interval {data.intervalSeconds ?? "?"}s</Chip>
            <Chip>retention {data.retentionDays ?? "?"}d</Chip>
            <Chip>{data.timezone || "UTC"}</Chip>
          </span>
        )}
      </div>

      {loading && !data && <Loading />}
      {error && !data && <ErrorBox message={error} />}
      {data && (
        <>
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Panel glow={false}><TelemetryChart samples={data.samples} field="tps" label="Tick rate" unit="TPS" color="green" height={200} /></Panel>
            <Panel glow={false}><TelemetryChart samples={data.samples} field="players" label="Concurrent players" unit="players" color="blue" height={200} digits={0} /></Panel>
            <Panel glow={false}><TelemetryChart samples={data.samples} field="memoryBytes" label="Service memory" unit="bytes" color="purple" height={200} digits={0} /></Panel>
            <Panel glow={false}><TelemetryChart samples={data.samples} field="cpuPercent" label="Service CPU" unit="%" color="orange" height={200} /></Panel>
            <Panel glow={false}><TelemetryChart samples={data.samples} field="diskUsed" label="Filesystem used" unit="bytes" color="red" height={200} digits={0} /></Panel>
            <Panel glow={false}><TelemetryChart samples={data.samples} field="saveBytes" label="Save storage" unit="bytes" color="orange" height={200} digits={0} /></Panel>
          </div>

          <Panel glow={false}>
            <SectionHead title="Player activity · UTC" hint="Mean observed concurrent players by weekday/hour." />
            <Heatmap cells={data.heatmap || []} />
          </Panel>

          <Panel glow={false} className="mt-5">
            <SectionHead title="Honesty notes" />
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted">
              <li>Unknown values are left as gaps — never interpolated into a fake zero.</li>
              <li>CPU is whole-service cgroup usage; 100% = one core. Memory includes page cache.</li>
              <li>Per-player identity, playtime and factory data are not available from the vanilla API.</li>
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
