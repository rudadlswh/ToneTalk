import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/inference-limit", () => ({ InferenceBusyError: class extends Error {} }));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), get: vi.fn(), ensure: vi.fn(), submit: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/server/daily-practice", () => ({
  DailyPracticeError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
  getDailyPractice: mocks.get, ensureDailyPractice: mocks.ensure, submitDailyAnswer: mocks.submit,
}));
import { GET, POST, PUT } from "@/app/api/study/daily/route";
import { DailyPracticeError } from "@/server/daily-practice";
import { AiServiceError } from "@/server/ai-error";
import { resetRateLimitsForTests } from "@/server/rate-limit";
const input = { eventId: randomUUID(), setId: randomUUID(), questionIndex: 0, answer: { type: "quiz", tone: "casual" } };
const request = (method: string, body?: unknown, account = "a", origin = "https://app.test") => new Request("https://app.test/api/study/daily?kind=quiz", {
  method, headers: { origin, "x-tonetalk-account": account }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.resetAllMocks(); resetRateLimitsForTests();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "a", email: "a@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  mocks.get.mockResolvedValue(null); mocks.ensure.mockResolvedValue({ id: input.setId, phrases: [] });
  mocks.submit.mockResolvedValue({ points: 20, totalPoints: 20 });
});
it("requires a verified matching account and same origin before touching persistence", async () => {
  expect((await PUT(request("PUT", input, "b"))).status).toBe(403);
  expect((await POST(request("POST", { kind: "quiz" }, "a", "https://evil.test"))).status).toBe(403);
  expect((await GET(request("GET", undefined, "b"))).status).toBe(403);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request("GET"))).status).toBe(401);
  expect((await PUT(request("PUT", input))).status).toBe(401);
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
});
it("distinguishes empty history from DB failure and caches nothing publicly", async () => {
  const response = await GET(request("GET"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ practice: null });
  mocks.get.mockRejectedValueOnce(new Error("private SQL"));
  const failed = await GET(request("GET"));
  expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("private SQL");
  expect((await GET(new Request("https://app.test/api/study/daily?kind=bad"))).status).toBe(400);
});
it("reuses existing sets without consuming AI limits and passes only kind to generation", async () => {
  mocks.get.mockResolvedValue({ id: input.setId });
  for (let i = 0; i < 6; i++) expect((await POST(request("POST", { kind: "quiz" }))).status).toBe(200);
  expect(mocks.ensure).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue(null);
  expect((await POST(request("POST", { kind: "quiz", exclude: ["untrusted"] }))).status).toBe(200);
  expect(mocks.ensure).toHaveBeenCalledWith("quiz", "daily");
  mocks.ensure.mockRejectedValueOnce(new DailyPracticeError(409, "DAILY_GENERATING", "진행 중"));
  const busy = await POST(request("POST", { kind: "quiz" }));
  expect(busy.status).toBe(409); expect(busy.headers.get("retry-after")).toBe("3");
});
it("bounds input bytes, rejects client grading, and preserves idempotency input", async () => {
  expect((await PUT(request("PUT", { ...input, points: 999 }))).status).toBe(400);
  expect((await PUT(request("PUT", { ...input, filler: "가".repeat(1000) }))).status).toBe(413);
  expect((await POST(request("POST", { kind: "bad" }))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect((await PUT(request("PUT", input))).status).toBe(200);
  expect(mocks.submit).toHaveBeenCalledWith(input);
  for (let i = 0; i < 59; i++) await PUT(request("PUT", input));
  expect((await PUT(request("PUT", input))).status).toBe(429);
});
it("preserves shared AI quota status and Retry-After", async () => {
  mocks.ensure.mockRejectedValueOnce(new AiServiceError(429, "AI_DAILY_LIMIT", "오늘 사용 한도 초과", 90));
  const response = await POST(request("POST", { kind: "quiz" }));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("90");
  expect(await response.json()).toMatchObject({ error: { code: "AI_DAILY_LIMIT" } });
});
