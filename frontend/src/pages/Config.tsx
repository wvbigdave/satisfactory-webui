import { RotateCcw, Save, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type ConfigData, type FieldSpec } from "../api";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, Loading, Panel, SectionHead, useConfirm, useToast } from "../components/ui";
import { useApi } from "../lib/useApi";

function fieldMatches(name: string, spec: FieldSpec, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    name.toLowerCase().includes(needle) ||
    (spec.label || "").toLowerCase().includes(needle) ||
    (spec.help || "").toLowerCase().includes(needle)
  );
}

function Field({
  name, spec, value, onChange, dirty,
}: { name: string; spec: FieldSpec; value: string; onChange: (v: string) => void; dirty: boolean }) {
  const label = spec.label || name;
  const common = "w-full rounded-md border border-edge2 bg-bg px-2.5 py-1.5 text-[12px] outline-none focus:border-accent";
  return (
    <div className="py-3 border-b border-edge/50 last:border-0" title={spec.help}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[13px] text-ink">{label}</label>
        {dirty && <Chip tone="warn">CHANGED</Chip>}
      </div>
      {spec.help && <p className="mt-0.5 text-[11px] leading-snug text-muted">{spec.help}</p>}
      <div className="mt-1.5">
        {spec.kind === "bool" ? (
          <select className={common} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="True">Enabled</option>
            <option value="False">Disabled</option>
          </select>
        ) : spec.kind === "int" || spec.kind === "float" ? (
          <input
            type="number" className={common} value={value}
            min={spec.min} max={spec.max} step={spec.kind === "float" ? (spec.step ?? 1) : 1}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input type="text" className={common} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    </div>
  );
}

export default function Config() {
  const { data, error, loading, refresh } = useApi<ConfigData>(api.config, []);
  const [server, setServer] = useState<Record<string, string>>({});
  const [adv, setAdv] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (data) { setServer({ ...data.serverOptions }); setAdv({ ...data.advanced }); }
  }, [data]);

  const serverDirty = useMemo(() => {
    if (!data) return [];
    return Object.keys(server).filter((k) => server[k] !== data.serverOptions[k]);
  }, [server, data]);
  const advDirty = useMemo(() => {
    if (!data) return [];
    return Object.keys(adv).filter((k) => adv[k] !== data.advanced[k]);
  }, [adv, data]);

  const serverEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.serverFields || {}).filter(([name, spec]) => fieldMatches(name, spec, q));
  }, [data, q]);
  const advEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.advancedFields || {}).filter(([name, spec]) => fieldMatches(name, spec, q));
  }, [data, q]);
  const matches = serverEntries.length + advEntries.length;

  async function apply(kind: "server" | "advanced") {
    const changes = kind === "server" ? serverDirty : advDirty;
    if (!changes.length) { toast("info", "No changes to apply."); return; }
    const ok = await confirm({
      title: `Apply ${changes.length} ${kind === "server" ? "server option" : "advanced setting"}${changes.length === 1 ? "" : "s"}?`,
      body: "Some options only take effect after a server restart. This writes configuration through the vanilla API and does not restart the server. Continue?",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = Object.fromEntries(changes.map((k) => [k, kind === "server" ? server[k] : adv[k]]));
      if (kind === "server") await api.applyOptions(updated); else await api.applyAdvanced(updated);
      toast("ok", `Applied ${changes.length} change${changes.length === 1 ? "" : "s"}.`);
      refresh();
    } catch (e) { toast("err", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function reset() {
    if (data) { setServer({ ...data.serverOptions }); setAdv({ ...data.advanced }); toast("info", "Reverted unsaved edits."); }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;
  const d = data as ConfigData;

  const pending = Object.keys(d.pendingServerOptions || {});

  return (
    <>
      <PageTitle title="Configuration" note="Server options and advanced game settings. Writes go through the vanilla API; some take effect only after a restart." />

      {pending.length > 0 && (
        <Panel glow={false} className="mb-4 !border-warn/40">
          <p className="text-[12px] text-warn">
            {pending.length} option{pending.length === 1 ? "" : "s"} pending a restart: {pending.join(", ")}. Apply the change, then restart the server to take effect.
          </p>
        </Panel>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || (!serverDirty.length && !advDirty.length)} onClick={() => apply("server")}>
          <span className="inline-flex items-center gap-1.5"><Save size={13} /> Apply server options ({serverDirty.length})</span>
        </Button>
        <Button variant="primary" disabled={busy || !advDirty.length} onClick={() => apply("advanced")}>
          <span className="inline-flex items-center gap-1.5"><Save size={13} /> Apply advanced ({advDirty.length})</span>
        </Button>
        <Button variant="ghost" onClick={reset}><span className="inline-flex items-center gap-1.5"><RotateCcw size={12} /> Revert edits</span></Button>
        <Chip tone={d.creativeModeEnabled ? "warn" : "muted"}>creative mode: {String(d.creativeModeEnabled)}</Chip>
      </div>

      <div className="mb-4 flex min-w-[240px] flex-1 items-center gap-2 rounded-md border border-edge2 bg-bg px-3 py-1.5">
        <SearchX size={13} className="text-muted" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Find an option… (matches name, label or help)"
          aria-label="Filter configuration options"
          className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted"
        />
        {q && <Chip tone="muted">{matches} match{matches === 1 ? "" : "es"}</Chip>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel glow={false}>
          <SectionHead title="Server options" hint="Applies to the dedicated server runtime." />
          {serverEntries.map(([name, spec]) => (
            <Field key={name} name={name} spec={spec} value={server[name] ?? ""} dirty={serverDirty.includes(name)} onChange={(v) => setServer((s) => ({ ...s, [name]: v }))} />
          ))}
          {!serverEntries.length && <p className="py-3 text-[12px] text-muted">{q ? "No server options match this filter." : "No server options returned by the API."}</p>}
        </Panel>

        <Panel glow={false}>
          <SectionHead title="Advanced game settings" hint="These can significantly change gameplay. Apply with care." />
          {advEntries.map(([name, spec]) => (
            <Field key={name} name={name} spec={spec} value={adv[name] ?? ""} dirty={advDirty.includes(name)} onChange={(v) => setAdv((s) => ({ ...s, [name]: v }))} />
          ))}
          {!advEntries.length && <p className="py-3 text-[12px] text-muted">{q ? "No advanced settings match this filter." : "No advanced settings returned by the API."}</p>}
        </Panel>
      </div>

      {q && matches === 0 && (
        <p className="mt-4 text-center text-[12px] text-muted">No configuration fields match “{q}”.</p>
      )}
    </>
  );
}
