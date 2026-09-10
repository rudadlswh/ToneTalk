import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Small hook harness: execute event/effect logic without browser or new packages.
const harness = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[], refCursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = typeof next === "function" ? next(harness.values[index]) : next; }];
  },
  useRef: (initial: unknown) => harness.refs[harness.refCursor++] ??= { current: initial },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: (effect: () => void) => { harness.effects.push(effect); },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: null, showToast: vi.fn() }) }));
vi.mock("@/hooks/use-speech", () => ({ useSpeech: () => ({ speakingId: null, speechError: null, speak: vi.fn(), stop: vi.fn() }) }));
import { SavedWorkspace } from "@/components/saved-workspace";

const item = (id: string) => ({ id, sourceLanguage: "en", targetLanguage: "ja", tone: "casual", savedAt: "2026-09-10T00:00:00Z" });
function render() {
  harness.cursor = harness.refCursor = 0; harness.effects = [];
  return SavedWorkspace();
}
function buttons(node: unknown): (() => Promise<void>)[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(buttons);
  const props = (node as { props?: { "aria-label"?: string; onClick?: () => Promise<void>; children?: unknown } }).props;
  if (props?.["aria-label"] === "저장 문장 삭제") return [props.onClick!];
  return buttons(props?.children);
}
beforeEach(() => { harness.values = [[item("a"), item("b")], "", "", "", false, null, 0]; harness.refs = []; });
afterEach(() => vi.unstubAllGlobals());

it("does not restore the old list when one of two deletes fails", async () => {
  let fail!: (error: Error) => void;
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValueOnce(new Response(null, { status: 204 })));
  const [removeA, removeB] = buttons(render());
  const first = removeA(); await removeB();
  fail(new Error("offline")); await first;
  expect(harness.values[0]).toEqual([]);
  expect(harness.values[6]).toBe(2); // Both completions invalidate the current query.
});

it("ignores an aborted old filter result and hides a pending delete in fresh results", async () => {
  let finish!: (response: Response) => void;
  let oldResult!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { oldResult = resolve; }))
    .mockResolvedValueOnce(Response.json({ items: [item("a"), item("c")] }));
  vi.stubGlobal("fetch", fetcher);
  const pending = buttons(render())[0]();
  const cleanup = harness.effects[1]() as () => void;
  cleanup();
  harness.values[3] = "ja";
  render(); harness.effects[1]();
  await vi.waitFor(() => expect(harness.values[0]).toEqual([item("c")]));
  oldResult(Response.json({ items: [item("old")] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(harness.values[0]).toEqual([item("c")]);
  finish(new Response(null, { status: 204 })); await pending;
});
