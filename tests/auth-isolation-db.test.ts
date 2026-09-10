// Real DEV database and real DAL/routes. Only the verified Supabase identity is
// stubbed; this does NOT replace the two-browser email/SMTP end-to-end check.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({
  AuthConfigurationError: class extends Error {},
  createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

describe.skipIf(process.env.AUTH_DB_TEST !== "1")("user isolation in tonetalk_dev", () => {
  const a = randomUUID(), b = randomUUID(), session = randomUUID(), variant = randomUUID();
  let savedId: string;
  let pool: typeof import("@/server/db").pool | undefined;
  const as = (id: string) => mocks.getUser.mockResolvedValue({ data: { user: { id, email: `${id}@example.invalid`, email_confirmed_at: "2026-01-01" } }, error: null });
  const request = (path: string, method = "GET", body?: unknown) => new Request(`https://app.test${path}`, {
    method, headers: { origin: "https://app.test", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  beforeAll(async () => {
    if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit tonetalk_dev required");
    pool = (await import("@/server/db")).pool;
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query("delete from tonetalk_dev.app_users where id = any($1::varchar[])", [[a, b]]);
    await pool.end();
  });
  it("isolates profiles, saved lists, settings, reviews, ownership mutations and translation cache keys", async () => {
    const profile = await import("@/app/api/profile/route");
    const saved = await import("@/app/api/saved-phrases/route");
    const removal = await import("@/app/api/saved-phrases/[id]/route");
    const study = await import("@/app/api/study/route");
    const reviews = await import("@/app/api/study/reviews/route");
    const settings = await import("@/app/api/settings/route");
    const { translationCacheKey } = await import("@/server/translation-cache");
    for (const id of [a, b]) {
      as(id);
      const response = await profile.GET(request("/api/profile"));
      expect(response.status).toBe(200);
      expect((await response.json()).profile.id).toBe(id);
    }
    await pool!.query("insert into tonetalk_dev.translation_sessions(id,owner_id,source_text,source_language,target_language,model) values ($1,$2,'isolation fixture','en','ja','test-only')", [session, a]);
    await pool!.query("insert into tonetalk_dev.translation_variants(id,session_id,tone,translated_text,context_note,position) values ($1,$2,'casual','テスト','test-only',0)", [variant, session]);
    as(a);
    const created = await saved.POST(request("/api/saved-phrases", "POST", { variantId: variant }));
    expect(created.status).toBe(201);
    savedId = (await created.json()).savedPhraseId;
    expect((await (await saved.GET(request("/api/saved-phrases"))).json()).items).toHaveLength(1);
    as(b);
    expect((await (await saved.GET(request("/api/saved-phrases"))).json()).items).toEqual([]);
    expect((await saved.POST(request("/api/saved-phrases", "POST", { variantId: variant, ownerId: a }))).status).toBe(404);
    expect((await removal.DELETE(request(`/api/saved-phrases/${savedId}`, "DELETE"), { params: Promise.resolve({ id: savedId }) })).status).toBe(404);
    expect((await reviews.POST(request("/api/study/reviews", "POST", { savedPhraseId: savedId, rating: "good", ownerId: a }))).status).toBe(404);
    const bStudy = await (await study.GET(request("/api/study"))).json();
    expect(bStudy.items).toEqual([]);
    expect(bStudy.summary).toMatchObject({ totalSaved: 0, reviewedToday: 0 });
    expect((await profile.PATCH(request("/api/profile", "PATCH", { ownerId: a, displayName: "User B", defaultTargetLanguage: "fr", dailyStudyGoal: 25 }))).status).toBe(200);
    expect((await (await settings.GET(request("/api/settings"))).json()).settings.defaultTargetLanguage).toBe("fr");
    as(a);
    const aProfile = await (await profile.GET(request("/api/profile"))).json();
    expect(aProfile.profile).toMatchObject({ id: a, displayName: "ToneTalk Learner", defaultTargetLanguage: "ja", dailyStudyGoal: 10 });
    expect(aProfile.stats.savedPhraseCount).toBe(1);
    // Exercise first-progress creation and an existing progress row concurrently.
    for (let batch = 0; batch < 2; batch++) {
      const responses = await Promise.all([0, 1].map(() => reviews.POST(request("/api/study/reviews", "POST", { savedPhraseId: savedId, rating: "good" }))));
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.json()));
      expect(bodies.map((r) => r.progress.reviewCount).sort()).toEqual([batch * 2 + 1, batch * 2 + 2]);
      expect(bodies.map((r) => r.progress.repetitions).sort()).toEqual([batch * 2 + 1, batch * 2 + 2]);
    }
    expect((await (await study.GET(request("/api/study"))).json()).summary.reviewedToday).toBe(4);
    as(b);
    expect((await (await study.GET(request("/api/study"))).json()).summary.reviewedToday).toBe(0);
    expect(translationCacheKey(a, "Hello", "en", "ja")).not.toBe(translationCacheKey(b, "Hello", "en", "ja"));
    as(a);
    expect((await removal.DELETE(request(`/api/saved-phrases/${savedId}`, "DELETE"), { params: Promise.resolve({ id: savedId }) })).status).toBe(204);
  });
});
