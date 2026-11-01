import { api, type AboutData } from "../api";
import { PageTitle } from "../components/Layout";
import { Chip, ErrorBox, KV, Loading, Panel, SectionHead } from "../components/ui";
import { useApi } from "../lib/useApi";

export default function About() {
  const { data, error, loading } = useApi<AboutData>(api.about, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;
  const d = data as AboutData;
  const sv = d.serverVersion || {};

  return (
    <>
      <PageTitle title="About & ports" note="Versions, bind, networks and listeners. Installed versions are read from disk — never guessed." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel glow={false}>
          <SectionHead title="Installed game server" hint="Read from the installed Steam manifest and runtime metadata." />
          <KV k="WebUI version" v={<Chip tone="accent">v{d.version}</Chip>} />
          <KV k="Game version" v={sv.gameVersion || <Chip tone="warn">unknown</Chip>} />
          <KV k="Game changelist (CL)" v={sv.changelist || "—"} />
          <KV k="Steam build ID" v={sv.steamBuildId || "—"} />
          <KV k="Manifest source" v={<span className="font-mono text-[11px]">{sv.steamSource || "—"}</span>} />
          <KV k="Game metadata source" v={<span className="font-mono text-[11px]">{sv.gameSource || "—"}</span>} />
          {sv.errors?.length ? <p className="mt-2 text-[11px] text-warn">{sv.errors.join("; ")}</p> : null}
        </Panel>

        <Panel glow={false}>
          <SectionHead title="Console binding" />
          <KV k="Bind address" v={d.bind} />
          <KV k="Port" v={d.port} />
          <KV k="Config directory" v={<span className="font-mono text-[11px]">{d.configDir}</span>} />
          <KV k="Service state" v={<Chip tone={d.service?.ActiveState === "active" ? "ok" : "warn"}>{d.service?.ActiveState || "unknown"}</Chip>} />
          <KV k="Service PID" v={d.service?.ExecMainPID || "—"} />
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-muted">Admitted networks</p>
            <div className="flex flex-wrap gap-1.5">{(d.networks || []).map((n) => <Chip key={n}>{n}</Chip>)}</div>
            <p className="mb-1.5 mt-3 text-[11px] text-muted">Allowed Host headers</p>
            <div className="flex flex-wrap gap-1.5">{(d.hosts || []).map((h) => <Chip key={h}>{h}</Chip>)}</div>
          </div>
        </Panel>
      </div>

      <Panel glow={false} className="mt-5">
        <SectionHead title="Listeners" hint="Ports bound by the game server on this host" />
        <pre className="overflow-auto rounded-md border border-edge bg-bg p-4 font-mono text-[11.5px] whitespace-pre-wrap">{d.listeners || "(none)"}</pre>
        <p className="mt-3 text-[11px] text-muted">
          Game traffic uses UDP/TCP 7777 plus TCP 8888 for reliable messaging. This console is LAN-only: do not expose it publicly without authentication and HTTPS.
        </p>
      </Panel>
    </>
  );
}
