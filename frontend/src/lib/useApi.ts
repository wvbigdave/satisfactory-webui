import { useCallback, useEffect, useRef, useState } from "react";

/** Latest request wins; cleanup also invalidates in-flight completions. */
function useResource<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const active = useRef(false);
  const sequence = useRef(0);
  const run = useCallback(async () => {
    if (!active.current) return;
    const id = ++sequence.current;
    try {
      const result = await fnRef.current();
      if (active.current && id === sequence.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (active.current && id === sequence.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current && id === sequence.current) setLoading(false);
    }
  }, []);
  const accept = useCallback((value: T) => {
    if (!active.current) return;
    ++sequence.current; // A live frame supersedes any older HTTP request.
    setData(value);
    setError(null);
    setLoading(false);
  }, []);
  const begin = useCallback(() => { active.current = true; setLoading(true); }, []);
  const end = useCallback(() => { active.current = false; ++sequence.current; }, []);
  return { data, error, loading, setData, run, accept, begin, end };
}

/** Keep previous data visible while refreshing. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const { run, begin, end, ...state } = useResource(fn);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    begin();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      await run();
      if (!cancelled && pollMs) timer = setTimeout(poll, pollMs);
    };
    void poll();
    return () => { cancelled = true; end(); if (timer) clearTimeout(timer); };
    // Callers supply the resource identity explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, run, begin, end]);
  const refresh = useCallback(() => { void run(); setTick((t) => t + 1); }, [run]);
  return { data: state.data, error: state.error, loading: state.loading, setData: state.setData, refresh, tick };
}

/** SSE overview frames, with HTTP polling while disconnected. */
export function useLive<T>(fetcher: () => Promise<T>, deps: unknown[] = [], fallbackMs = 5000) {
  const { run, accept, begin, end, data, error, loading } = useResource(fetcher);
  const [live, setLive] = useState(false);
  useEffect(() => {
    begin();
    setLive(false);
    let alive = true;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let source: EventSource | null = null;
    const startPolling = () => {
      if (polling || !alive) return;
      polling = true;
      setLive(false);
      const pull = async () => {
        await run();
        if (polling && alive) poll = setTimeout(pull, fallbackMs);
      };
      poll = setTimeout(pull, fallbackMs);
    };
    void run();
    try {
      if (typeof EventSource === "undefined") startPolling();
      else {
        source = new EventSource("/api/stream");
        source.addEventListener("overview", (ev) => {
          if (!alive) return;
          try {
            accept(JSON.parse((ev as MessageEvent).data) as T);
            setLive(true);
            polling = false;
            if (poll) { clearTimeout(poll); poll = null; }
          } catch { /* Wait for the next valid frame. */ }
        });
        source.onerror = startPolling;
      }
    } catch { startPolling(); }
    return () => {
      alive = false;
      polling = false;
      end();
      source?.close();
      if (poll) clearTimeout(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, fallbackMs, run, accept, begin, end]);
  return { data, error, loading, live, refresh: run, tick: 0 };
}
