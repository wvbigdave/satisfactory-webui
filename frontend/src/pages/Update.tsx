import { useState } from "react";
import { RefreshCw, ShieldAlert, TerminalSquare } from "lucide-react";
import { api, type UpdateData } from "../api";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, KV, Loading, Panel, SectionHead, useConfirm, useToast } from "../components/ui";
import { useApi } from "../lib/useApi";

const BRANCH_LABEL: Record<string, string> = {
  public: "Public release",
  experimental: "Experimental",
};

export default function Update() {
  const { data, error, loading, refresh } = useApi<UpdateData>(api.update, [], 2000);
  const confirm = useConfirm();
  const toast = useToast();
  const [branch, setBranch] = useState("public");
  const [validate, setValidate] = useState(false);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;
  const d = data as UpdateData;
  const { installed, available, job, logTail, branches } = d;
  const running = job.running;
  const latest = available.byBranch[branch];
  const installedId = installed.steamBuildId;

  async function doCheck() {
    setChecking(true);
    try {
      await api.updateCheck();
      toast("info", "Update check started — result appears when steamcmd resolves the latest build.");
      setTimeout(refresh, 1500);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  async function doUpdate() {
    const ok = await confirm({
      title: "Update the Satisfactory server?",
      body: `This stops the game service, downloads the ${BRANCH_LABEL[branch] ?? branch} build, then restarts it (validate ${validate ? "on" : "off"}). Players are disconnected while the server is down. The console's own service is never restarted. Continue?`,
      confirmLabel: "Update & restart",
      danger: true,
    });
    if (!ok) return;
    setStarting(true);
    try {
      await api.updateStart(branch, validate);
      toast("ok", "Update started — live progress below.");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
      setTimeout(refresh, 1200);
    }
  }

  return (
    <>
      <PageTitle title="Update server" note="Check for a newer Satisfactory build on Steam and apply it in one place. Updates publish through SteamCMD as the service account." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel glow={false}>
          <SectionHead title="Installed" hint="Read from the Steam manifest on disk, never guessed." />
          <KV k="Game version" v={installed.gameVersion || <Chip tone="warn">unknown</Chip>} />
          <KV k="Game changelist (CL)" v={installed.changelist || "—"} />
          <KV k="Steam build ID" v={installedId || <Chip tone="warn">unknown</Chip>} />
        </Panel>

        <Panel glow={false}>
          <SectionHead title="Latest available" hint="Resolves public + experimental build IDs via steamcmd app_info (info-only, no download)." right={
            <Button variant="ghost" disabled={checking || running} onClick={doCheck}>
              <RefreshCw size={12} className={checking ? "animate-spin" : ""} /> {checking ? "Checking…" : "Check for updates"}
            </Button>
          } />
          <KV k="Public build ID" v={available.byBranch.public ? <Chip tone={latest && installedId && available.byBranch.public !== installedId ? "warn" : "ok"}>{available.byBranch.public}</Chip> : "—"} />
          <KV k="Experimental" v={available.byBranch.experimental ? available.byBranch.experimental : "—"} />
          <KV k="Last checked" v={available.checkedAt ? new Date(available.checkedAt * 1000).toLocaleString() : "never"} />
          {available.error && <p className="mt-2 text-[11px] text-warn">{available.error}</p>}
          {latest && installedId && latest !== installedId ? (
            <p className="mt-3"><Chip tone="warn">UPDATE AVAILABLE</Chip></p>
          ) : latest && installedId ? (
            <p className="mt-3"><Chip tone="ok">UP TO DATE</Chip></p>
          ) : (
            <p className="mt-3 text-[11px] text-muted">{!installedId ? "Installed build is unknown; update status cannot be determined." : "Run an update check to compare the selected branch against the installed build."}</p>
          )}
        </Panel>
      </div>

      <Panel glow={false} className="mt-5">
        <SectionHead title="Apply an update" hint="Stops the game, runs SteamCMD app_update for the chosen branch, then restarts the game on success." />
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-[11px] text-muted">Branch</p>
            <div className="flex gap-2">
              {branches.map((b) => (
                <button
                  key={b}
                  onClick={() => setBranch(b)}
                  className={[
                    "rounded-md border px-3 py-1.5 text-[12px] transition",
                    branch === b ? "border-accent bg-accent/10 text-accent" : "border-edge2 bg-panel2 text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {BRANCH_LABEL[b] ?? b}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} disabled={running} />
            Validate installed files
          </label>
          <div className="ml-auto">
            <Button variant="danger" disabled={running || starting} onClick={doUpdate}>
              <ShieldAlert size={13} /> {running || starting ? "Working…" : "Update & restart"}
            </Button>
          </div>
        </div>
        {running && <p className="mt-3"><Chip tone="warn">A job is running — other controls are disabled.</Chip></p>}
        {job.error && <p className="mt-3 text-[11px] text-warn">Last job failed: {job.error}</p>}
      </Panel>

      <Panel glow={false} className="mt-5">
        <SectionHead title="Live output" hint="Bounded output from the current or most recent job." />
        <pre className="max-h-[360px] overflow-auto rounded-md border border-edge bg-bg p-4 font-mono text-[11.5px] whitespace-pre-wrap">
          <span className="flex items-center gap-1.5 text-muted"><TerminalSquare size={12} /> steamcmd · last 400 lines</span>
          {"\n"}{logTail.length ? logTail.join("\n") : "No update activity yet."}
        </pre>
      </Panel>
    </>
  );
}
