import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, type Overview as OverviewData } from "./api";
import { Layout, ROUTES, type RouteId } from "./components/Layout";
import { ConfirmHost, ToastHost } from "./components/ui";
import About from "./pages/About";
import Backups from "./pages/Backups";
import Config from "./pages/Config";
import Credits from "./pages/Credits";
import History from "./pages/History";
import Logs from "./pages/Logs";
import Overview from "./pages/Overview";
import Saves from "./pages/Saves";

const TITLES: Record<RouteId, string> = {
  "/": "Overview",
  "/history": "Telemetry & activity",
  "/saves": "Sessions & saves",
  "/backups": "Backup vault",
  "/config": "Configuration",
  "/logs": "Server logs",
  "/about": "About & ports",
  "/credits": "Credits & provenance",
};

function normalize(path: string): RouteId {
  return (ROUTES.includes(path as RouteId) ? path : "/") as RouteId;
}

export default function App() {
  const [route, setRoute] = useState<RouteId>(() => normalize(window.location.pathname));
  const [version, setVersion] = useState("…");
  const [snapshot, setSnapshot] = useState<OverviewData | null>(null);
  const lastUpdate = useRef<number>(Date.now());
  const [ageSec, setAgeSec] = useState(0);

  useEffect(() => {
    const onPop = () => setRoute(normalize(window.location.pathname));
    window.addEventListener("popstate", onPop);
    api.version().then((v) => setVersion(v.version)).catch(() => setVersion("?"));
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // One global poll powers the header status and the command palette context.
  useEffect(() => {
    let alive = true;
    const load = () => api.overview().then((o) => { if (alive) { setSnapshot(o); lastUpdate.current = Date.now(); } }).catch(() => { if (alive) setSnapshot(null); });
    load();
    const id = setInterval(load, 5000);
    const age = setInterval(() => setAgeSec(Math.round((Date.now() - lastUpdate.current) / 1000)), 1000);
    return () => { alive = false; clearInterval(id); clearInterval(age); };
  }, []);

  const go = (r: RouteId) => {
    if (r === route) return;
    window.history.pushState({}, "", r);
    setRoute(r);
    window.scrollTo({ top: 0 });
    document.title = `${TITLES[r]} · Satisfactory Ops`;
  };

  const Page = { "/": Overview, "/history": History, "/saves": Saves, "/backups": Backups, "/config": Config, "/logs": Logs, "/about": About, "/credits": Credits }[route];

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
        >
          {/* Keyed remount per route: animates the incoming page in.
              Deliberately no AnimatePresence exit phase — with mode="wait" a
              stalled exit leaves the previous page mounted and the new route
              never appears (verified in-browser). */}
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <Page />
          </motion.div>
        </Layout>
      </ConfirmHost>
    </ToastHost>
  );
}
