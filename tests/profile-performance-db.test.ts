import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ id: crypto.randomUUID() }));
vi.mock("@/server/supabase-auth", () => ({
  AuthConfigurationError: class extends Error {},
  createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fixture.id, email: `${fixture.id}@example.invalid`, email_confirmed_at: "2026-01-01" } }, error: null }) } }),
}));

it.skipIf(process.env.PROFILE_DB_TEST !== "1")("measures warm profile handler round trips with a verified identity fixture", async () => {
  if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit dev schema required");
  const { pool } = await import("@/server/db");
  const { GET } = await import("@/app/api/profile/route");
  const request = () => new Request("https://app.test/api/profile", { headers: { "x-request-id": randomUUID() } });
  try {
    expect((await GET(request())).status).toBe(200);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const query = vi.spyOn(pool, "query");
      const started = performance.now();
      const response = await GET(request());
      samples.push({ ms: Math.round(performance.now() - started), queries: query.mock.calls.length });
      query.mockRestore();
      expect(response.status).toBe(200);
      expect((await response.json()).profile.id).toBe(fixture.id);
    }
    console.info("profile_dev_samples_auth_stubbed", samples);
  } finally {
    vi.restoreAllMocks();
    await pool.query("delete from tonetalk_dev.app_users where id=$1", [fixture.id]);
    await pool.end();
  }
});
