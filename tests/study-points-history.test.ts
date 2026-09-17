import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const harness = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, effects: [] as (() => () => void)[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = typeof next === "function" ? next(harness.values[index]) : next; }];
  },
  useRef: (initial: unknown) => harness.refs[harness.refCursor++] ??= { current: initial },
  useEffect: (effect: () => () => void) => { harness.effects.push(effect); },
}));
import { StudyPointsHistory } from "@/components/study-points-history";

function render() {
  harness.cursor = harness.refCursor = 0; harness.effects = [];
  return StudyPointsHistory();
}
function moreButton(node: unknown): (() => Promise<void>) | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.map(moreButton).find(Boolean);
  const props = (node as { props?: { onClick?: () => Promise<void>; children?: unknown } }).props;
  if (["이전 기록 더 보기", "다시 불러오기"].includes(String(props?.children))) return props?.onClick;
  return moreButton(props?.children);
}
let cleanup: (() => void) | undefined;
beforeEach(() => { harness.values = []; harness.refs = []; });
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
it("shows totals, activity, earned time and appends paginated history", async () => {
  const first = { id: "a", activity: "quiz", points: 20, createdAt: "2026-09-14T03:10:00.000Z" };
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ totalPoints: 45, items: [first], nextCursor: "next" }))
    .mockResolvedValueOnce(Response.json({ totalPoints: 45, items: [{ ...first, id: "b", activity: "puzzle", points: 25 }], nextCursor: null })));
  render(); cleanup = harness.effects[0]();
  await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain("45 XP"));
  expect(renderToStaticMarkup(render())).toContain("어투 뉘앙스 퀴즈 정답");
  expect(renderToStaticMarkup(render())).toContain('dateTime="2026-09-14T03:10:00.000Z"');
  moreButton(render())!();
  await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain("단어 나열 퍼즐 완성"));
  const html = renderToStaticMarkup(render());
  expect(html).toContain("어투 뉘앙스 퀴즈 정답"); expect(html).toContain("단어 나열 퍼즐 완성");
  expect(html).not.toContain("이전 기록 더 보기");
});
it("distinguishes empty history from a failed database request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ totalPoints: 0, items: [], nextCursor: null })));
  render(); cleanup = harness.effects[0]();
  await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain("아직 적립 기록이 없어요"));
  cleanup(); harness.values = []; harness.refs = [];
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("적립 기록을 불러오지 못했습니다.")));
  render(); cleanup = harness.effects[0]();
  await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain("다시 시도"));
  expect(renderToStaticMarkup(render())).not.toContain("아직 적립 기록이 없어요");
});
it("keeps already loaded records when the next page fails, then retries the same cursor", async () => {
  const page = { totalPoints: 20, items: [{ id: "a", activity: "quiz", points: 20, createdAt: "2026-09-14T03:00:00.000Z" }], nextCursor: "next" };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ totalPoints: 20, items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  render(); cleanup = harness.effects[0]();
  await vi.waitFor(() => expect(moreButton(render())).toBeDefined());
  moreButton(render())!();
  await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain("다시 불러오기"));
  expect(renderToStaticMarkup(render())).toContain("어투 뉘앙스 퀴즈 정답");
  expect(renderToStaticMarkup(render())).toContain("다시 불러오기");
  moreButton(render())!();
  await vi.waitFor(() => expect(renderToStaticMarkup(render())).not.toContain("다시 불러오기"));
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[2][0]);
});
