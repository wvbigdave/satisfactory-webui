import { Pause, Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type LogsData } from "../api";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, Loading, Panel, SectionHead } from "../components/ui";
import { useApi } from "../lib/useApi";

export default function Logs() {
  const [live, setLive] = useState(true);
  const [q, setQ] = useState("");
  const { data, error, loading } = useApi<LogsData>(api.logs, [], live ? 5000 : 0);

  const lines = useMemo(() => {
    const text = data?.text || "";
    const all = text.split("\n");
    const filtered = q ? all.filter((l) => l.toLowerCase().includes(q.toLowerCase())) : all;
    return filtered.slice(-600);
  }, [data, q]);

  return (
    <>
      <PageTitle title="Server logs" note="Tail of the dedicated server journal. Read-only." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-md border border-edge2 bg-bg px-3 py-1.5">
          <Search size={13} className="text-muted" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Filter lines…"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted"
          />
        </div>
        <Button variant={live ? "primary" : "default"} onClick={() => setLive((v) => !v)}>
          <span className="inline-flex items-center gap-1.5">{live ? <Pause size={12} /> : <Play size={12} />} {live ? "Live" : "Paused"}</span>
        </Button>
        <Chip>{lines.length} lines{q ? " (filtered)" : ""}</Chip>
      </div>

      {loading && !data && <Loading />}
      {error && !data && <ErrorBox message={error} />}
      {data && (
        <Panel glow={false}>
          <SectionHead title="journalctl · satisfactory.service" hint={live ? "Refreshing every 5s" : "Paused"} />
          <pre className="max-h-[68vh] overflow-auto rounded-md border border-edge bg-bg p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words">
            {lines.join("\n") || "(no matching lines)"}
          </pre>
        </Panel>
      )}
    </>
  );
}
