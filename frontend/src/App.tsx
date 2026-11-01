import { motion } from "motion/react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { api, type Branding as BrandingData, type Overview as OverviewData } from "./api";
import { Layout, ROUTES, type RouteId } from "./components/Layout";
import { ConfirmHost, Loading, ToastHost } from "./components/ui";
import { useLive } from "./lib/useApi";

/* Route-level code splitting: each page is its own chunk, so the initial load
   only pays for the shell plus the page actually opened. */
const Overview = lazy(() => import("./pages/Overview"));
const History = lazy(() => import("./pages/History"));
const Saves = lazy(() => import("./pages/Saves"));
const Backups = lazy(() => import("./pages/Backups"));
const Config = lazy(() => import("./pages/Config"));
const Logs = lazy(() => import("./pages/Logs"));
const Branding = lazy(() => import("./pages/Branding"));
const About = lazy(() => import("./pages/About"));
const Credits = lazy(() => import("./pages/Credits"));

const TITLES: Record<RouteId, string> = {
  "/": "Overview",
  "/history": "Telemetry & activity",
  "/saves": "Sessions & saves",
  "/backups": "Backup vault",
  "/config": "Configuration",
  "/logs": "Server logs",
  "/branding": "Branding & logo",
  "/about": "About & ports",
  "/credits": "Credits & provenance",
};

const FALLBACK_BRANDING: BrandingData = {
  name: "Satisfactory Ops",
  tagline: "Pioneering efficiency beyond Earth, one conveyor at a time.",
  mark: "",
  accent: "#ff963e",
  logo: null,
};

function normalize(path: string): RouteId {
  return (ROUTES.includes(path as RouteId) ? path : "/") as RouteId;
}

/** Darken a #rrggbb colour for the secondary accent (borders, hover states). */
function shade(hex: string, factor = 0.78): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.round(v * factor)));
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export default function App() {
  const [route, setRoute] = useState<RouteId>(() => normalize(window.location.pathname));
  const [version, setVersion] = useState("…");
  const [branding, setBranding] = useState<BrandingData>(FALLBACK_BRANDING);
  const lastUpdate = useRef<number>(Date.now());
  const [ageSec, setAgeSec] = useState(0);

  // One streaming connection feeds the header status for every page.
  const { data: snapshot } = useLive<OverviewData>(api.overview, [], 5000);

  useEffect(() => {
    lastUpdate.current = Date.now();
    setAgeSec(0);
  }, [snapshot]);

  useEffect(() => {
    const onPop = () => setRoute(normalize(window.location.pathname));
    window.addEventListener("popstate", onPop);
    api.version().then((v) => setVersion(v.version)).catch(() => setVersion("?"));
    api.branding().then((b) => { setBranding(b); document.title = `Overview · ${b.name}`; }).catch(() => { /* keep defaults */ });
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The whole theme follows the configured accent colour.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent", branding.accent);
    root.style.setProperty("--color-accent2", shade(branding.accent));
  }, [branding.accent]);

  useEffect(() => {
    const id = setInterval(() => setAgeSec(Math.round((Date.now() - lastUpdate.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const go = (r: RouteId) => {
    if (r === route) return;
    window.history.pushState({}, "", r);
    setRoute(r);
    window.scrollTo({ top: 0 });
    document.title = `${TITLES[r]} · ${branding.name}`;
  };

  function renderPage() {
    switch (route) {
      case "/history": return <History />;
      case "/saves": return <Saves />;
      case "/backups": return <Backups />;
      case "/config": return <Config />;
      case "/logs": return <Logs />;
      case "/branding": return <Branding branding={branding} onSaved={setBranding} />;
      case "/about": return <About />;
      case "/credits": return <Credits />;
      default: return <Overview branding={branding} />;
    }
  }

  return (
    <ToastHost>
      <ConfirmHost>
        <Layout
          route={route}
          go={go}
          version={version}
          online={!!snapshot?.ok}
          health={snapshot?.health || "API offline"}
          session={snapshot?.state?.activeSessionName || ""}
          tick={ageSec}
          branding={branding}
        >
          {/* Keyed remount per route: the incoming page animates in. No
              AnimatePresence exit phase — with mode="wait" a stalled exit left
              the previous page mounted and the new route never appeared. */}
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <Suspense fallback={<Loading label="Loading page…" />}>{renderPage()}</Suspense>
          </motion.div>
        </Layout>
      </ConfirmHost>
    </ToastHost>
  );
}
