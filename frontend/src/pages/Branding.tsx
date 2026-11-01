import { ImageUp, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Branding as BrandingData } from "../api";
import ficsitMark from "../assets/ficsit-mark.png";
import { PageTitle } from "../components/Layout";
import { Button, Chip, ErrorBox, Loading, Panel, SectionHead, useToast } from "../components/ui";
import { useApi } from "../lib/useApi";

const MAX_LOGO = 512 * 1024;
const PRESETS = ["#ff963e", "#f2b134", "#56d6a0", "#5aa9f0", "#b48cf2", "#ff7c7c"];

export default function Branding({ branding, onSaved }: { branding: BrandingData; onSaved: (b: BrandingData) => void }) {
  const { data, loading, error } = useApi<BrandingData>(api.branding, []);
  const [name, setName] = useState(branding.name);
  const [tagline, setTagline] = useState(branding.tagline);
  const [mark, setMark] = useState(branding.mark);
  const [accent, setAccent] = useState(branding.accent);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [clearLogo, setClearLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();

  const saved = data ?? branding;

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setTagline(data.tagline);
    setMark(data.mark);
    setAccent(data.accent);
    setLogoDataUrl(null);
    setClearLogo(false);
  }, [data]);

  // What the tile will look like right now, including unsaved edits.
  const previewLogo = clearLogo ? null : logoDataUrl ?? (saved.logo ? "/api/logo" : null);
  const previewMark = clearLogo ? "" : mark;
  const dirty =
    name !== saved.name || tagline !== saved.tagline || mark !== saved.mark ||
    accent !== saved.accent || Boolean(logoDataUrl) || clearLogo;

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("err", "Choose an image file."); return; }
    if (file.size > MAX_LOGO) { toast("err", `Logo must be smaller than ${MAX_LOGO / 1024} KiB.`); return; }
    const reader = new FileReader();
    reader.onload = () => { setLogoDataUrl(String(reader.result)); setClearLogo(false); };
    reader.onerror = () => toast("err", "Could not read that file.");
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { name, tagline, mark, accent };
      if (logoDataUrl) payload.logoDataUrl = logoDataUrl;
      if (clearLogo) payload.clearLogo = true;
      const result = await api.saveBranding(payload as never);
      onSaved(result);
      setLogoDataUrl(null);
      setClearLogo(false);
      toast("ok", "Branding saved.");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;

  const field = "w-full rounded-md border border-edge2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent";

  return (
    <>
      <PageTitle title="Branding & logo" note="Name, tagline, accent colour and logo for this console. Saved on the server and applied everywhere." />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div>
          <Panel glow={false} className="mb-5">
            <SectionHead title="Identity" hint="The name appears in the header and sidebar; the tagline appears on the overview hero." />
            <label className="mb-1 block text-[12px] text-muted">Console name</label>
            <input className={field} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Satisfactory Ops" />
            <label className="mb-1 mt-4 block text-[12px] text-muted">Tagline</label>
            <input className={field} value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} placeholder="Pioneering efficiency beyond Earth, one conveyor at a time." />
            <label className="mb-1 mt-4 block text-[12px] text-muted">Text mark <span className="text-muted/70">(optional, up to 3 characters — used only when no image logo is set)</span></label>
            <input className={`${field} !w-24 text-center font-black uppercase`} value={mark} maxLength={3} onChange={(e) => setMark(e.target.value)} placeholder="VF" />
          </Panel>

          <Panel glow={false} className="mb-5">
            <SectionHead title="Logo" hint="Shown on the brand tile. Without a custom logo the FICSIT emblem placeholder is used." />
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden" onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <Button variant="primary" onClick={() => fileRef.current?.click()}>
                <span className="inline-flex items-center gap-1.5"><ImageUp size={13} /> Upload logo</span>
              </Button>
              <Button variant={clearLogo ? "primary" : "default"} onClick={() => { setClearLogo(true); setLogoDataUrl(null); toast("info", "Will restore the FICSIT placeholder on save."); }}>
                <span className="inline-flex items-center gap-1.5"><RotateCcw size={12} /> Use FICSIT placeholder</span>
              </Button>
              {logoDataUrl && (
                <Button variant="danger" onClick={() => setLogoDataUrl(null)}>
                  <span className="inline-flex items-center gap-1.5"><Trash2 size={12} /> Discard upload</span>
                </Button>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              PNG, JPEG, WebP, GIF or SVG, up to {MAX_LOGO / 1024} KiB. Raster art reads best on the tile —
              simple marks on a transparent background look sharpest. The mark is never parsed as a page.
            </p>
          </Panel>

          <Panel glow={false}>
            <SectionHead title="Accent colour" hint="Recolours the whole console: tiles, buttons, charts and highlights." />
            <div className="flex flex-wrap items-center gap-3">
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-10 w-16 cursor-pointer rounded border border-edge2 bg-bg" />
              <input className={`${field} !w-32 font-mono`} value={accent} maxLength={7} onChange={(e) => setAccent(e.target.value)} />
              <div className="flex gap-1.5">
                {PRESETS.map((c) => (
                  <button
                    key={c} onClick={() => setAccent(c)} title={c}
                    className="h-7 w-7 rounded-full border border-edge2"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            {mark.length === 0 && !logoDataUrl && !saved.logo && (
              <p className="mt-3 text-[11px] text-muted">No custom logo — the FICSIT emblem placeholder is in use.</p>
            )}
          </Panel>
        </div>

        <div>
          <Panel glow={false} className="sticky top-4">
            <SectionHead title="Preview" hint="How the header tile will look." />
            <div className="flex items-center gap-2.5 rounded-md border border-edge bg-[#10141b] px-4 py-3">
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded" style={{ background: accent || "#ff963e" }}>
                {previewLogo ? (
                  <img src={previewLogo} alt="" className="h-6 w-6 object-contain" />
                ) : previewMark ? (
                  <span className="font-black leading-none" style={{ fontSize: 13, color: "#12141a" }}>{previewMark}</span>
                ) : (
                  <img src={ficsitMark} alt="" className="h-6 w-6 object-contain" />
                )}
              </span>
              <span className="text-[14px] font-extrabold uppercase tracking-[0.08em]">
                {name.trim().split(/\s+/).map((w, i, all) => (
                  <span key={i} className={i === all.length - 1 ? "text-accent" : ""} style={i === all.length - 1 ? { color: accent } : undefined}>{w}{i < all.length - 1 ? " " : ""}</span>
                ))}
              </span>
            </div>
            {tagline && <p className="mt-3 text-[12px] text-muted">{tagline}</p>}
            {dirty && <div className="mt-3"><Chip tone="warn">UNSAVED CHANGES</Chip></div>}
            <div className="mt-4">
              <Button variant="primary" disabled={busy || !dirty || !name.trim()} onClick={save}>
                <span className="inline-flex items-center gap-1.5"><Save size={13} /> {busy ? "Saving…" : "Save branding"}</span>
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
