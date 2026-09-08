// Opt-in integration checks against ONLY tonetalk_dev. No Ollama calls.
// PERF_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/performance-db.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { tones } from "@/lib/translation-contract";

describe.skipIf(process.env.PERF_DB_TEST !== "1")("development PostgreSQL performance integration", () => {
  const owner = `perf-${randomUUID()}`;
  let pool: typeof import("@/server/db").pool | undefined;
  let cacheKey: string | undefined;
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Integration tests require tonetalk_dev explicitly");
    process.env.SINGLE_USER_ID = owner;
    pool = (await import("@/server/db")).pool;
  });
  afterAll(async () => {
    if (!pool) return;
    if (cacheKey) await pool.query('delete from tonetalk_dev.translation_cache where key = $1', [cacheKey]);
    await pool.query('delete from tonetalk_dev.app_users where id = $1', [owner]);
    await pool.end();
  });
  it("aggregates due/mastered/today/streak correctly for real persisted rows", async () => {
    const { getStudySummary } = await import("@/server/study");
    const now = new Date("2026-09-08T15:01:00Z");
    expect(await getStudySummary(now)).toMatchObject({ totalSaved: 0, reviewedToday: 0, streakDays: 0 });
    const session = randomUUID(), variant = randomUUID(), saved = randomUUID();
    await pool!.query(`insert into tonetalk_dev.translation_sessions (id,owner_id,source_text,source_language,target_language,model)
      values ($1,$2,'performance fixture','en','ja','test-only')`, [session, owner]);
    await pool!.query(`insert into tonetalk_dev.translation_variants (id,session_id,tone,translated_text,context_note,position)
      values ($1,$2,'casual','テスト','test-only',0)`, [variant, session]);
    await pool!.query(`insert into tonetalk_dev.saved_phrases (id,owner_id,variant_id) values ($1,$2,$3)`, [saved, owner, variant]);
    await pool!.query(`insert into tonetalk_dev.study_progress (id,owner_id,saved_phrase_id,interval_days,next_review_at)
      values ($1,$2,$3,21,'2026-09-10T00:00:00Z')`, [randomUUID(), owner, saved]);
    for (const at of ["2026-09-08T14:59:00Z", "2026-09-08T15:00:00Z", "2026-09-08T15:00:30Z"]) {
      await pool!.query(`insert into tonetalk_dev.study_review_events (id,owner_id,saved_phrase_id,rating,reviewed_at) values ($1,$2,$3,'good',$4)`, [randomUUID(), owner, saved, at]);
    }
    const started = performance.now();
    expect(await getStudySummary(now)).toEqual({ totalSaved: 1, dueCount: 0, reviewedToday: 2, masteredCount: 1, streakDays: 2, dailyGoal: 10, nextReviewAt: "2026-09-10T00:00:00.000Z" });
    console.info("study_summary_query_ms", Math.round(performance.now() - started));
  });
  it("reuses a validated cache entry and rejects it after expiry", async () => {
    const { readTranslationCache, writeTranslationCache, translationCacheKey } = await import("@/server/translation-cache");
    cacheKey = translationCacheKey(owner, "performance fixture", "en", "ja");
    const value = { sourceLanguage: "en" as const, latencyMs: 10, variants: tones.map((tone) => ({ tone, translatedText: "テスト", transliteration: "Tesuto", hangulPronunciation: "테스토", contextNote: "test-only", warning: null })) };
    await writeTranslationCache(cacheKey, value);
    const started = performance.now();
    expect(await readTranslationCache(cacheKey)).toEqual(value);
    console.info("translation_cache_read_ms", Math.round(performance.now() - started));
    await pool!.query(`update tonetalk_dev.translation_cache set expires_at = now() - interval '1 second' where key = $1`, [cacheKey]);
    expect(await readTranslationCache(cacheKey)).toBeNull();
  });
  it("admits only one of ten simultaneous requests without holding a DB connection", async () => {
    const { withInferenceSlot, InferenceBusyError } = await import("@/server/inference-limit");
    const active = await pool!.query(`select id from tonetalk_dev.inference_leases where id = 'ollama' and expires_at > now()`);
    if (active.rows.length) throw new Error("Another development inference is active; retry later without deleting its lease");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered: () => void = () => {};
    const admitted = new Promise<void>((resolve) => { entered = resolve; });
    const first = withInferenceSlot(async () => { entered(); await held; return "first"; });
    try {
      await Promise.race([admitted, first]);
      const others = await Promise.allSettled(Array.from({ length: 9 }, () => withInferenceSlot(async () => "unexpected")));
      expect(others.every((result) => result.status === "rejected" && result.reason instanceof InferenceBusyError)).toBe(true);
    } finally { release(); await first; }
    expect(await withInferenceSlot(async () => "next")).toBe("next");
  });
});
