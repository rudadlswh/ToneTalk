import { afterEach, beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, effects: [] as (() => () => void)[] }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++, values = harness.values;
    if (!(index in values)) values[index] = initial;
    return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
  },
  useRef: (initial: unknown) => harness.refs[harness.refCursor++] ??= { current: initial },
  useEffect: (effect: () => () => void) => { harness.effects.push(effect); },
}));
import { useStudyPoints } from "@/hooks/use-study-points";
import { readQueuedPoints, saveQueuedPoint } from "@/lib/study-point-outbox";
import { practiceDay } from "@/lib/study-practice";

const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
let activeUser = a, serverUser = a;
const Hook = () => useStudyPoints(activeUser);
function render() {
  harness.cursor = harness.refCursor = 0; harness.effects = [];
  return Hook();
}
let cleanup: (() => void) | undefined;
function mount(userId = a) {
  cleanup?.();
  harness.values = []; harness.refs = []; activeUser = userId;
  const hook = render(); cleanup = harness.effects[0]();
  return hook;
}
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
};
const post = vi.fn<(init: RequestInit) => Promise<Response>>();
const session = vi.fn<() => Promise<Response>>();
const summary = vi.fn<() => Promise<Response>>();
let storage: Storage;
let browser: EventTarget & { localStorage: Storage; location: { replace: ReturnType<typeof vi.fn> } };
let network: { onLine: boolean };
const queue = (userId = a) => readQueuedPoints(userId, storage).entries;
const entry = (activityId: string) => ({ input: { eventId: crypto.randomUUID(), activity: "quiz" as const, activityId }, day: practiceDay() });
const confirmed = (totalPoints = 20, awarded = true) => Response.json({ awarded, points: awarded ? 20 : 0, totalPoints });

beforeEach(() => {
  cleanup = undefined; serverUser = a;
  const values = new Map<string, string>();
  storage = {
    get length() { return values.size; }, clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  browser = Object.assign(new EventTarget(), { localStorage: storage, location: { replace: vi.fn() } });
  network = { onLine: true };
  vi.stubGlobal("window", browser); vi.stubGlobal("navigator", network);
  post.mockReset().mockImplementation(async () => confirmed());
  session.mockReset().mockImplementation(async () => Response.json({ user: { id: serverUser } }));
  summary.mockReset().mockImplementation(async () => Response.json({ totalPoints: 0, items: [], nextCursor: null }));
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/auth/session") return session();
    if (init?.method === "POST") return post(init);
    return summary();
  }));
});
afterEach(() => { cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("persists before sending, deduplicates clicks and ignores stale summary responses", async () => {
  const initial = deferred(), reply = deferred();
  summary.mockReturnValueOnce(initial.promise);
  post.mockImplementationOnce(async () => { expect(queue()).toHaveLength(1); return reply.promise; });
  const points = mount();
  points.award("quiz", "q1"); points.award("quiz", "q1");
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(render().totalPoints).toBeNull();
  expect(post.mock.calls[0][0].headers).toMatchObject({ "x-tonetalk-account": a });
  reply.resolve(confirmed());
  await vi.waitFor(() => expect(render().totalPoints).toBe(20));
  initial.resolve(Response.json({ totalPoints: 0 }));
  await vi.waitFor(() => expect(render().loadError).toBe(""));
  expect(render().totalPoints).toBe(20); expect(queue()).toEqual([]);
  expect(render().notice).toContain("저장했어요");
});

it("survives offline reload and replays the exact event ID automatically", async () => {
  network.onLine = false;
  mount().award("quiz", "q1");
  expect(render().failed).toBe(1); expect(post).not.toHaveBeenCalled();
  const saved = queue()[0];
  network.onLine = true;
  mount();
  await vi.waitFor(() => expect(render().totalPoints).toBe(20));
  expect(JSON.parse(post.mock.calls[0][0].body as string)).toEqual(saved.input);
  expect(queue()).toEqual([]);
});

it("retains a committed award whose reply was lost and retries idempotently after midnight", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T14:59:59Z"));
  const ledger = new Set<string>();
  post.mockImplementation(async (init) => {
    const { eventId } = JSON.parse(init.body as string);
    if (ledger.has(eventId)) return confirmed(20, false);
    ledger.add(eventId);
    throw new Error("response lost");
  });
  mount().award("quiz", "q1");
  await vi.waitFor(() => expect(render().failed).toBe(1));
  const saved = queue()[0];
  expect(render().totalPoints).toBe(0);
  vi.setSystemTime(new Date("2026-09-15T15:00:01Z"));
  mount();
  await vi.waitFor(() => expect(queue()).toEqual([]));
  expect(ledger.size).toBe(1);
  expect(JSON.parse(post.mock.calls[1][0].body as string)).toEqual(saved.input);
  expect(render().notice).toContain("이미 적립");
});

it("retries on reconnect and focus without parallel flushes or optimistic points", async () => {
  post.mockRejectedValueOnce(new Error("offline"));
  mount().award("quiz", "q1");
  await vi.waitFor(() => expect(render().failed).toBe(1));
  expect(render().totalPoints).toBe(0);
  const reply = deferred(); post.mockReturnValueOnce(reply.promise);
  browser.dispatchEvent(new Event("online"));
  browser.dispatchEvent(new Event("focus")); render().retry();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  reply.resolve(confirmed());
  await vi.waitFor(() => expect(queue()).toEqual([]));
  expect(render().failed).toBe(0);
});

it("reads only the current account's queue and leaves the other account untouched", async () => {
  saveQueuedPoint(a, entry("a-question"), storage);
  saveQueuedPoint(b, entry("b-question"), storage);
  serverUser = b; mount(b);
  await vi.waitFor(() => expect(queue(b)).toEqual([]));
  expect(queue(a)).toHaveLength(1);
  expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.parse(post.mock.calls[0][0].body as string).activityId).toBe("b-question");
  expect(post.mock.calls[0][0].headers).toMatchObject({ "x-tonetalk-account": b });
});
it("preserves unverifiable legacy requests without endless replay or blocking valid acknowledgements", async () => {
  const old = entry("unverified"), saved = entry("committed");
  saveQueuedPoint(a, old, storage); saveQueuedPoint(a, saved, storage);
  post.mockResolvedValueOnce(Response.json({ error: { code: "POINTS_PROOF_REQUIRED", message: "확인 불가" } }, { status: 409 }))
    .mockResolvedValueOnce(confirmed(20, false));
  mount();
  await vi.waitFor(() => expect(render().unverified).toBe(1));
  await vi.waitFor(() => expect(queue()).toHaveLength(1));
  expect(queue()[0].input.eventId).toBe(old.input.eventId);
  browser.dispatchEvent(new Event("focus")); render().retry();
  await vi.waitFor(() => expect(render().pending).toBe(0));
  expect(post).toHaveBeenCalledTimes(2);
  expect(render().totalPoints).toBe(20); expect(render().failed).toBe(0);
});

