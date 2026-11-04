/* Typed client for the Satisfactory WebUI's vanilla HTTPS API.
   The server enforces exact Origin + a CSRF token on every POST, so we fetch
   the token once and attach it (and the same-origin credentials) to writes. */

export interface ServerVersion {
  steamBuildId?: string | null;
  gameVersion?: string | null;
  changelist?: string | null;
  steamSource?: string | null;
  gameSource?: string | null;
  errors?: string[];
}

export interface GameState {
  activeSessionName?: string;
  numConnectedPlayers?: number;
  playerLimit?: number;
  techTier?: number;
  activeSchematic?: string;
  gamePhase?: string;
  isGameRunning?: boolean;
  totalGameDuration?: number;
  isGamePaused?: boolean;
  averageTickRate?: number;
  autoLoadSessionName?: string;
}

export interface HistorySample {
  ts: number;
  players?: number | null;
  tps?: number | null;
  memoryBytes?: number | null;
  cpuPercent?: number | null;
  diskUsed?: number | null;
  saveBytes?: number | null;
  latestSaveBytes?: number | null;
  session?: string | null;
  gapThreshold?: number;
}

export interface HeatCell { day: number; hour: number; players: number | null; samples: number }

export interface History {
  samples: HistorySample[];
  heatmap: HeatCell[];
  totalSamples?: number;
  firstTs?: number | null;
  lastTs?: number | null;
  intervalSeconds?: number;
  retentionDays?: number;
  hours?: number;
  timezone?: string;
  error?: string | null;
}

export interface Overview {
  ok: boolean;
  ts: number;
  error?: string | null;
  health?: string;
  state: GameState;
  resources?: { memoryBytes?: number | null; cpuPercent?: number | null; cpuCores?: number; source?: string; error?: string | null };
  disk?: { total?: number; used?: number; free?: number };
  saveStorage?: { bytes?: number; count?: number; latestBytes?: number; source?: string; error?: string | null };
  service?: { ExecMainPID?: string; LoadState?: string; ActiveState?: string; SubState?: string };
  latestSave?: { name?: string; date?: string } | null;
  saveCount?: number;
  history?: History;
  serverVersion?: ServerVersion;
  options?: { serverOptions?: Record<string, string>; pendingServerOptions?: Record<string, string> };
  advanced?: { creativeModeEnabled?: boolean; advancedGameSettings?: Record<string, string> };
  sessions?: Session[];
}

export interface SaveHeader {
  saveName: string;
  sessionName?: string;
  playDurationSeconds?: number;
  saveDateTime?: string;
  isModdedSave?: boolean;
  isEditedSave?: boolean;
  isCreativeModeEnabled?: boolean;
  mapName?: string;
  buildVersion?: number;
  saveVersion?: number;
}
export interface Session { sessionName: string; saveHeaders: SaveHeader[] }
export interface SavesData { ok: boolean; sessions: Session[]; latestSave?: { name: string; date: string } | null; saveCount?: number; error?: string | null }

export interface FieldSpec { label: string; help?: string; kind: "bool" | "int" | "float" | "text" | "enum" | "string"; min?: number; max?: number; step?: number; default?: string; options?: { value: string; label: string }[] }
export interface ConfigData {
  ok: boolean;
  serverOptions: Record<string, string>;
  pendingServerOptions?: Record<string, string>;
  advanced: Record<string, string>;
  creativeModeEnabled?: boolean;
  serverFields?: Record<string, FieldSpec>;
  advancedFields?: Record<string, FieldSpec>;
}

export interface BackupFile { name: string; bytes: number; modified: number }
export interface BackupsData { files: BackupFile[]; totalBytes: number; maxBytes: number; maxFiles: number; maxFileBytes: number; policy: string }

export interface AboutData {
  version: string;
  serverVersion: ServerVersion;
  bind: string; port: number; networks: string[]; hosts: string[];
  service: Record<string, string>; listeners: string; configDir: string;
}

export interface Credit { name: string; url: string; revision: string; licenseName: string; license: string; use: string }
export interface CreditsData { note?: string; projects: Credit[] }

export interface Branding {
  name: string;
  tagline: string;
  mark: string;
  accent: string;
  logo: string | null;
}

export interface SSO {
  user: string | null;
  logoutUrl: string;
  authenticated: boolean;
}

export interface LogsData { text: string }

let csrfToken = "";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* non-JSON error body */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  if (!csrfToken) csrfToken = (await getJSON<{ csrf: string }>("/api/session")).csrf;
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  session: () => getJSON<{ csrf: string }>("/api/session"),
  version: () => getJSON<{ version: string }>("/api/version"),
  overview: () => getJSON<Overview>("/api/overview"),
  history: (hours: number) => getJSON<History>(`/api/history?hours=${hours}`),
  saves: () => getJSON<SavesData>("/api/saves"),
  config: () => getJSON<ConfigData>("/api/config"),
  logs: () => getJSON<LogsData>("/api/logs"),
  about: () => getJSON<AboutData>("/api/about"),
  backups: () => getJSON<BackupsData>("/api/backups"),
  credits: () => getJSON<CreditsData>("/api/credits"),
  branding: () => getJSON<Branding>("/api/branding"),
  sso: () => getJSON<SSO>("/api/sso"),
  saveBranding: (payload: Partial<Branding> & { logoDataUrl?: string; clearLogo?: boolean }) =>
    postJSON<Branding>("/api/branding", payload),
  applyOptions: (updated: Record<string, string>) => postJSON("/api/apply-options", { updated }),
  applyAdvanced: (updated: Record<string, string>) => postJSON("/api/apply-advanced", { updated }),
  saveNow: (name: string) => postJSON("/api/save", { name }),
  load: (session: string, save: string) => postJSON("/api/load", { session, save, confirm: true }),
  deleteSave: (session: string, save: string) => postJSON("/api/delete-save", { session, save, confirm: true }),
  deleteSession: (session: string) => postJSON("/api/delete-session", { session, confirm: true }),
  command: (command: string) => postJSON("/api/command", { command }),
  shutdown: () => postJSON("/api/shutdown", { confirm: true }),
  service: (action: "start" | "restart" | "stop") => postJSON("/api/service", { action, confirm: true }),
  backup: (name: string) => postJSON<{ name: string; bytes: number; sha256: string }>("/api/backup", { name }),
  removeBackup: (name: string) => postJSON("/api/remove-backup", { name, confirm: true }),
};
