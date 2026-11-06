import { Download, HardDriveDownload, Save as SaveIcon, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { api, type SavesData } from "../api";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, Loading, Panel, SectionHead, useConfirm, useToast } from "../components/ui";
import { fmtDuration } from "../lib/format";
import { useApi } from "../lib/useApi";

export default function Saves() {
  const { data, error, loading, refresh } = useApi<SavesData>(api.saves, [], 8000);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  async function act(label: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(label);
    try { await fn(); toast("ok", okMsg); refresh(); }
    catch (e) { toast("err", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }

  async function saveNow() {
    const save = name.trim();
    const ok = await confirm({
      title: "Save the current world?",
      body: `Save as “${save}”. If this name already exists, it will be overwritten. Take a snapshot first if you need the previous version.`,
      danger: true, confirmLabel: "Save world",
    });
    if (ok) await act("save", () => api.saveNow(save), `Saved “${save}”.`);
  }

  async function load(session: string, save: string) {
    const ok = await confirm({
      title: "Load this save?",
      body: `Loading “${save}” replaces the running world in session “${session}”. The current world in memory is lost unless it was saved. Continue?`,
      danger: true, confirmLabel: "Load save",
    });
    if (ok) act(save, () => api.load(session, save), `Loading “${save}”…`);
  }

  async function del(session: string, save: string) {
    const ok = await confirm({
      title: "Delete this save file?",
      body: `“${save}” will be removed from disk. This cannot be undone. Take a backup snapshot first if unsure.`,
      danger: true, confirmLabel: "Delete file",
    });
    if (ok) act(save, () => api.deleteSave(session, save), `Deleted “${save}”.`);
  }

  async function snapshot(save: string) {
    act(save, async () => { const r = await api.backup(save); toast("ok", `Snapshot created · ${r.sha256?.slice(0, 12) ?? "ok"}`); }, "Snapshot created.");
  }

  return (
    <>
      <PageTitle title="Sessions & saves" note="Enumerate, save, load, download or delete world saves. Loads and deletes require confirmation." />

      <Panel glow={false} className="mb-5">
        <SectionHead title="Save now" hint="Creates a manual save in the active session via the vanilla API." />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Manual save name (e.g. before-big-build)"
            className="min-w-[240px] flex-1 rounded-md border border-edge2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <Button variant="primary" disabled={!name.trim() || busy === "save"} onClick={saveNow}>
            <span className="inline-flex items-center gap-1.5"><SaveIcon size={13} /> Save now</span>
          </Button>
        </div>
      </Panel>

      {loading && !data && <Loading />}
      {error && !data && <ErrorBox message={error} />}
      {data?.error && <ErrorBox message={data.error} />}

      {data?.sessions?.map((s) => (
        <Panel key={s.sessionName} glow={false} className="mb-4">
          <SectionHead
            title={s.sessionName}
            hint={`${s.saveHeaders.length} save${s.saveHeaders.length === 1 ? "" : "s"}`}
            right={<Chip tone="accent">{s.sessionName === data.latestSave?.name ? "active" : "session"}</Chip>}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-muted">
                  {["Save", "Playtime", "Saved at", "Flags", "Actions"].map((h) => (
                    <th key={h} className="border-b border-edge px-2 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.saveHeaders.map((h) => (
                  <tr key={h.saveName} className="hover:bg-panel2/50">
                    <td className="border-b border-edge/60 px-2 py-2 break-all">{h.saveName}</td>
                    <td className="border-b border-edge/60 px-2 py-2">{fmtDuration(h.playDurationSeconds)}</td>
                    <td className="border-b border-edge/60 px-2 py-2 whitespace-nowrap">{h.saveDateTime || "—"}</td>
                    <td className="border-b border-edge/60 px-2 py-2">
                      <span className="flex flex-wrap gap-1">
                        {h.isModdedSave && <Chip tone="warn">MODDED</Chip>}
                        {h.isEditedSave && <Chip tone="bad">EDITED</Chip>}
                        {h.isCreativeModeEnabled && <Chip tone="accent">CREATIVE</Chip>}
                        {!h.isModdedSave && !h.isEditedSave && !h.isCreativeModeEnabled && <Chip tone="ok">VANILLA</Chip>}
                      </span>
                    </td>
                    <td className="border-b border-edge/60 px-2 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <Button disabled={busy === h.saveName} onClick={() => load(s.sessionName, h.saveName)}>
                          <span className="inline-flex items-center gap-1"><Upload size={12} /> Load</span>
                        </Button>
                        <a href={`/api/download-save?name=${encodeURIComponent(h.saveName)}`} className="inline-flex items-center gap-1 rounded-md border border-edge2 bg-panel2 px-3 py-1.5 text-[12px] text-ink hover:border-accent hover:text-accent">
                          <Download size={12} /> Download
                        </a>
                        <Button onClick={() => snapshot(h.saveName)}>
                          <span className="inline-flex items-center gap-1"><HardDriveDownload size={12} /> Snapshot</span>
                        </Button>
                        <Button variant="danger" onClick={() => del(s.sessionName, h.saveName)}>
                          <span className="inline-flex items-center gap-1"><Trash2 size={12} /> Delete…</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      {data && !data.sessions?.length && <Panel glow={false}><p className="text-sm text-muted">No sessions returned by the API.</p></Panel>}
    </>
  );
}
