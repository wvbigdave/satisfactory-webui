import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import Saves from "./Saves";

const { confirm, saveNow } = vi.hoisted(() => ({ confirm: vi.fn(), saveNow: vi.fn() }));
vi.mock("../api", () => ({ api: { saveNow } }));
vi.mock("../lib/useApi", () => ({ useApi: () => ({ data: { sessions: [] }, loading: false, error: null, refresh: () => {} }) }));
vi.mock("../components/ui", async (original) => ({
  ...await original<typeof import("../components/ui")>(),
  useConfirm: () => confirm,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.clearAllMocks(); });

it.each([false, true])("requires confirmation before saving (accepted=%s)", async (accepted) => {
  confirm.mockResolvedValue(accepted);
  saveNow.mockResolvedValue({ saved: "world" });
  let root!: ReturnType<typeof create>;
  await act(async () => { root = create(<Saves />); });
  try {
    await act(async () => root.root.findByType("input").props.onChange({ target: { value: "world" } }));
    const button = root.root.findAllByType("button").find((node) => node.props.variant === undefined && node.props.onClick?.name === "saveNow");
    expect(button).toBeDefined();
    await act(async () => button!.props.onClick());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("overwritten") }));
    expect(saveNow).toHaveBeenCalledTimes(accepted ? 1 : 0);
  } finally { await act(async () => root.unmount()); }
});
