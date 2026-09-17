// Real DEV ledger/DAL/API; only Supabase identity verification is stubbed.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));

describe.skipIf(process.env.STUDY_POINTS_DB_TEST !== "1")("persistent study points in tonetalk_dev", () => {
  const a = randomUUID(), b = randomUUID();
  let pool: typeof import("@/server/db").pool;
  let route: typeof import("@/app/api/study/points/route");
  const as = (id: string) => mocks.getUser.mockResolvedValue({ data: { user: { id, email: `${id}@example.invalid`, email_confirmed_at: "2026-01-01" } }, error: null });
  const input = (activity = "quiz", activityId = "question-1", eventId = randomUUID()) => ({ activity, activityId, eventId });
  const post = (body: unknown) => route.POST(new Request("https://app.test/api/study/points", { method: "POST", headers: { origin: "https://app.test" }, body: JSON.stringify(body) }));
  const get = async (cursor?: string) => {
    const response = await route.GET(new Request(`https://app.test/api/study/points${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`));
    expect(response.status).toBe(200);
    return await response.json() as import("@/lib/study-points").StudyPointsResponse;
  };
  const seedLegacy = async (entry: ReturnType<typeof input>, owner = a) => {
    // Historical pre-limit rows intentionally have no new daily-claim column.
    await pool.query("insert into tonetalk_dev.study_point_events (id,owner_id,activity,activity_id,reward_day,points,credited_on) values ($1,$2,$3,$4,$5,$6,null)",
      [entry.eventId, owner, entry.activity, entry.activityId, entry.activity === "chat" ? 0 : 20000, entry.activity === "quiz" ? 20 : entry.activity === "puzzle" ? 25 : 35]);
  };
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit tonetalk_dev required");
    pool = (await import("@/server/db")).pool;
    route = await import("@/app/api/study/points/route");
  });
  beforeEach(async () => {
    (await import("@/server/rate-limit")).resetRateLimitsForTests();
    await pool.query("delete from tonetalk_dev.app_users where id = any($1::varchar[])", [[a, b]]);
    as(a);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    if (!pool) return;
    await pool.query("delete from tonetalk_dev.app_users where id = any($1::varchar[])", [[a, b]]);
    await pool.end();
  });
  it("acknowledges exact legacy retries but never accepts a new completion claim", async () => {
    const completion = input();
    await get(); await seedLegacy(completion);
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(completion)));
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.filter((r) => r.awarded)).toHaveLength(0);
    expect((await post(input())).status).toBe(409);
    await seedLegacy(input("puzzle")); await seedLegacy(input("chat", randomUUID()));
    expect(await get()).toMatchObject({ totalPoints: 80, nextCursor: null });
    expect((await get()).items.map((item) => item.points).sort()).toEqual([20, 25, 35]);
    as(b); expect(await get()).toMatchObject({ totalPoints: 0, items: [] });
    const staleQueue = new Request("https://app.test/api/study/points", {
      method: "POST", headers: { origin: "https://app.test", "x-tonetalk-account": a }, body: JSON.stringify(input()),
    });
    expect((await route.POST(staleQueue)).status).toBe(403);
    expect(await get()).toMatchObject({ totalPoints: 0, items: [] });
    expect((await post(completion)).status).toBe(409);
    expect((await post(input())).status).toBe(409); expect((await get()).totalPoints).toBe(0);
    as(a); expect((await get()).totalPoints).toBe(80);
  });
  it("uses KST day boundaries and never re-awards a retried event or chat after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-14T14:59:59Z"));
    const quiz = input(), chat = input("chat", randomUUID());
    await get(); await seedLegacy(quiz); await seedLegacy(chat);
    vi.setSystemTime(new Date("2026-09-14T15:00:01Z"));
    expect((await (await post(quiz)).json()).awarded).toBe(false);
    expect((await post(input("chat", chat.activityId))).status).toBe(409);
    expect((await post(input())).status).toBe(409);
    expect((await get()).totalPoints).toBe(55);
  });
  it("paginates tied timestamps without leaking other users or duplicating rows", async () => {
    await get();
    for (let i = 0; i < 22; i++) await seedLegacy(input("quiz", `question-${i}`));
    await pool.query("update tonetalk_dev.study_point_events set created_at='2026-09-14T00:00:00.123Z' where owner_id=$1", [a]);
    const first = await get();
    expect(first.items).toHaveLength(20); expect(first.totalPoints).toBe(440);
    const second = await get(first.nextCursor!);
    expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(22);
    as(b); expect((await get(first.nextCursor!)).items).toEqual([]);
  });
  it("enforces reward amounts at the DB boundary and denies browser DB roles", async () => {
    await get();
    await expect(pool.query("insert into tonetalk_dev.study_point_events (id,owner_id,activity,activity_id,reward_day,points) values ($1,$2,'quiz','tampered',20000,999)", [randomUUID(), a])).rejects.toMatchObject({ code: "23514" });
    const result = await pool.query("select relrowsecurity, has_table_privilege('anon',c.oid,'SELECT') as anon_read, has_table_privilege('authenticated',c.oid,'INSERT') as user_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tonetalk_dev' and c.relname='study_point_events'");
    expect(result.rows).toEqual([{ relrowsecurity: true, anon_read: false, user_write: false }]);
  });
});
