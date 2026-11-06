import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("CSRF recovery", () => {
  it("refreshes a stale token and retries only the rejected write", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ csrf: "old" }))
      .mockResolvedValueOnce(json({ code: "invalid_csrf", error: "invalid CSRF token" }, 403))
      .mockResolvedValueOnce(json({ csrf: "new" }))
      .mockResolvedValueOnce(json({ saved: "world" }));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await api.saveNow("world");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][1].headers["X-CSRF-Token"]).toBe("new");
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ name: "world", confirm: true });
  });

  it.each(["host rejected", "network rejected"])("never retries %s", async (error) => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ csrf: "token" }))
      .mockResolvedValueOnce(json({ error }, 403));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await expect(api.saveNow("world")).rejects.toThrow(error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not replay a write on a network failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ csrf: "token" }))
      .mockRejectedValueOnce(new Error("connection lost"));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await expect(api.saveNow("world")).rejects.toThrow("connection lost");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries CSRF rejection at most once", async () => {
    const fetch = vi.fn().mockImplementation((path: string) => Promise.resolve(
      path === "/api/session" ? json({ csrf: "token" }) : json({ code: "invalid_csrf" }, 403)));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await expect(api.saveNow("world")).rejects.toThrow("403");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
