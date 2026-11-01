import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistorySample, HeatCell } from "../api";

const COLORS: Record<string, string> = {
  orange: "#ff963e", blue: "#5aa9f0", green: "#56d6a0", purple: "#b48cf2", red: "#ff7c7c",
};

export function TelemetryChart({
  samples, field, label, unit, color = "orange", height = 190, digits = 1,
}: {
  samples: HistorySample[]; field: keyof HistorySample; label: string; unit: string;
  color?: keyof typeof COLORS; height?: number; digits?: number;
}) {
  // Break the line at gaps so unknown periods read as gaps, not as zero.
  let prev: number | null = null;
  const rows = samples
    .filter((s) => typeof s.ts === "number")
    .map((s) => {
      const raw = s[field];
      const v = typeof raw === "number" && Number.isFinite(raw) ? (raw as number) : null;
      const gap = prev != null && s.ts - prev > 300;
      prev = s.ts;
      return { t: s.ts, v: gap ? null : v };
    });

  const stroke = COLORS[color];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-ink">{label}</span>
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id={`g-${field}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#243040" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
            tickFormatter={(v) => new Date(v * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            stroke="#6b7787" tick={{ fontSize: 10 }} minTickGap={40}
          />
          <YAxis stroke="#6b7787" tick={{ fontSize: 10 }} width={46}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(digits) : String(v))} />
          <Tooltip
            contentStyle={{ background: "#141922", border: "1px solid #2a3442", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => new Date((v as number) * 1000).toLocaleString()}
            formatter={(v) => [v == null ? "no data" : `${Number(v).toFixed(digits)} ${unit}`, label]}
          />
          <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.8} fill={`url(#g-${field})`} connectNulls={false} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const grid = new Map<string, HeatCell>();
  let max = 0;
  for (const c of cells) {
    grid.set(`${c.day}-${c.hour}`, c);
    if (typeof c.players === "number" && c.players > max) max = c.players;
  }
  const color = (p: number | null) => {
    if (p == null) return "#171d26";
    if (max === 0) return "#2a3442";
    const a = 0.15 + 0.85 * (p / max);
    return `rgba(255,150,62,${a.toFixed(3)})`;
  };
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `34px repeat(24, 15px)` }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[9px] text-muted">{h % 3 === 0 ? h : ""}</span>
        ))}
        {DOW.map((d, day) => (
          <div key={d} className="contents">
            <span className="pr-1 text-right text-[10px] leading-[15px] text-muted">{d}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const c = grid.get(`${day}-${hour}`);
              const p = c && typeof c.players === "number" ? c.players : null;
              return (
                <span
                  key={hour}
                  title={`${d} ${String(hour).padStart(2, "0")}:00 UTC — ${p == null ? "unobserved" : p.toFixed(2) + " avg players"}`}
                  className="h-[15px] w-[15px] rounded-[3px]"
                  style={{ background: color(p) }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">Mean observed concurrent players by weekday/hour (UTC). Empty = unobserved; a lit cell means the server was sampled.</p>
    </div>
  );
}
