// Opt-in: real DEV persistence/API; only identity and AI output are stubbed.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyPracticeSchema, type DailyAnswer, type DailyPractice } from "@/lib/daily-ai-practice";
import { practiceDay, puzzleWords } from "@/lib/study-practice";
import { tones } from "@/lib/translation-contract";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), provider: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/server/ollama", () => ({ postOllama: mocks.provider }));
vi.mock("@/server/inference-limit", () => ({ InferenceBusyError: class extends Error {}, withInferenceSlot: (work: () => Promise<unknown>) => work() }));

describe.skipIf(process.env.DAILY_PRACTICE_DB_TEST !== "1")("daily practice persistence in tonetalk_dev", () => {
  const a = randomUUID(), b = randomUUID();
  let pool: typeof import("@/server/db").pool;
  let route: typeof import("@/app/api/study/daily/route");
  const as = (id: string) => mocks.getUser.mockResolvedValue({ data: { user: { id, email: `${id}@example.invalid`, email_confirmed_at: "2026-01-01" } }, error: null });
  const providerReply = (topic = "fresh") => Response.json({ message: { content: JSON.stringify({ phrases: tones.map(tone => ({
    sourceText: `${tone} 예문`, translatedText: `Please make a ${topic} ${tone} sentence.`, tone, contextNote: "테스트용 어투 해설",
  })) }) } });
  const req = (method: string, body?: unknown, kind = "quiz") => new Request(`https://app.test/api/study/daily?kind=${kind}`, {
    method, headers: { origin: "https://app.test" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const generate = async (kind = "quiz") => {
    const response = await route.POST(req("POST", { kind }));
    expect(response.status).toBe(200);
    return dailyPracticeSchema.parse(await response.json());
  };
  const get = async (kind = "quiz") => {
    const response = await route.GET(req("GET", undefined, kind));
    expect(response.status).toBe(200);
    return (await response.json()).practice as DailyPractice | null;
  };
  const answer = (set: DailyPractice, questionIndex: number, value: DailyAnswer, eventId = randomUUID()) => route.PUT(req("PUT", { eventId, setId: set.id, questionIndex, answer: value }));
  const correct = (set: DailyPractice, index = 0): DailyAnswer => set.kind === "quiz" ? { type: "quiz", tone: set.phrases[index].tone } : { type: "puzzle", order: puzzleWords(set.phrases[index].translatedText, "en").map((_, i) => i) };
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit tonetalk_dev required");
    pool = (await import("@/server/db")).pool;
    route = await import("@/app/api/study/daily/route");
  });
  beforeEach(async () => {
    (await import("@/server/rate-limit")).resetRateLimitsForTests();
    await pool.query("delete from tonetalk_dev.app_users where id = any($1::varchar[])", [[a, b]]);
    mocks.provider.mockReset().mockImplementation(async () => providerReply()); as(a);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    if (!pool) return;
    await pool.query("delete from tonetalk_dev.app_users where id = any($1::varchar[])", [[a, b]]);
    await pool.end();
  });
  it("generates one canonical set during concurrent requests and isolates account history", async () => {
    expect(await get()).toBeNull();
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    const entered = new Promise<void>(r => { started = r; });
    mocks.provider.mockImplementationOnce(async () => { started(); await waiting; return providerReply(); });
    const first = generate();
    await entered;
    try { expect((await route.POST(req("POST", { kind: "quiz" }))).status).toBe(409); }
    finally { release(); }
    const set = await first;
    expect(await generate()).toEqual(set);
    expect(await get()).toEqual(set); expect(mocks.provider).toHaveBeenCalledTimes(1);
    as(b); expect(await get()).toBeNull();
    expect((await answer(set, 0, correct(set))).status).toBe(404);
    const other = await generate(); expect(other.id).not.toBe(set.id);
    const body = mocks.provider.mock.calls.at(-1)![0];
    expect(JSON.parse(body.messages[1].content).excludedExamples).toEqual([]);
  });
  it("keeps the first quiz choice and atomically awards once under retries/concurrency", async () => {
    const set = await generate();
    const wrong: DailyAnswer = { type: "quiz", tone: tones.find(tone => tone !== set.phrases[0].tone)! };
    const first = await (await answer(set, 0, wrong)).json();
    expect(first).toMatchObject({ result: { outcome: "wrong", attemptNumber: 1 }, points: 0 });
    expect(await (await answer(set, 0, correct(set))).json()).toMatchObject({ result: first.result, points: 0 });
    const eventId = randomUUID();
    const replies = await Promise.all(Array.from({ length: 6 }, () => answer(set, 1, correct(set, 1), eventId)));
    expect(replies.map(r => r.status)).toEqual(Array(6).fill(200));
    const bodies = await Promise.all(replies.map(r => r.json()));
    expect(bodies.filter(r => r.awarded)).toHaveLength(1);
    expect(bodies.every(r => r.totalPoints === 20)).toBe(true);
    expect((await get())?.results).toHaveLength(2);
    expect((await pool.query("select count(*)::int as n from tonetalk_dev.daily_practice_answers where set_id=$1", [set.id])).rows[0].n).toBe(2);
    expect((await answer(set, 1, { type: "quiz", tone: set.phrases[0].tone }, eventId)).status).toBe(409);
  });
  it("stores puzzle attempts, restores wrong answers and never rewards revealed questions", async () => {
    const set = await generate("puzzle");
    const value = correct(set); if (value.type !== "puzzle") throw new Error("Expected puzzle");
    const wrong: DailyAnswer = { type: "puzzle", order: value.order.toReversed() };
    await answer(set, 0, wrong);
    expect((await get("puzzle"))?.results[0]).toMatchObject({ outcome: "wrong", answer: wrong, attemptNumber: 1 });
    expect(await (await answer(set, 0, value)).json()).toMatchObject({ result: { outcome: "correct", attemptNumber: 2 }, points: 25 });
    await answer(set, 1, { type: "reveal" });
    expect(await (await answer(set, 1, correct(set, 1))).json()).toMatchObject({ result: { outcome: "revealed", attemptNumber: 1 }, points: 0, totalPoints: 25 });
    expect((await answer(set, 2, { type: "puzzle", order: [0, 0] })).status).toBe(400);
    expect((await answer(set, 2, { type: "quiz", tone: "casual" })).status).toBe(400);
  });
  it("keeps the set day across midnight but caps different set days by actual credit date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-14T14:59:59Z"));
    const day = practiceDay();
    mocks.provider.mockImplementationOnce(async () => { vi.setSystemTime(new Date("2026-09-14T15:00:01Z")); return providerReply("yesterday"); });
    const yesterday = await generate(); expect(yesterday.day).toBe(day);
    expect(await get()).toBeNull();
    const today = await generate(); expect(today.day).toBe(day + 1); expect(today.id).not.toBe(yesterday.id);
    const payload = mocks.provider.mock.calls.at(-1)![0];
    expect(JSON.parse(payload.messages[1].content).excludedExamples).toEqual(yesterday.phrases.map(p => p.translatedText));
    await answer(yesterday, 0, correct(yesterday)); await answer(today, 0, correct(today));
    const rewards = await pool.query("select reward_day,points,credited_on=(now() at time zone 'Asia/Seoul')::date as today from tonetalk_dev.study_point_events where owner_id=$1", [a]);
    expect(rewards.rows).toEqual([{ reward_day: day, points: 20, today: true }]);
  });
  it("caps different questions and AI/saved sets together while preserving every answer and account isolation", async () => {
    const quiz = await generate(), saved = { ...quiz, id: randomUUID(), source: "saved" as const };
    await pool.query("insert into tonetalk_dev.daily_practice_sets(id,owner_id,day,kind,source,phrases,generation_expires_at) values($1,$2,$3,'quiz','saved',$4,now())",
      [saved.id, a, saved.day, JSON.stringify(saved.phrases.map(p => ({ ...p, id: `saved-${p.id}` })))]);
    const replies = await Promise.all([answer(quiz, 0, correct(quiz)), answer(quiz, 1, correct(quiz, 1)), answer(saved, 0, correct(saved)), answer(saved, 1, correct(saved, 1))]);
    expect(replies.map(r => r.status)).toEqual([200, 200, 200, 200]);
    const bodies = await Promise.all(replies.map(r => r.json()));
    expect(bodies.map(r => r.points).sort()).toEqual([0, 0, 0, 20]);
    expect(bodies.every(r => r.result.outcome === "correct" && r.totalPoints === 20)).toBe(true);
    expect((await pool.query("select count(*)::int n from tonetalk_dev.daily_practice_answers where set_id=any($1::varchar[])", [[quiz.id, saved.id]])).rows[0].n).toBe(4);
    mocks.provider.mockImplementationOnce(async () => providerReply("puzzle"));
    const puzzle = await generate("puzzle");
    expect(await (await answer(puzzle, 0, correct(puzzle))).json()).toMatchObject({ points: 25, totalPoints: 45 });
    expect(await (await answer(puzzle, 1, correct(puzzle, 1))).json()).toMatchObject({ points: 0, totalPoints: 45, result: { outcome: "correct" } });
    as(b); const other = await generate();
    expect(await (await answer(other, 0, correct(other))).json()).toMatchObject({ points: 20, totalPoints: 20 });
  });
  it("allows a new qualifying answer on a new credit date, never a replay of a completed question", async () => {
    const set = await generate();
    expect(await (await answer(set, 0, correct(set))).json()).toMatchObject({ points: 20 });
    // Move only this test account's receipt into yesterday; DB clock stays real.
    await pool.query("update tonetalk_dev.study_point_events set credited_on=credited_on-1,created_at=created_at-interval '1 day' where owner_id=$1", [a]);
    expect(await (await answer(set, 0, correct(set))).json()).toMatchObject({ points: 0, totalPoints: 20 });
    expect(await (await answer(set, 1, correct(set, 1))).json()).toMatchObject({ points: 20, totalPoints: 40 });
    expect(await (await answer(set, 2, correct(set, 2))).json()).toMatchObject({ points: 0, totalPoints: 40 });
  });
  it("releases a failed generation lease and rejects stale workers after lease expiry", async () => {
    mocks.provider.mockResolvedValueOnce(Response.json({ message: { content: "not JSON" } }));
    expect((await route.POST(req("POST", { kind: "quiz" }))).status).toBe(502);
    expect(await get()).toBeNull();
    const ready = await generate(); expect(ready.phrases).toHaveLength(5);
    // Separate kind; expire only this test account's pending lease inside the provider stub.
    mocks.provider.mockImplementationOnce(async () => {
      await pool.query("update tonetalk_dev.daily_practice_sets set generation_token=$1,generation_expires_at=now()-interval '1 second' where owner_id=$2 and kind='puzzle'", [randomUUID(), a]);
      return providerReply("stale");
    });
    expect((await route.POST(req("POST", { kind: "puzzle" }))).status).toBe(409);
    expect(await get("puzzle")).toBeNull();
    mocks.provider.mockImplementation(async () => providerReply("replacement"));
    const replacement = await generate("puzzle");
    expect(replacement.phrases[0].translatedText).toContain("replacement");
  });
  it("rolls back the answer when XP persistence fails", async () => {
    const set = await generate();
    // Corrupt only our fixture ID to force the real XP column-length constraint to fail.
    await pool.query("update tonetalk_dev.daily_practice_sets set phrases=jsonb_set(phrases,'{0,id}',to_jsonb($1::text)) where id=$2 and owner_id=$3", ["x".repeat(241), set.id, a]);
    const eventId = randomUUID();
    expect((await answer(set, 0, correct(set), eventId)).status).toBe(500);
    expect((await pool.query("select count(*)::int as n from tonetalk_dev.daily_practice_answers where set_id=$1", [set.id])).rows[0].n).toBe(0);
    await pool.query("update tonetalk_dev.daily_practice_sets set phrases=jsonb_set(phrases,'{0,id}',to_jsonb($1::text)) where id=$2 and owner_id=$3", [set.phrases[0].id, set.id, a]);
    expect(await (await answer(set, 0, correct(set), eventId)).json()).toMatchObject({ points: 20, totalPoints: 20 });
  });
  it("denies browser database roles and enables RLS on both new tables", async () => {
    const permissions = await pool.query("select relname,relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_read,has_table_privilege('authenticated',c.oid,'INSERT') as user_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tonetalk_dev' and c.relname in ('daily_practice_sets','daily_practice_answers')");
    expect(permissions.rows).toHaveLength(2);
    expect(permissions.rows.every(r => r.relrowsecurity && !r.anon_read && !r.user_write)).toBe(true);
  });
  it("freezes own saved questions, grades first choice/reveal on the server and never calls AI", async () => {
    await get(); // Create the current owner's profile.
    const translation = randomUUID(), variant = randomUUID(), saved = randomUUID();
    await pool.query("insert into tonetalk_dev.translation_sessions(id,owner_id,source_text,source_language,target_language,model) values($1,$2,'오늘은 맑은 날이에요','ko','ja','fixture')", [translation, a]);
    await pool.query("insert into tonetalk_dev.translation_variants(id,session_id,tone,translated_text,context_note,position) values($1,$2,'polite','今日はいい天気です。','정중한 설명',0)", [variant, translation]);
    await pool.query("insert into tonetalk_dev.saved_phrases(id,owner_id,variant_id) values($1,$2,$3)", [saved, a, variant]);
    const start = async (kind: string) => dailyPracticeSchema.parse(await (await route.POST(req("POST", { kind, source: "saved" }))).json());
    const quiz = await start("quiz"), puzzle = await start("puzzle");
    expect(quiz.phrases).toHaveLength(1); expect(quiz.phrases[0].id).toBe(saved);
    expect(quiz.source).toBe("saved"); expect(mocks.provider).not.toHaveBeenCalled();
    await answer(quiz, 0, { type: "quiz", tone: "casual" });
    expect(await (await answer(quiz, 0, { type: "quiz", tone: "polite" })).json()).toMatchObject({ points: 0, result: { outcome: "wrong" } });
    expect((await start("quiz")).results).toHaveLength(1);
    await answer(puzzle, 0, { type: "reveal" });
    const correctOrder = puzzleWords(puzzle.phrases[0].translatedText, "ja").map((_, i) => i);
    expect(await (await answer(puzzle, 0, { type: "puzzle", order: correctOrder })).json()).toMatchObject({ points: 0, result: { outcome: "revealed" } });
    expect((await answer(quiz, 1, { type: "quiz", tone: "polite" })).status).toBe(404);
    await pool.query("delete from tonetalk_dev.saved_phrases where id=$1 and owner_id=$2", [saved, a]);
    expect((await start("quiz")).id).toBe(quiz.id); // Deleting/restarting cannot reset the attempt.
    as(b);
    expect((await route.POST(req("POST", { kind: "quiz", source: "saved" }))).status).toBe(422);
    expect((await answer(quiz, 0, { type: "quiz", tone: "polite" })).status).toBe(404);
  });
});
