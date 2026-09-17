import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const harness = vi.hoisted(() => ({
  states: {} as Record<string, unknown[]>, refs: {} as Record<string, { current: unknown }[]>,
  scope: "", cursor: 0, refCursor: 0, effects: [] as (() => unknown)[], refresh: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const values = harness.states[harness.scope] ??= [], index = harness.cursor++;
    if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
  },
  useRef: (initial: unknown) => (harness.refs[harness.scope] ??= [])[harness.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
}));
vi.mock("@/components/session-boundary", () => ({ useSessionUserId: () => "account-a" }));
vi.mock("@/hooks/use-study-points", () => ({ useStudyPoints: () => ({ totalPoints: 0, refresh: harness.refresh }) }));
vi.mock("@/components/study-workspace", () => ({ StudyWorkspace: () => null }));
import { StudyPracticeWorkspace } from "@/components/study-practice-workspace";
import { practiceTones } from "@/lib/study-practice";
import { MistakeReviewWorkspace } from "@/components/mistake-review-workspace";

type Element = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Element[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  const element = value as Element;
  return element.props ? [element, ...nodes(element.props.children)] : [];
}
function render(scope: string, component: () => ReactElement) {
  harness.scope = scope; harness.cursor = harness.refCursor = 0; harness.effects = [];
  return component();
}
function child(mode: "chat" | "quiz") {
  harness.states.root = [mode];
  const tree = render("root", StudyPracticeWorkspace);
  const component = nodes(tree).find(node => typeof node.type === "function" && node.type.name === (mode === "chat" ? "ChatPractice" : "PhrasePractice"))!;
  return () => render(mode, () => (component.type as (props: Record<string, unknown>) => ReactElement)(component.props));
}
function button(tree: ReactElement, label: string) {
  return nodes(tree).find(node => node.type === "button" && renderToStaticMarkup(node).includes(label))!;
}
function click(tree: ReactElement, label: string) { (button(tree, label).props.onClick as () => void)(); }
function enter(tree: ReactElement, text: string) { (nodes(tree).find(node => node.type === "textarea")!.props.onChange as (event: unknown) => void)({ target: { value: text } }); }
function send(tree: ReactElement) { (nodes(tree).find(node => node.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); }
const reply = { reply: "こんにちは。", feedback: "자연스러운 인사예요.", suggestion: "こんにちは。" };
beforeEach(() => { harness.states = {}; harness.refs = {}; harness.refresh.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

it("counts only confirmed chat responses and never posts a client XP claim", async () => {
  const sessionId = randomUUID();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ sessionId }));
  for (let turns = 1; turns <= 4; turns++) fetcher.mockResolvedValueOnce(Response.json({ sessionId, turns, replayed: false, response: reply, points: turns === 4 ? 35 : 0, totalPoints: turns === 4 ? 35 : 0 }));
  vi.stubGlobal("fetch", fetcher);
  const view = child("chat");
  for (let turns = 1; turns <= 4; turns++) {
    enter(view(), `message ${turns}`); send(view()); send(view()); // rapid duplicate submit
    await vi.waitFor(() => expect(renderToStaticMarkup(view())).toContain(`${turns}/4 완료`));
  }
  expect(renderToStaticMarkup(view())).toContain("대화 연습 완료!");
  expect(renderToStaticMarkup(view())).toContain("35 XP를 적립했어요.");
  expect(fetcher).toHaveBeenCalledTimes(5);
  for (const [url, init] of fetcher.mock.calls) {
    expect(url).toBe("/api/study/chat");
    expect(init.headers["x-tonetalk-account"]).toBe("account-a");
  }
  const last = JSON.parse(fetcher.mock.calls[4][1].body);
  expect(last.sessionId).toBe(sessionId); expect(last.messages).toHaveLength(7);
  expect(last).not.toHaveProperty("points"); expect(harness.refresh).toHaveBeenCalledTimes(4);
});

