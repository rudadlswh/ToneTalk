import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiServiceError } from "@/server/ai-error";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: "", overrides: {} as Record<string, unknown> }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: mocks.user, email: "test@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null }) } }) }));
vi.mock("@/server/env", async importOriginal => {
  const real = await importOriginal<typeof import("@/server/env")>();
  return { getEnv: () => ({ ...real.getEnv(), ...mocks.overrides }) };
});

describe.skipIf(process.env.AI_USAGE_DB_TEST !== "1")("AI dispatch admission in real tonetalk_dev", () => {
  const scope = randomUUID().replaceAll("-", ""), a = randomUUID(), b = randomUUID();
  const prefix = `gemini:${scope}`;
  const slotPrefix = `ai-${createHash("sha256").update(prefix).digest("hex").slice(0, 30)}-`;
  const keys = [`${prefix}:global`, `${prefix}:user:${a}`, `${prefix}:user:${b}`];
  let pool: typeof import("@/server/db").pool;
  let usage: typeof import("@/server/ai-usage");
  const run = (work = async () => "done", signal = new AbortController().signal) => usage.withAiUsage(signal, work);
  const clean = async () => {
    await pool.query("delete from tonetalk_dev.ai_usage_state where id=any($1::varchar[])", [keys]);
    await pool.query("delete from tonetalk_dev.inference_leases where id=any($1::varchar[])", [[`${slotPrefix}1`, `${slotPrefix}2`]]);
  };
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit tonetalk_dev required");
    Object.assign(mocks.overrides, { AI_PROVIDER: "gemini", AI_USAGE_SCHEMA: "tonetalk_dev", AI_USAGE_SCOPE: scope });
    pool = (await import("@/server/db")).pool;
    usage = await import("@/server/ai-usage");
  });
  beforeEach(async () => {
    mocks.user = a;
    Object.assign(mocks.overrides, { AI_ENABLED: true, AI_USER_DAILY_LIMIT: 30, AI_GLOBAL_DAILY_LIMIT: 100,
      AI_USER_MINUTE_LIMIT: 50, AI_GLOBAL_MINUTE_LIMIT: 100, AI_MAX_CONCURRENT: 2, DATABASE_SCHEMA: "tonetalk_dev" });
    await clean();
  });
  afterAll(async () => { if (pool) { await clean(); await pool.end(); } });
  it("atomically caps concurrent requests and never charges a rejected dispatch", async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered = 0, rejected = 0;
    const work = vi.fn(async () => { entered++; await waiting; return "done"; });
    const requests = Array.from({ length: 5 }, () => run(work).catch(error => { rejected++; throw error; }));
    const settled = Promise.allSettled(requests);
    try {
      // Keep both slots occupied until all queued admissions have been decided.
      await vi.waitFor(() => { expect(entered).toBe(2); expect(rejected).toBe(3); }, { timeout: 5000 });
      expect(await usage.getAiUsage()).toMatchObject({ used: 2, remaining: 28 });
    } finally { release(); }
    const results = await settled;
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected").every(r => r.status === "rejected" && r.reason.code === "AI_BUSY")).toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it("enforces per-user daily and project-wide caps across verified accounts", async () => {
    mocks.overrides.AI_USER_DAILY_LIMIT = 2; mocks.overrides.AI_GLOBAL_DAILY_LIMIT = 3;
    await run(); await run();
    const blocked = vi.fn(async () => "unexpected");
    await expect(run(blocked)).rejects.toMatchObject({ status: 429, code: "AI_DAILY_LIMIT" });
    expect(blocked).not.toHaveBeenCalled();
    mocks.user = b; expect(await usage.getAiUsage()).toMatchObject({ used: 0 }); await run();
    await expect(run(blocked)).rejects.toMatchObject({ code: "AI_DAILY_LIMIT" });
    expect(await usage.getAiUsage()).toMatchObject({ used: 1, remaining: 1, available: false });
    mocks.user = a; expect(await usage.getAiUsage()).toMatchObject({ used: 2, remaining: 0 });
  });
  it("resets counters at DB minute and KST day boundaries without retaining history rows", async () => {
    mocks.overrides.AI_USER_MINUTE_LIMIT = 1;
    await run(); await expect(run()).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
    await pool.query("update tonetalk_dev.ai_usage_state set minute=minute-1 where id=any($1::varchar[])", [keys]);
    await run(); expect(await usage.getAiUsage()).toMatchObject({ used: 2 });
    const state = await pool.query("select day from tonetalk_dev.ai_usage_state where id=$1", [keys[0]]);
    const expectedDay = await pool.query("select floor((extract(epoch from now())+32400)/86400)::int as day");
    expect(state.rows).toEqual(expectedDay.rows);
    await pool.query("update tonetalk_dev.ai_usage_state set minute=minute-1,day=day-1 where id=any($1::varchar[])", [keys]);
    expect(await usage.getAiUsage()).toMatchObject({ used: 0, remaining: 30 });
    await run(); expect(await usage.getAiUsage()).toMatchObject({ used: 1 });
  });
  it("shares minute limits across accounts without consuming rejected attempts", async () => {
    mocks.overrides.AI_GLOBAL_MINUTE_LIMIT = 1;
    await run(); mocks.user = b;
    const work = vi.fn(async () => "done");
    await expect(run(work)).rejects.toMatchObject({ code: "AI_RATE_LIMIT", status: 429 });
    expect(work).not.toHaveBeenCalled();
    expect(await usage.getAiUsage()).toMatchObject({ used: 0, available: false });
    await pool.query("update tonetalk_dev.ai_usage_state set minute=minute-1 where id=any($1::varchar[])", [keys]);
    await run(); expect(await usage.getAiUsage()).toMatchObject({ used: 1 });
  });
  it("shares provider cooldown across accounts/instances and allows recovery after expiry", async () => {
    await expect(run(async () => { throw new AiServiceError(429, "AI_QUOTA_EXCEEDED", "provider limited", 120, 120); })).rejects.toMatchObject({ status: 429 });
    mocks.user = b;
    const work = vi.fn(async () => "done");
    await expect(run(work)).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(work).not.toHaveBeenCalled(); expect((await usage.getAiUsage()).retryAfterSeconds).toBeGreaterThan(100);
    await pool.query("update tonetalk_dev.ai_usage_state set blocked_until=now()-interval '1 second' where id=$1", [keys[0]]);
    expect(await run(work)).toBe("done"); expect(await usage.getAiUsage()).toMatchObject({ used: 1 });
  });
  it("retains ambiguous timed-out leases, charges attempts, and fences stale release", async () => {
    mocks.overrides.AI_MAX_CONCURRENT = 1;
    await expect(run(async () => { throw new AiServiceError(504, "AI_TIMEOUT", "timeout", 15, 0, true); })).rejects.toMatchObject({ status: 504 });
    await expect(run()).rejects.toMatchObject({ code: "AI_BUSY" });
    expect(await usage.getAiUsage()).toMatchObject({ used: 1 });
    await pool.query("update tonetalk_dev.inference_leases set expires_at=now()-interval '1 second' where id=$1", [`${slotPrefix}1`]);
    const replacement = randomUUID();
    await run(async () => {
      await pool.query("update tonetalk_dev.inference_leases set token=$1 where id=$2", [replacement, `${slotPrefix}1`]);
      return "done";
    });
    expect((await pool.query("select token from tonetalk_dev.inference_leases where id=$1", [`${slotPrefix}1`])).rows).toEqual([{ token: replacement }]);
  });
  it("rejects cancelled and disabled calls without charging, retaining a lease on in-flight cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    const work = vi.fn(async () => "done");
    await expect(run(work, controller.signal)).rejects.toThrow();
    mocks.overrides.AI_ENABLED = false;
    await expect(run(work)).rejects.toMatchObject({ code: "AI_DISABLED" }); expect(work).not.toHaveBeenCalled();
    expect(await usage.getAiUsage()).toMatchObject({ used: 0, enabled: false });
    mocks.overrides.AI_ENABLED = true;
    const active = new AbortController();
    await run(async () => { active.abort(); return "done"; }, active.signal);
    expect((await pool.query("select id from tonetalk_dev.inference_leases where id=$1", [`${slotPrefix}1`])).rows).toHaveLength(1);
  });
  it("uses the shared usage schema even when the application data schema differs", async () => {
    await run();
    mocks.overrides.DATABASE_SCHEMA = "tonetalk_prod"; // Connection and usage schema remain DEV; no production SQL.
    await run(); expect(await usage.getAiUsage()).toMatchObject({ used: 2 });
  });
  it("fails closed on DB errors and keeps RLS/browser role revocations", async () => {
    const work = vi.fn(async () => "done");
    const spy = vi.spyOn(pool, "connect").mockRejectedValueOnce(new Error("private DB detail") as never);
    try { await expect(run(work)).rejects.toMatchObject({ code: "AI_GUARD_UNAVAILABLE", status: 503 }); }
    finally { spy.mockRestore(); }
    expect(work).not.toHaveBeenCalled();
    const permissions = await pool.query("select relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon_read,has_table_privilege('authenticated',c.oid,'INSERT') as user_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tonetalk_dev' and c.relname='ai_usage_state'");
    expect(permissions.rows).toEqual([{ relrowsecurity: true, anon_read: false, user_write: false }]);
  });
});
