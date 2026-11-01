import { Download, Save as SaveIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, type BackupsData } from "../api";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, Gauge, Loading, Panel, SectionHead, useConfirm, useToast } from "../components/ui";
import { fmtBytes } from "../lib/format";
import { useApi } from "../lib/useApi";

export default function Backups() {
  const { data, error, loading, refresh } = useApi<BackupsData>(api.backups, [], 10000);
  const confirm = useConfirm();
  const toast = useToast();
  const [snapName, setSnapName] = useState("");
  const [snapping, setSnapping] = useState(false);

  async function snapshot(name: string) {
    if (snapping) return;
    setSnapping(true);
    try {
      const r = await api.backup(name);
      toast("ok", `Snapshot created · ${r.sha256?.slice(0, 12) ?? "ok"}`);
      setSnapName("");
      refresh();
    } catch (e) { toast("err", e instanceof Error ? e.message : String(e)); }
    finally { setSnapping(false); }
  }

  async function remove(name: string) {
    const ok = await confirm({
      title: "Remove this snapshot?",
      body: `“${name}” will be deleted from the local backup vault. The original save is not touched. Continue?`,
      danger: true, confirmLabel: "Remove snapshot",
    });
    if (!ok) return;
    try { await api.removeBackup(name); toast("ok", `Removed “${name}”.`); refresh(); }
    catch (e) { toast("err", e instanceof Error ? e.message : String(e)); }
  }

  return (
    <>
      <PageTitle title="Backup vault" note="Manual snapshots only. No automatic pruning. Original saves are never modified." />

      <Panel glow={false} className="mb-5">
        <SectionHead title="Create snapshot" hint="Backs up an existing save file from disk by its save name, without starting an in-game save." />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={snapName} onChange={(e) => setSnapName(e.target.value)}
            placeholder="Save file name, e.g. 2026-11-01T02_00_00_000Z.sav"
            className="min-w-[240px] flex-1 rounded-md border border-edge2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const n = snapName.trim(); if (n) snapshot(n); } }}
          />
          <Button variant="primary" disabled={!snapName.trim() || snapping} onClick={() => snapshot(snapName.trim())}>
            <span className="inline-flex items-center gap-1.5"><SaveIcon size={13} /> {snapping ? "Creating…" : "Create snapshot"}</span>
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Tip: the Sessions &amp; saves page can list every save file name, or use the <b>Snapshot</b> button beside a save to create one without typing the name here.
        </p>
      </Panel>

      {loading && !data && <Loading />}
      {error && !data && <ErrorBox message={error} />}
      {data && (
        <>
          <Panel glow={false} className="mb-5">
            <SectionHead title="Archive capacity" hint={data.policy} />
            <Gauge value={data.totalBytes} max={data.maxBytes} label="Local backup storage" color="purple" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip>{data.files.length} / {data.maxFiles} files</Chip>
              <Chip>{fmtBytes(data.totalBytes)} / {fmtBytes(data.maxBytes)}</Chip>
              <Chip>per-file limit {fmtBytes(data.maxFileBytes)}</Chip>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Snapshots are local copies, not off-host disaster recovery. Download important archives.
              Concurrently changing saves are rejected; this is not a forced in-game save.
            </p>
          </Panel>

          <Panel glow={false}>
            <SectionHead title="Snapshots" hint="Archives stored in the local vault." />
            {!data.files.length ? (
              <p className="text-sm text-muted">No snapshots yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="text-muted">
                      {["Archive", "Size", "Created", "Actions"].map((h) => (
                        <th key={h} className="border-b border-edge px-2 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.files.map((f) => (
                      <tr key={f.name} className="hover:bg-panel2/50">
                        <td className="border-b border-edge/60 px-2 py-2 break-all">{f.name}</td>
                        <td className="border-b border-edge/60 px-2 py-2 whitespace-nowrap">{fmtBytes(f.bytes)}</td>
                        <td className="border-b border-edge/60 px-2 py-2 whitespace-nowrap">{new Date(f.modified * 1000).toLocaleString()}</td>
                        <td className="border-b border-edge/60 px-2 py-2">
                          <div className="flex gap-1.5">
                            <a href={`/api/download-backup?name=${encodeURIComponent(f.name)}`} className="inline-flex items-center gap-1 rounded-md border border-edge2 bg-panel2 px-3 py-1.5 text-[12px] text-ink hover:border-accent hover:text-accent">
                              <Download size={12} /> Download
                            </a>
                            <Button variant="danger" onClick={() => remove(f.name)}>
                              <span className="inline-flex items-center gap-1"><Trash2 size={12} /> Remove…</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
