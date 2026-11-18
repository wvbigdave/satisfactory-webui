import {
  Activity, Archive, BookOpen, Cog, FileText, Gauge, LayoutDashboard, Menu, Palette, RefreshCw, ScrollText, Search, Server, X,
} from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, type Branding, type SSO } from "../api";
import ficsitMark from "../assets/ficsit-mark.png";
import { StatusPill } from "./ui";

export type RouteId =
  | "/" | "/history" | "/saves" | "/backups" | "/config" | "/logs" | "/update" | "/branding" | "/about" | "/credits";

const NAV: { id: RouteId; label: string; icon: ReactNode; group: string }[] = [
  { id: "/", label: "Overview", icon: <LayoutDashboard size={17} />, group: "Command center" },
  { id: "/history", label: "Telemetry & activity", icon: <Activity size={17} />, group: "Command center" },
  { id: "/saves", label: "Sessions & saves", icon: <ScrollText size={17} />, group: "Operations" },
  { id: "/backups", label: "Backup vault", icon: <Archive size={17} />, group: "Operations" },
  { id: "/config", label: "Configuration", icon: <Cog size={17} />, group: "Operations" },
  { id: "/update", label: "Update server", icon: <RefreshCw size={17} />, group: "Operations" },
  { id: "/logs", label: "Server logs", icon: <FileText size={17} />, group: "Operations" },
  { id: "/branding", label: "Branding & logo", icon: <Palette size={17} />, group: "System" },
  { id: "/about", label: "About & ports", icon: <Server size={17} />, group: "System" },
  { id: "/credits", label: "Credits & provenance", icon: <BookOpen size={17} />, group: "System" },
];

/** The mark shown on the brand tile: an uploaded logo wins, then a text mark,
    otherwise the bundled FICSIT emblem placeholder. */
export function BrandMark({ branding, size = 24 }: { branding: Branding; size?: number }) {
  if (branding.logo) {
    return <img src="/api/logo" alt="" style={{ height: size, width: size }} className="object-contain" />;
  }
  if (branding.mark) {
    return <span className="font-black leading-none" style={{ fontSize: size * 0.55, color: "#12141a" }}>{branding.mark}</span>;
  }
  return <img src={ficsitMark} alt="" style={{ height: size, width: size }} className="object-contain" />;
}

function SSOChip() {
  const [sso, setSso] = useState<SSO | null>(null);
  useEffect(() => {
    api.sso().then(setSso).catch(() => setSso(null));
  }, []);
  if (!sso?.user) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-edge bg-panel2/70 px-2.5 py-1.5 text-[11px] text-muted">
      <span className="max-w-[160px] truncate font-semibold text-ink">{sso.user}</span>
      <span className="text-edge">|</span>
      {sso.logoutUrl && <a href={sso.logoutUrl} rel="noopener" className="hover:text-accent">Logout</a>}
    </div>
  );
}

function CommandPalette({ open, onClose, go }: { open: boolean; onClose: () => void; go: (r: RouteId) => void }) {
  const [q, setQ] = useState("");
  const items = useMemo(
    () => NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())),
    [q]
  );
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 pt-[12vh] px-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="panel w-full max-w-lg overflow-hidden !p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <Search size={15} className="text-muted" />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-auto p-2">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => { go(n.id); onClose(); }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] text-muted hover:bg-panel2 hover:text-ink"
            >
              {n.icon}{n.label}
            </button>
          ))}
          {!items.length && <p className="p-4 text-center text-xs text-muted">No matches.</p>}
        </div>
      </motion.div>
    </div>
  );
}

