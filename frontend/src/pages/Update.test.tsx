import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { UpdateData } from "../api";
import Update from "./Update";

const { snapshot } = vi.hoisted(() => ({ snapshot: { current: {} as UpdateData } }));
vi.mock("../lib/useApi", () => ({ useApi: () => ({ data: snapshot.current, loading: false, error: null, refresh: () => {} }) }));

it.each([
  [null, { public: "123" }, false],
  ["123", {}, false],
  ["123", { public: "123" }, true],
  ["123", { public: "124" }, false],
])("only claims up to date when both build IDs are known and equal (%s)", (installed, branches, upToDate) => {
  snapshot.current = {
    installed: { steamBuildId: installed },
    available: { byBranch: branches, checkedAt: null },
    updateAvailable: false,
    branches: ["public", "experimental"],
    job: { running: false, mode: null, startedAt: null, finishedAt: null, exitCode: null, error: null },
    logTail: [], helper: "unused",
  };
  const html = renderToStaticMarkup(<Update />);
  expect(html.includes("UP TO DATE")).toBe(upToDate);
});
