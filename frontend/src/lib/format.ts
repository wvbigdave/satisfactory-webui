/* Formatting helpers. Numbers that are unknown stay visibly unknown — never
   rendered as a misleading 0 or a fabricated value. */

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function fmtBytes(bytes?: number | null, digits = 1): string {
  if (!isNum(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function fmtDuration(seconds?: number | null): string {
  if (!isNum(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

export function fmtNum(v?: number | null, digits = 1): string {
  return isNum(v) ? v.toFixed(digits) : "—";
}

export function fmtTime(ts?: number | null): string {
  if (!isNum(ts)) return "—";
  return new Date(ts * 1000).toLocaleTimeString();
}

/** Turn a UE object path like /Script/.../BP_Foo.BP_Foo_C into "BP Foo". */
export function objectName(path?: string | null): string {
  if (!path) return "—";
  const tail = path.split(/[./]/).filter(Boolean).pop() || path;
  return tail.replace(/_C$/, "").replace(/^BP_/, "").replace(/_/g, " ").trim() || path;
}

export function phaseName(path?: string | null): string {
  if (!path) return "—";
  const tail = path.split(".").pop() || path;
  return tail.replace(/^GP_/, "").replace(/_/g, " ").replace(/\bPhase\b/i, "Phase").trim();
}

export const SCHEMATIC_TIER: Record<string, string> = {};