it.each([false, true])("does not claim new chat XP when the daily cap or a replay returns zero (replay=%s)", async replayed => {
  const sessionId = randomUUID();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ sessionId }));
  for (let turns = 1; turns <= 4; turns++) fetcher.mockResolvedValueOnce(Response.json({ sessionId, turns,
    replayed: turns === 4 && replayed, response: turns === 4 && replayed ? null : reply, points: 0, totalPoints: 35 }));
  vi.stubGlobal("fetch", fetcher);
  const view = child("chat");
  for (let turns = 1; turns <= 4; turns++) {
    enter(view(), `message ${turns}`); send(view());
    await vi.waitFor(() => expect(renderToStaticMarkup(view())).toContain(`${turns}/4 완료`));
  }
  const html = renderToStaticMarkup(view());
  expect(html).toContain("대화 연습 완료!");
  expect(html).toContain(replayed ? "적립 여부는 프로필의 적립 기록" : "오늘 채팅 포인트는 이미 받았어요");
  expect(html).not.toContain("35 XP를 적립했어요.");
});

it("retries the identical turn after a lost response without regenerating or assuming XP", async () => {
  const sessionId = randomUUID();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ sessionId }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ sessionId, turns: 1, replayed: true, response: null, points: 0, totalPoints: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const view = child("chat");
  enter(view(), "こんにちは。"); send(view());
  await vi.waitFor(() => expect(renderToStaticMarkup(view())).toContain("offline"));
  expect(nodes(view()).find(node => node.type === "textarea")!.props.disabled).toBe(true);
  send(view());
  await vi.waitFor(() => expect(renderToStaticMarkup(view())).toContain("답변을 복원할 수 없습니다"));
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
  expect(nodes(view()).some(node => node.type === "form")).toBe(false);
  expect(renderToStaticMarkup(view())).not.toContain("대화 연습 완료!");
  click(view(), "새 대화 시작");
  expect(renderToStaticMarkup(view())).toContain("0/4 완료");
});

it("ignores a late chat receipt after starting a new conversation", async () => {
  const sessionId = randomUUID();
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ sessionId })).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  const view = child("chat"); enter(view(), "hello"); send(view());
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  click(view(), "새 대화");
  resolve(Response.json({ sessionId, turns: 1, replayed: false, response: reply, points: 0, totalPoints: 0 }));
  await new Promise(done => setTimeout(done, 0));
  expect(renderToStaticMarkup(view())).toContain("0/4 완료");
  expect(renderToStaticMarkup(view())).not.toContain(reply.reply);
});

it("submits saved-phrase answers to the server and displays its frozen first result", async () => {
  const phrase = { id: randomUUID(), sourceText: "안녕", translatedText: "Hello friend!", targetLanguage: "en", tone: "casual", contextNote: "친근한 인사" };
  const set = { id: randomUUID(), day: 20710, kind: "quiz", source: "saved", phrases: [phrase], results: [] };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ practice: null })).mockResolvedValueOnce(Response.json(set))
    .mockImplementationOnce(async (_url, init) => Response.json({ result: { ...JSON.parse(init.body), outcome: "wrong", attemptNumber: 1 }, awarded: false, points: 0, totalPoints: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const view = child("quiz");
  click(view(), "내 저장 문장"); view();
  for (const effect of harness.effects) effect();
  await vi.waitFor(() => expect(button(view(), "연습 시작").props.disabled).toBe(false));
  click(view(), "연습 시작");
  await vi.waitFor(() => expect(nodes(view()).some(node => typeof node.type === "function" && node.type.name === "QuizQuestion")).toBe(true));
  const question = () => {
    const component = nodes(view()).find(node => typeof node.type === "function" && node.type.name === "QuizQuestion")!;
    return render("question", () => (component.type as (props: Record<string, unknown>) => ReactElement)(component.props));
  };
  const choices = nodes(question()).filter(node => node.type === "button");
  const wrong = choices.find(node => !renderToStaticMarkup(node).includes(practiceTones.casual.label))!;
  (wrong.props.onClick as () => void)();
  await vi.waitFor(() => expect(harness.refresh).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0][0]).toContain("source=saved");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).source).toBe("saved");
  expect(fetcher.mock.calls[2][1].method).toBe("PUT");
  expect(JSON.parse(fetcher.mock.calls[2][1].body).setId).toBe(set.id);
  expect(nodes(question()).filter(node => node.type === "button").slice(0, 4).every(node => node.props.disabled)).toBe(true);
  expect(renderToStaticMarkup(question())).toContain("이번 문제의 정답은");
  expect(fetcher.mock.calls.every(([url]) => !url.includes("/points"))).toBe(true);
});