export function Layout({
  children, route, go, version, online, health, session, tick, branding,
}: {
  children: ReactNode; route: RouteId; go: (r: RouteId) => void;
  version: string; online: boolean; health: string; session: string; tick: number;
  branding: Branding;
}) {
  const [palette, setPalette] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
      if (e.key === "Escape") { setMobileOpen(false); setPalette(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  let lastGroup = "";
  const words = branding.name.trim().split(/\s+/);
  return (
    <div className="relative min-h-full">
      <div className="ambient" /><div className="ambient-grid" />

      <header className="relative z-10 flex h-[68px] items-center justify-between gap-4 border-b border-edge bg-[#10141b]/80 px-6 backdrop-blur">
        <button onClick={() => go("/")} className="flex items-center gap-2.5" title={branding.tagline || branding.name}>
          <span
            className="grid h-8 w-8 place-items-center overflow-hidden rounded"
            style={{ background: branding.accent }}
          >
            <BrandMark branding={branding} />
          </span>
          <span className="text-[14px] font-extrabold tracking-[0.08em] uppercase">
            {words.map((w, i) => (
              <span key={i} className={i === words.length - 1 ? "text-accent" : ""}>{w}{i < words.length - 1 ? " " : ""}</span>
            ))}
          </span>
        </button>
        <div className="hidden items-center gap-3 md:flex">
          <button
            onClick={() => setPalette(true)}
            className="flex items-center gap-2 rounded-md border border-edge bg-panel2/70 px-3 py-1.5 text-[11px] text-muted hover:border-accent hover:text-accent"
          >
            <Search size={12} /> Search <kbd className="rounded border border-edge px-1 text-[9px]">Ctrl K</kbd>
          </button>
          <StatusPill ok={online}>{online ? health || "Online" : "Server Offline"}</StatusPill>
          <SSOChip />
          <span className="text-[11px] text-muted">v{version}</span>
        </div>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-panel2/70 text-muted hover:border-accent hover:text-accent lg:hidden"
        >
          {mobileOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
      </header>

      {mobileOpen && (
        <motion.nav
          id="mobile-nav"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="absolute inset-x-0 top-[67px] z-20 border-b border-edge bg-[#10141b]/95 px-3 py-3 backdrop-blur lg:hidden"
          aria-label="Primary navigation"
        >
          {NAV.map((n) => {
            const head = n.group !== lastGroup ? n.group : null;
            lastGroup = n.group;
            const active = route === n.id;
            return (
              <div key={n.id}>
                {head && <p className="px-3 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-muted/80">{head}</p>}
                <button
                  onClick={() => { go(n.id); setMobileOpen(false); }}
                  className={[
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[13px] transition",
                    active ? "bg-accent/10 text-accent" : "text-[#b6c1d0] hover:bg-panel2 hover:text-ink",
                  ].join(" ")}
                >
                  {n.icon}{n.label}
                </button>
              </div>
            );
          })}
        </motion.nav>
      )}

      <div className="relative z-10 flex">
        <nav className="hidden w-[236px] shrink-0 border-r border-edge bg-[#10141b]/70 px-3 py-5 backdrop-blur lg:block">
          {NAV.map((n) => {
            const head = n.group !== lastGroup ? n.group : null;
            lastGroup = n.group;
            const active = route === n.id;
            return (
              <div key={n.id}>
                {head && <p className="px-3 pb-1 pt-4 text-[9px] font-bold uppercase tracking-[0.18em] text-muted/80">{head}</p>}
                <button
                  onClick={() => go(n.id)}
                  className={[
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition",
                    active ? "bg-accent/10 text-accent shadow-[inset_3px_0_var(--color-accent)]" : "text-[#b6c1d0] hover:bg-panel2 hover:text-ink",
                  ].join(" ")}
                >
                  {n.icon}{n.label}
                </button>
              </div>
            );
          })}
          <div className="mt-8 border-t border-edge px-3 pt-4 text-[11px] text-muted">
            <b className="text-ink">{branding.name}</b>
            <p className="mt-1.5 leading-relaxed">Live telemetry.<br />Explicit actions only.<br />No autonomous policies.</p>
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-5 py-7 md:px-8">
          <div className="mx-auto max-w-[1500px]">{children}</div>
        </main>
      </div>

      <footer className="relative z-10 border-t border-edge px-6 py-3 text-[11px] text-muted">
        Satisfactory WebUI · Private-network console · {session ? `session ${session} · ` : ""}refreshed {tick}s ago · LAN only
      </footer>

      <CommandPalette open={palette} onClose={() => setPalette(false)} go={go} />
    </div>
  );
}

export const ROUTES: RouteId[] = NAV.map((n) => n.id);
export const NAV_LABEL: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.id, n.label]));

export function PageTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
          <Gauge size={11} /> Dedicated server / operations
        </p>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </div>
    </div>
  );
}