it("does not replay an old page's queue after another account logs in", async () => {
  saveQueuedPoint(a, entry("q1"), storage);
  serverUser = b; mount(a);
  await vi.waitFor(() => expect(render().saveError).toContain("학습한 계정"));
  expect(post).not.toHaveBeenCalled(); expect(queue(a)).toHaveLength(1);
  serverUser = a; mount(a);
  await vi.waitFor(() => expect(queue(a)).toEqual([]));
});

it("retains the queue on expired sessions and on account-switch races rejected by the server", async () => {
  saveQueuedPoint(a, entry("q1"), storage);
  session.mockResolvedValueOnce(Response.json({ error: { message: "expired" } }, { status: 401 }));
  mount();
  await vi.waitFor(() => expect(browser.location.replace).toHaveBeenCalledWith("/login"));
  expect(queue()).toHaveLength(1); expect(post).not.toHaveBeenCalled();
  post.mockResolvedValueOnce(Response.json({ error: { code: "ACCOUNT_CHANGED", message: "학습한 계정으로 로그인" } }, { status: 403 }));
  mount();
  await vi.waitFor(() => expect(render().saveError).toContain("학습한 계정"));
  expect(queue()).toHaveLength(1);
});

it("respects Retry-After and preserves requests through server errors or malformed successes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T01:00:00Z"));
  post.mockResolvedValueOnce(Response.json({ error: { message: "잠시 후 재시도" } }, { status: 429, headers: { "Retry-After": "60" } }));
  mount().award("quiz", "q1");
  await vi.waitFor(() => expect(render().failed).toBe(1));
  render().retry(); browser.dispatchEvent(new Event("online"));
  expect(post).toHaveBeenCalledTimes(1); expect(queue()).toHaveLength(1);
  render().award("quiz", "q2");
  expect(render().pending).toBe(0); expect(render().failed).toBe(2);
  vi.setSystemTime(new Date("2026-09-15T01:01:01Z"));
  post.mockResolvedValueOnce(Response.json({})); render().retry();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(render().failed).toBe(2));
  expect(queue()).toHaveLength(2);
  render().retry();
  await vi.waitFor(() => expect(queue()).toEqual([]));
});

it("warns when browser persistence fails, retaining the live award for manual retry", async () => {
  const put = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
  post.mockRejectedValueOnce(new Error("offline"));
  mount().award("quiz", "q1");
  await vi.waitFor(() => expect(render().failed).toBe(1));
  expect(render().storageError).toContain("브라우저 보관");
  const body = post.mock.calls[0][0].body;
  put.mockRestore(); render().retry();
  await vi.waitFor(() => expect(render().totalPoints).toBe(20));
  expect(post.mock.calls[1][0].body).toBe(body);
});

it("cleans up listeners but lets a late reply acknowledge only its own event", async () => {
  const reply = deferred(); post.mockReturnValueOnce(reply.promise);
  mount().award("quiz", "q1");
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  cleanup?.();
  saveQueuedPoint(b, entry("b-question"), storage);
  browser.dispatchEvent(new Event("online"));
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0].keepalive).toBe(true);
  reply.resolve(confirmed());
  await vi.waitFor(() => expect(queue(a)).toEqual([]));
  expect(queue(b)).toHaveLength(1);
  expect(render().totalPoints).toBe(0);
});

it("replays independent tab entries without deleting siblings", async () => {
  const one = entry("tab-one"), two = entry("tab-two");
  saveQueuedPoint(a, one, storage); saveQueuedPoint(a, two, storage);
  const second = deferred(); post.mockReturnValueOnce(Promise.resolve(confirmed())).mockReturnValueOnce(second.promise);
  mount();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(queue()).toEqual([two]);
  second.resolve(confirmed(40));
  await vi.waitFor(() => expect(queue()).toEqual([]));
});

it("does not send malformed browser records, erase them or hide a storage read failure", async () => {
  storage.setItem("tonetalk:study-points:v1:" + a + ":broken", "{");
  mount();
  expect(render().storageError).toContain("읽을 수 없는");
  expect(post).not.toHaveBeenCalled(); expect(storage.length).toBe(1);
  vi.spyOn(storage, "key").mockImplementation(() => { throw new Error("SecurityError"); });
  mount();
  expect(render().storageError).toContain("브라우저 보관");
  expect(post).not.toHaveBeenCalled();
});