const mistake = () => ({ setId: randomUUID(), day: 20700, kind: "quiz", source: "daily", questionIndex: 0,
  phrase: { id: randomUUID(), sourceText: "안녕", translatedText: "Hello friend!", targetLanguage: "en", tone: "casual", contextNote: "편안한 인사" },
  original: { eventId: randomUUID(), questionIndex: 0, answer: { type: "quiz", tone: "formal" }, outcome: "wrong", attemptNumber: 1 }, review: null,
});
const reviewView = () => render("mistakes", MistakeReviewWorkspace);
const runLoadEffect = () => { reviewView(); return harness.effects.at(-1)!() as () => void; };
it("reviews a stored mistake, retries the same unconfirmed answer and displays saved zero-XP feedback", async () => {
  const item = mistake(); let result: unknown;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [item], nextCursor: null }))
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockImplementationOnce(async (_url, init) => { result = { ...JSON.parse(init.body), outcome: "correct", attemptNumber: 1 }; return Response.json({ result, points: 0, replayed: true }); })
    .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  const cleanup = runLoadEffect();
  await vi.waitFor(() => expect(button(reviewView(), "다시 풀기")).toBeDefined());
  click(reviewView(), "다시 풀기");
  const question = () => nodes(reviewView()).find(node => typeof node.type === "function" && node.type.name === "QuizQuestion")!;
  const controls = question().props.daily as { locked: boolean; submit: (answer: unknown) => void; result?: unknown };
  controls.submit({ type: "quiz", tone: "casual" }); controls.submit({ type: "quiz", tone: "casual" });
  await vi.waitFor(() => expect(renderToStaticMarkup(reviewView())).toContain("connection lost"));
  expect((question().props.daily as { locked: boolean }).locked).toBe(true);
  click(reviewView(), "같은 답안 다시 저장");
  await vi.waitFor(() => expect(renderToStaticMarkup(reviewView())).toContain("결과 저장됨 · 추가 XP 0"));
  expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
  expect((question().props.daily as { result: unknown }).result).toMatchObject({ outcome: "correct" });
  expect(fetcher.mock.calls.every(([url]) => url.includes("/api/study/mistakes"))).toBe(true);
  click(reviewView(), "오답 목록으로"); cleanup(); const nextCleanup = runLoadEffect();
  await vi.waitFor(() => expect(renderToStaticMarkup(reviewView())).toContain("조건에 맞는 오답 기록이 없어요"));
  nextCleanup();
});
it("preserves loaded mistakes on page failure and retries the same page", async () => {
  const first = mistake(), second = { ...mistake(), phrase: { ...mistake().phrase, translatedText: "Another example." } };
  const cursor = `20700|${first.setId}|0`;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [first], nextCursor: cursor }))
    .mockRejectedValueOnce(new Error("page failed"))
    .mockResolvedValueOnce(Response.json({ items: [second], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher); let cleanup = runLoadEffect();
  await vi.waitFor(() => expect(button(reviewView(), "이전 오답 더 보기")).toBeDefined());
  click(reviewView(), "이전 오답 더 보기"); cleanup(); cleanup = runLoadEffect();
  await vi.waitFor(() => expect(renderToStaticMarkup(reviewView())).toContain("page failed"));
  expect(renderToStaticMarkup(reviewView())).toContain("Hello friend!");
  click(reviewView(), "다시 불러오기"); cleanup(); cleanup = runLoadEffect();
  await vi.waitFor(() => expect(renderToStaticMarkup(reviewView())).toContain("Another example."));
  expect(renderToStaticMarkup(reviewView())).toContain("Hello friend!");
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[2][0]); cleanup();
});
it("ignores a stale list response after changing filters", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
    .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher); let cleanup = runLoadEffect();
  const typeSelect = nodes(reviewView()).find(node => node.type === "select")!;
  (typeSelect.props.onChange as (event: unknown) => void)({ target: { value: "puzzle" } });
  cleanup(); cleanup = runLoadEffect();
  await vi.waitFor(() => expect(renderToStaticMarkup(reviewView())).toContain("조건에 맞는 오답 기록이 없어요"));
  resolve(Response.json({ items: [mistake()], nextCursor: null }));
  await new Promise(done => setTimeout(done, 0));
  expect(renderToStaticMarkup(reviewView())).not.toContain("Hello friend!");
  expect(fetcher.mock.calls[1][0]).toContain("kind=puzzle"); cleanup();
});
