import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useApi, useLive } from "./useApi";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReactTestRenderer | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("ignores old dependency results and stale failures", async () => {
  const old = deferred<string>();
  const current = deferred<string>();
  let state!: ReturnType<typeof useApi<string>>;
  function Probe({ id }: { id: number }) {
    state = useApi(() => id === 1 ? old.promise : current.promise, [id]);
    return null;
  }
  await act(async () => { root = create(<Probe id={1} />); });
  await act(async () => root!.update(<Probe id={2} />));
  await act(async () => current.resolve("new"));
  await act(async () => old.reject(new Error("stale failure")));
  expect(state.data).toBe("new");
  expect(state.error).toBeNull();
  expect(state.loading).toBe(false);
});

it("the latest refresh wins when requests overlap", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let state!: ReturnType<typeof useApi<string>>;
  function Probe() { state = useApi<string>(fetcher); return null; }
  await act(async () => { root = create(<Probe />); });
  await act(async () => state.refresh());
  await act(async () => second.resolve("second"));
  await act(async () => first.resolve("first"));
  expect(state.data).toBe("second");
});

it("a stream frame resolves loading and supersedes pending HTTP data", async () => {
  const pending = deferred<string>();
  let frame!: (event: { data: string }) => void;
  const close = vi.fn();
  vi.stubGlobal("EventSource", class {
    addEventListener(_name: string, listener: typeof frame) { frame = listener; }
    close = close;
  });
  let state!: ReturnType<typeof useLive<string>>;
  function Probe() { state = useLive(() => pending.promise); return null; }
  await act(async () => { root = create(<Probe />); });
  await act(async () => frame({ data: JSON.stringify("live") }));
  expect(state.loading).toBe(false);
  expect(state.live).toBe(true);
  await act(async () => pending.resolve("stale HTTP"));
  expect(state.data).toBe("live");
  await act(async () => root!.unmount());
  root = undefined;
  expect(close).toHaveBeenCalledOnce();
});

it("does not overlap automatic polls when the backend is slow", async () => {
  vi.useFakeTimers();
  const pending = deferred<string>();
  const fetcher = vi.fn().mockReturnValue(pending.promise);
  function Probe() { useApi(fetcher, [], 100); return null; }
  await act(async () => { root = create(<Probe />); });
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve("done"));
  await act(async () => { vi.advanceTimersByTime(100); });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
