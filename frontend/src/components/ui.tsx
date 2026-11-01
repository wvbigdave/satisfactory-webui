import { motion, useMotionValue, useSpring } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createContext, useContext } from "react";

/* ---------- MagicCard: cursor-following glow (ported from FRM Web UI) ---------- */
export function useMagic<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const onMouseMove = useCallback((e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
  return { ref, onMouseMove };
}

/* ---------- Panels ---------- */
export function Panel({
  children, className = "", magic = false, glow = true, shine = false, ...rest
}: {
  children: ReactNode; className?: string; magic?: boolean; glow?: boolean; shine?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { ref, onMouseMove } = useMagic<HTMLDivElement>();
  return (
    <div
      ref={magic ? ref : undefined}
      onMouseMove={magic ? onMouseMove : undefined}
      className={[
        "panel p-5",
        magic ? "magic" : "",
        glow ? "glow" : "",
        shine ? "shine" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionHead({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------- Animated number ---------- */
export function AnimatedNumber({ value, digits = 1, suffix = "" }: { value?: number | null; digits?: number; suffix?: string }) {
  const valid = typeof value === "number" && Number.isFinite(value);
  const mv = useMotionValue(valid ? (value as number) : 0);
  const spring = useSpring(mv, { stiffness: 90, damping: 20 });
  const [display, setDisplay] = useState("—");

  useEffect(() => { if (valid) mv.set(value as number); }, [value, valid, mv]);

  useEffect(() => {
    const paint = (v: number) => setDisplay(valid ? v.toFixed(digits) + suffix : "—");
    paint(spring.get());
    return spring.on("change", paint);
  }, [spring, valid, digits, suffix]);

  return <span>{display}</span>;
}

/* ---------- Gauge ---------- */
const GAUGE: Record<string, string> = { blue: "#5aa9f0", green: "#56d6a0", purple: "#b48cf2", orange: "#ff963e" };
export function Gauge({ value, max, label, color = "orange" }: { value?: number | null; max?: number | null; label: string; color?: keyof typeof GAUGE }) {
  const pct = value == null || max == null || max === 0 ? null : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[11px] text-muted mb-1">
        <span>{label}</span><b className="text-ink font-medium">{pct == null ? "Unknown" : `${pct.toFixed(1)}%`}</b>
      </div>
      <div className="h-1.5 rounded-full bg-edge overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: GAUGE[color] }}
          initial={{ width: 0 }}
          animate={{ width: `${pct ?? 0}%` }}
          transition={{ type: "spring", stiffness: 80, damping: 20 }}
        />
      </div>
    </div>
  );
}

/* ---------- Metric card ---------- */
export function Metric({ label, value, detail, color = "orange", n, max, digits = 1, suffix = "" }: {
  label: string; value?: number | null; detail: string; color?: keyof typeof GAUGE;
  n?: number | null; max?: number | null; digits?: number; suffix?: string;
}) {
  return (
    <Panel magic className="!p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="text-3xl font-semibold mt-1" style={{ color: GAUGE[color] }}>
        <AnimatedNumber value={value} digits={digits} suffix={suffix} />
      </p>
      <p className="text-[11px] text-muted mt-1 leading-snug">{detail}</p>
      {n != null && max != null && <Gauge value={n} max={max} label={`${label} capacity`} color={color} />}
    </Panel>
  );
}

/* ---------- Status pill ---------- */
export function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  const color = ok ? "#56d6a0" : "#ff7c7c";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap ${ok ? "" : "pulse"}`}
      style={{ color, borderColor: color }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "bad" | "accent" }) {
  const tones: Record<string, string> = { muted: "#93a0b1", ok: "#56d6a0", warn: "#edc76e", bad: "#ff7c7c", accent: "#ff963e" };
  return <span className="inline-block rounded border px-1.5 py-0.5 text-[10px] tracking-wide" style={{ color: tones[tone], borderColor: tones[tone] + "55" }}>{children}</span>;
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-edge/60 last:border-0 text-[13px]">
      <span className="text-muted">{k}</span>
      <span className="text-ink text-right break-all">{v}</span>
    </div>
  );
}

/* ---------- Buttons ---------- */
export function Button({
  children, onClick, variant = "default", disabled, type = "button", title,
}: {
  children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean; type?: "button" | "submit"; title?: string;
}) {
  const styles: Record<string, string> = {
    default: "border-edge2 bg-panel2 text-ink hover:border-accent hover:text-accent",
    primary: "border-accent2 bg-accent2/20 text-accent hover:bg-accent2/30",
    danger: "border-bad/50 bg-bad/10 text-bad hover:bg-bad/20",
    ghost: "border-transparent bg-transparent text-muted hover:text-ink",
  };
  return (
    <button
      type={type} title={title} onClick={onClick} disabled={disabled}
      className={`rounded-md border px-3 py-1.5 text-[12px] transition disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 5200);
  }, []);
  const color = { ok: "#56d6a0", err: "#ff7c7c", info: "#ff963e" };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="panel px-4 py-3 text-[12px] shadow-2xl"
            style={{ borderColor: color[t.kind] + "88" }}
          >
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: color[t.kind] }} />
            {t.text}
          </motion.div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Loading / error ---------- */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted text-sm py-10 justify-center">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge2 border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Panel glow={false} className="!border-bad/40">
      <p className="text-bad text-sm">{message}</p>
    </Panel>
  );
}

/* ---------- Confirmation dialog (explicit consent for destructive actions) ---------- */
type ConfirmReq = { title: string; body: string; confirmLabel?: string; danger?: boolean };
const ConfirmCtx = createContext<(req: ConfirmReq) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const ask = useCallback((r: ConfirmReq) => new Promise<boolean>((resolve) => {
    setReq(r);
    setResolver(() => resolve);
  }), []);

  const finish = (v: boolean) => { resolver?.(v); setReq(null); setResolver(null); };

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-4" onClick={() => finish(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="panel w-full max-w-md !p-5"
            style={req.danger ? { borderColor: "#ff7c7c88" } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold">{req.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{req.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => finish(false)}>Cancel</Button>
              <Button variant={req.danger ? "danger" : "primary"} onClick={() => finish(true)}>
                {req.confirmLabel || "Confirm"}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
