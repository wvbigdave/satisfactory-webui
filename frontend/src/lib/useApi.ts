import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch a resource, exposing loading/error/refetch and a polling interval.
    Keeps the previous data visible while refreshing so the UI never blanks. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => { if (alive) await run(); })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(run, pollMs);
    return () => clearInterval(id);
  }, [pollMs, run]);

  const refresh = useCallback(() => { run(); setTick((t) => t + 1); }, [run]);
  return { data, error, loading, refresh, tick, setData };
}

/** Live data via Server-Sent Events, falling back to polling if the stream
 *  cannot be established or drops. Same shape as useApi, so callers do not
 *  need to care which transport is active. */
export function useLive<T>(fetcher: () => Promise<T>, deps: unknown[] = [], fallbackMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const fnRef = useRef(fetcher);
  fnRef.current = fetcher;

  const pull = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;

    const startPolling = () => {
      if (poll || !alive) return;
      setLive(false);
      poll = setInterval(pull, fallbackMs);
    };

    pull();
    if (typeof EventSource !== "undefined") {
      try {
        source = new EventSource("/api/stream");
        source.addEventListener("overview", (ev) => {
          if (!alive) return;
          try {
            setData(JSON.parse((ev as MessageEvent).data) as T);
            setError(null);
            setLive(true);
            if (poll) { clearInterval(poll); poll = null; }
          } catch { /* malformed frame: the next one will land */ }
        });
        source.onerror = () => { startPolling(); };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      alive = false;
      source?.close();
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, live, refresh: pull, tick: 0 };
}
