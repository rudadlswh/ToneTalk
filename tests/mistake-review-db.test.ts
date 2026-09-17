import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mistakeListSchema, mistakeReceiptSchema } from "@/lib/mistake-review";
import { puzzleWords } from "@/lib/study-practice";
import type { DailyAnswer } from "@/lib/daily-ai-practice";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));

describe.skipIf(process.env.MISTAKE_REVIEW_DB_TEST !== "1")("mistake review with real DEV persistence", () => {
  const a = randomUUID(), b = randomUUID();
  let pool: typeof import("@/server/db").pool, route: typeof import("@/app/api/study/mistakes/route"), daily: typeof import("@/app/api/study/daily/route");
  const as = (id: string) => mocks.getUser.mockResolvedValue({ data: { user: { id, email: `${id}@example.invalid`, email_confirmed_at: "2026-01-01" } }, error: null });
  const request = (method: string, body?: unknown, query = "") => new Request(`https://app.test/api/study/mistakes${query}`, { method, headers: { origin: "https://app.test" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const list = async (query = "") => { const response = await route.GET(request("GET", undefined, query)); expect(response.status).toBe(200); return mistakeListSchema.parse(await response.json()); };
  const submit = (setId: string, answer: DailyAnswer, eventId = randomUUID(), questionIndex = 0) => route.POST(request("POST", { setId, answer, eventId, questionIndex }));
  const phrase = (index = 0) => ({ id: randomUUID(), sourceText: `예문 ${index}`, translatedText: "Hello my friend!", targetLanguage: "en", tone: index % 2 ? "polite" : "casual", contextNote: "편안한 인사" });
  const seed = async (owner = a, kind = "quiz", source = "daily", day = 20700, text?: string) => {
    const id = randomUUID(), phrases = Array.from({ length: source === "daily" ? 5 : 1 }, (_, i) => ({ ...phrase(i), ...(text ? { translatedText: text, targetLanguage: "ja" } : {}) }));
    await pool.query("insert into tonetalk_dev.daily_practice_sets(id,owner_id,day,kind,source,phrases,generation_expires_at) values($1,$2,$3,$4,$5,$6,now())", [id, owner, day, kind, source, JSON.stringify(phrases)]);
    return { id, phrases };
  };
  const original = async (setId: string, outcome = "wrong", questionIndex = 0, attempt = 1, answer: DailyAnswer = { type: "quiz", tone: "formal" }) => {
    await pool.query("insert into tonetalk_dev.daily_practice_answers(id,set_id,question_index,attempt_number,answer,outcome) values($1,$2,$3,$4,$5,$6)", [randomUUID(), setId, questionIndex, attempt, JSON.stringify(answer), outcome]);
  };
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit DEV required");
    pool = (await import("@/server/db")).pool; route = await import("@/app/api/study/mistakes/route"); daily = await import("@/app/api/study/daily/route");
  });
  beforeEach(async () => {
    (await import("@/server/rate-limit")).resetRateLimitsForTests();
    await pool.query("delete from tonetalk_dev.app_users where id=any($1::varchar[])", [[a, b]]);
    for (const id of [a, b]) await pool.query("insert into tonetalk_dev.app_users(id,display_name) values($1,'Review fixture')", [id]);
    as(a);
  });
  afterAll(async () => { if (pool) { await pool.query("delete from tonetalk_dev.app_users where id=any($1::varchar[])", [[a, b]]); await pool.end(); } });

  it("derives eligible questions once from both sources, filters tones/types and isolates accounts", async () => {
    const quiz = await seed(), puzzle = await seed(a, "puzzle", "saved"), other = await seed(b);
    await original(quiz.id); await original(quiz.id, "correct", 1); await original(quiz.id, "wrong", 3);
    await original(puzzle.id, "wrong", 0, 1, { type: "puzzle", order: [1, 0, 2] });
    await original(puzzle.id, "correct", 0, 2, { type: "puzzle", order: [0, 1, 2] });
    await original(other.id);
    expect((await list()).items).toHaveLength(3);
    expect((await list("?kind=puzzle")).items).toMatchObject([{ setId: puzzle.id, source: "saved", original: { outcome: "wrong" } }]);
    expect((await list("?kind=quiz&tone=polite")).items).toMatchObject([{ setId: quiz.id, questionIndex: 3 }]);
    expect((await submit(other.id, { type: "quiz", tone: "casual" })).status).toBe(404);
    expect((await submit(quiz.id, { type: "quiz", tone: "casual" }, randomUUID(), 2)).status).toBe(404);
    as(b); expect((await list()).items).toMatchObject([{ setId: other.id }]);
    expect((await submit(quiz.id, { type: "quiz", tone: "casual" })).status).toBe(404);
  });
  it("persists re-learning without changing first quiz choice, original XP or reveal restrictions", async () => {
    const quiz = await seed(), puzzle = await seed(a, "puzzle", "saved", 20700, "今日はいい天気です。");
    await original(quiz.id); await original(puzzle.id, "revealed", 0, 1, { type: "reveal" });
    await pool.query("insert into tonetalk_dev.study_point_events(id,owner_id,activity,activity_id,reward_day,points) values($1,$2,'quiz','old-proof',20700,20)", [randomUUID(), a]);
    const solved = mistakeReceiptSchema.parse(await (await submit(quiz.id, { type: "quiz", tone: "casual" })).json());
    expect(solved).toMatchObject({ result: { outcome: "correct", attemptNumber: 1 }, points: 0 });
    expect((await list("?status=resolved")).items).toMatchObject([{ setId: quiz.id, review: solved.result }]);
    expect((await list()).items.map(item => item.setId)).toEqual([puzzle.id]);
    const order = puzzleWords(puzzle.phrases[0].translatedText, "ja").map((_, i) => i);
    expect(mistakeReceiptSchema.parse(await (await submit(puzzle.id, { type: "puzzle", order })).json())).toMatchObject({ result: { outcome: "correct" }, points: 0 });
    const oldResult = await daily.PUT(new Request("https://app.test/api/study/daily", { method: "PUT", headers: { origin: "https://app.test" }, body: JSON.stringify({ setId: quiz.id, questionIndex: 0, eventId: randomUUID(), answer: { type: "quiz", tone: "casual" } }) }));
    expect(await oldResult.json()).toMatchObject({ result: { outcome: "wrong" }, points: 0, totalPoints: 20 });
    expect((await pool.query("select sum(points)::int total,count(*)::int n from tonetalk_dev.study_point_events where owner_id=$1", [a])).rows[0]).toEqual({ total: 20, n: 1 });
    expect((await pool.query("select outcome from tonetalk_dev.daily_practice_answers where set_id=$1", [puzzle.id])).rows).toEqual([{ outcome: "revealed" }]);
  });
  it("deduplicates lost/concurrent replies, refuses changed event payloads and records subsequent attempts", async () => {
    const set = await seed(); await original(set.id);
    const eventId = randomUUID(), answer: DailyAnswer = { type: "quiz", tone: "casual" };
    const responses = await Promise.all(Array.from({ length: 6 }, () => submit(set.id, answer, eventId)));
    expect(responses.every(response => response.status === 200)).toBe(true);
    const receipts = await Promise.all(responses.map(response => response.json()));
    expect(receipts.filter(value => !value.replayed)).toHaveLength(1);
    expect(receipts.every(value => value.result.attemptNumber === 1 && value.points === 0)).toBe(true);
    expect((await submit(set.id, { type: "quiz", tone: "formal" }, eventId)).status).toBe(409);
    const wrong = await (await submit(set.id, { type: "quiz", tone: "formal" })).json();
    expect(wrong.result).toMatchObject({ attemptNumber: 2, outcome: "wrong" });
    expect((await list()).items[0].review).toMatchObject({ attemptNumber: 2, outcome: "wrong" });
    const replay = await (await submit(set.id, answer, eventId)).json();
    expect(replay.result.attemptNumber).toBe(1);
    expect((await list()).items[0].review?.attemptNumber).toBe(2); // Replay cannot replace a newer result.
    const simultaneous = await Promise.all(Array.from({ length: 4 }, () => submit(set.id, answer)));
    expect((await Promise.all(simultaneous.map(response => response.json()))).map(value => value.result.attemptNumber).sort()).toEqual([3, 4, 5, 6]);
    expect((await pool.query("select count(*)::int n from tonetalk_dev.study_point_events where owner_id=$1", [a])).rows[0].n).toBe(0);
  });
  it("keeps failed/revealed review attempts pending, validates puzzle order and blocks invented results", async () => {
    const set = await seed(a, "puzzle"); await original(set.id, "wrong", 0, 1, { type: "puzzle", order: [1, 0, 2] });
    expect((await submit(set.id, { type: "puzzle", order: [0, 0] })).status).toBe(400);
    expect((await submit(set.id, { type: "quiz", tone: "casual" })).status).toBe(400);
    expect((await submit(randomUUID(), { type: "reveal" })).status).toBe(404);
    expect((await route.POST(request("POST", { setId: set.id, questionIndex: 0, eventId: randomUUID(), answer: { type: "reveal" }, points: 999 }))).status).toBe(400);
    await submit(set.id, { type: "reveal" });
    expect((await list()).items[0].review?.outcome).toBe("revealed");
    await submit(set.id, { type: "puzzle", order: [0, 1, 2] });
    expect((await list()).items).toEqual([]);
    expect((await list("?status=all")).items[0].review?.outcome).toBe("correct");
  });
  it("paginates beyond 20 questions without loss and hardens the additional table", async () => {
    for (let day = 20700; day < 20705; day++) { const set = await seed(a, "quiz", "daily", day); for (let i = 0; i < 5; i++) await original(set.id, "wrong", i); }
    const first = await list(); expect(first.items).toHaveLength(20); expect(first.nextCursor).not.toBeNull();
    const second = await list(`?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => `${item.setId}/${item.questionIndex}`)).size).toBe(25);
    as(b); expect((await list(`?cursor=${encodeURIComponent(first.nextCursor!)}`)).items).toEqual([]);
    const result = await pool.query("select relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_read,has_table_privilege('authenticated',c.oid,'INSERT') as user_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tonetalk_dev' and c.relname='mistake_review_answers'");
    expect(result.rows).toEqual([{ relrowsecurity: true, anon_read: false, user_write: false }]);
  });
});
