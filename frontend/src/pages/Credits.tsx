import { ExternalLink } from "lucide-react";
import { api, type CreditsData } from "../api";
import { PageTitle } from "../components/Layout";
import { ErrorBox, KV, Loading, Panel, SectionHead } from "../components/ui";
import { useApi } from "../lib/useApi";

export default function Credits() {
  const { data, error, loading } = useApi<CreditsData>(api.credits, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;
  const d = data as CreditsData;

  return (
    <>
      <PageTitle title="Credits & provenance" note="Every upstream is pinned to a revision and credited. Reuse is stated honestly, including where no license file exists." />

      <Panel glow={false} className="mb-5">
        <SectionHead title="Built on community work" />
        <p className="text-[13px] leading-relaxed text-muted">
          This console runs on the vanilla dedicated-server HTTPS API. No FRM, SML or other game mod is installed,
          and nothing is required of players. Where community work is reused it is credited below with a pinned revision.
        </p>
        {d.note && <p className="mt-3 text-[12px] text-muted">{d.note}</p>}
      </Panel>

      {(d.projects || []).map((p) => (
        <Panel key={p.name} glow={false} className="mb-4">
          <h3 className="text-[14px] font-semibold">
            <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              {p.name} <ExternalLink size={12} />
            </a>
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{p.use}</p>
          <div className="mt-2">
            <KV k="Pinned revision" v={<span className="font-mono text-[11px]">{p.revision}</span>} />
            <KV k="License" v={p.licenseName} />
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-accent">License / provenance detail</summary>
            <pre className="mt-2 max-h-[50vh] overflow-auto rounded-md border border-edge bg-bg p-4 font-mono text-[11px] whitespace-pre-wrap break-words">{p.license}</pre>
          </details>
        </Panel>
      ))}

      <Panel glow={false}>
        <SectionHead title="Deliberately not included" />
        <p className="text-[12.5px] leading-relaxed text-muted">
          Factory production, power, map, inventories, vehicles and named player telemetry require game-mod APIs (FRM)
          and remain unavailable here. Windows PowerShell operations and third-party automatic restart/update/prune
          policies are not imported. No mod is installed and no player is asked to install one.
        </p>
      </Panel>
    </>
  );
}
