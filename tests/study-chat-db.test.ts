import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTurnInput } from "@/lib/study-chat";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), generate: vi.fn(), reward: 35 }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/server/ollama", () => ({ generateRoleplayReply: mocks.generate }));
vi.mock("@/server/inference-limit", () => ({ withInferenceSlot: (work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/study-points", async original => ({ ...await original<typeof import("@/lib/study-points")>(), studyPointRewards: { quiz: 20, puzzle: 25, get chat() { return mocks.reward; } } }));

describe.skipIf(process.env.STUDY_CHAT_DB_TEST !== "1")("server-confirmed chat rewards in DEV", () => {
  const a = randomUUID(), b = randomUUID();
  let pool: typeof import("@/server/db").pool, service: typeof import("@/server/study-chat");
  const as = (id: string) => mocks.getUser.mockResolvedValue({ data: { user: { id, email: `${id}@example.invalid`, email_confirmed_at: "2026-01-01" } }, error: null });
  const start = () => service.startStudyChat({ scenario: "cafe", language: "en" });
  const input = (sessionId: string, messages: ChatTurnInput["messages"] = [{ role: "user", content: "A coffee please." }]): ChatTurnInput => ({ sessionId, eventId: randomUUID(), scenario: "cafe", language: "en", messages });
  const submit = (value: ChatTurnInput, signal = new AbortController().signal) => service.submitStudyChat(value, signal);
  const next = (value: ChatTurnInput, reply = "What size would you like?") => input(value.sessionId, [...value.messages, { role: "assistant", content: reply }, { role: "user", content: "A small cup please." }]);
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit DEV required");
    pool = (await import("@/server/db")).pool; service = await import("@/server/study-chat");
  });
  beforeEach(async () => {
    await pool.query("delete from tonetalk_dev.app_users where id=any($1::varchar[])", [[a, b]]);
    as(a); mocks.reward = 35;
    mocks.generate.mockReset().mockResolvedValue({ reply: "What size would you like?", feedback: "정중한 주문이에요.", suggestion: "A small coffee please." });
  });
  afterAll(async () => { if (pool) { await pool.query("delete from tonetalk_dev.app_users where id=any($1::varchar[])", [[a, b]]); await pool.end(); } });
  it("rejects forged sessions, skipped turns, modified history and other accounts before AI", async () => {
    const { sessionId } = await start();
    await expect(submit(input(randomUUID()))).rejects.toMatchObject({ status: 404 });
    await expect(submit(next(input(sessionId)))).rejects.toMatchObject({ status: 409 });
    as(b); await expect(submit(input(sessionId))).rejects.toMatchObject({ status: 404 }); as(a);
    expect(mocks.generate).not.toHaveBeenCalled();
    const first = input(sessionId); await submit(first);
    const tampered = next(first, "An invented assistant response.");
    await expect(submit(tampered)).rejects.toMatchObject({ code: "CHAT_STATE_CHANGED" });
    await expect(submit({ ...next(first), language: "ja" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("atomically commits the fourth response and 35 XP, acknowledging lost replies without another AI call", async () => {
    let value = input((await start()).sessionId);
    for (let i = 1; i <= 3; i++) {
      expect(await submit(value)).toMatchObject({ turns: i, points: 0, totalPoints: 0 }); value = next(value);
    }
    expect(await submit(value)).toMatchObject({ turns: 4, points: 35, totalPoints: 35 });
    const retries = await Promise.all(Array.from({ length: 5 }, () => submit(value)));
    expect(retries.every(r => r.replayed && r.points === 0 && r.totalPoints === 35 && r.response === null)).toBe(true);
    expect(mocks.generate).toHaveBeenCalledTimes(4);
    await expect(submit({ ...value, eventId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const rows = await pool.query("select * from tonetalk_dev.study_chat_sessions where id=$1", [value.sessionId]);
    expect(JSON.stringify(rows.rows)).not.toContain("coffee"); expect(JSON.stringify(rows.rows)).not.toContain("정중한");
    expect((await pool.query("select count(*)::int n from tonetalk_dev.study_point_events where owner_id=$1", [a])).rows[0].n).toBe(1);
  });
  it("serializes concurrent turns and fences expired workers", async () => {
    const value = input((await start()).sessionId);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => { entered = r; }), waiting = new Promise<void>(r => { release = r; });
    mocks.generate.mockImplementationOnce(async () => { entered(); await waiting; return { reply: "OK", feedback: "좋아요", suggestion: "Hello" }; });
    const first = submit(value); const outcome = first.catch(error => error);
    await started;
    try {
      await expect(submit(value)).rejects.toMatchObject({ code: "CHAT_BUSY" });
      await pool.query("update tonetalk_dev.study_chat_sessions set generation_token=$1,generation_expires_at=now()-interval '1 second' where id=$2", [randomUUID(), value.sessionId]);
    } finally { release(); }
    expect(await outcome).toMatchObject({ code: "CHAT_STATE_CHANGED" });
    expect((await pool.query("select turns from tonetalk_dev.study_chat_sessions where id=$1", [value.sessionId])).rows[0].turns).toBe(0);
    expect(await submit(value)).toMatchObject({ turns: 1 });
  });
  it("awards once across concurrent new conversations, resets by credit date and isolates accounts", async () => {
    const prepare = async () => {
      let value = input((await start()).sessionId);
      for (let i = 0; i < 3; i++) { await submit(value); value = next(value); }
      return value;
    };
    const first = await prepare(), second = await prepare();
    const receipts = await Promise.all([submit(first), submit(second)]);
    expect(receipts.map(r => r.points).sort()).toEqual([0, 35]);
    expect(receipts.every(r => r.turns === 4 && r.totalPoints === 35)).toBe(true);
    await pool.query("update tonetalk_dev.study_point_events set credited_on=credited_on-1,created_at=created_at-interval '1 day' where owner_id=$1", [a]);
    expect(await submit(first)).toMatchObject({ replayed: true, points: 0, totalPoints: 35 });
    expect(await submit(second)).toMatchObject({ replayed: true, points: 0, totalPoints: 35 });
    expect(await submit(await prepare())).toMatchObject({ points: 35, totalPoints: 70 });
    as(b); expect(await submit(await prepare())).toMatchObject({ points: 35, totalPoints: 35 });
  });
  it("rolls back progress when XP storage fails and never counts failed or cancelled AI", async () => {
    let value = input((await start()).sessionId);
    mocks.generate.mockRejectedValueOnce(new Error("upstream"));
    await expect(submit(value)).rejects.toThrow("upstream");
    const cancelled = new AbortController(); cancelled.abort();
    await expect(submit(value, cancelled.signal)).rejects.toThrow();
    for (let i = 0; i < 3; i++) { await submit(value); value = next(value); }
    mocks.reward = 999; // Force the real ledger CHECK to reject only our fourth-turn insert.
    await expect(submit(value)).rejects.toThrow();
    expect((await pool.query("select turns from tonetalk_dev.study_chat_sessions where id=$1", [value.sessionId])).rows[0].turns).toBe(3);
    expect((await pool.query("select count(*)::int n from tonetalk_dev.study_point_events where owner_id=$1", [a])).rows[0].n).toBe(0);
    mocks.reward = 35; expect(await submit(value)).toMatchObject({ turns: 4, points: 35 });
  });
  it("expires abandoned sessions, limits new starts across instances and blocks browser DB roles", async () => {
    const { sessionId } = await start();
    await pool.query("update tonetalk_dev.study_chat_sessions set created_at=now()-interval '25 hours' where id=$1", [sessionId]);
    await expect(submit(input(sessionId))).rejects.toMatchObject({ code: "CHAT_EXPIRED" });
    for (let i = 0; i < 10; i++) await start();
    await expect(start()).rejects.toMatchObject({ status: 429 });
    const result = await pool.query("select relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_read,has_table_privilege('authenticated',c.oid,'INSERT') as user_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tonetalk_dev' and c.relname='study_chat_sessions'");
    expect(result.rows).toEqual([{ relrowsecurity: true, anon_read: false, user_write: false }]);
  });
});
