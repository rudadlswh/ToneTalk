import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), usage: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/server/ai-usage", () => ({ getAiUsage: mocks.usage }));
import { GET } from "@/app/api/ai/usage/route";
import { AiServiceError } from "@/server/ai-error";
const request = (account = "a") => new Request("https://app.test/api/ai/usage", { headers: { "x-tonetalk-account": account } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "a", email: "a@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  mocks.usage.mockResolvedValue({ used: 3, limit: 30, remaining: 27 });
});
it("requires a verified matching account before reading usage", async () => {
  expect((await GET(request("b"))).status).toBe(403);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.usage).not.toHaveBeenCalled();
});
it("returns private usage and never represents DB failure as zero remaining", async () => {
  const response = await GET(request());
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ used: 3, remaining: 27 });
  mocks.usage.mockRejectedValue(new AiServiceError(503, "AI_GUARD_UNAVAILABLE", "사용량 확인 실패", 30));
  const unavailable = await GET(request());
  expect(unavailable.status).toBe(503); expect(unavailable.headers.get("retry-after")).toBe("30");
  expect(await unavailable.json()).not.toHaveProperty("used");
});
