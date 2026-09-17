import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), award: vi.fn(), list: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/server/study-points", () => ({ awardStudyPoints: mocks.award, listStudyPoints: mocks.list }));
import { GET, POST } from "@/app/api/study/points/route";
import { resetRateLimitsForTests } from "@/server/rate-limit";
import { parseStudyPointsCursor, studyPointsAccountHeader } from "@/lib/study-points";

const input = { eventId: "ba6c18b5-7f13-4251-8696-116c2f5aa6e0", activity: "quiz", activityId: "question-1" };
const post = (body: unknown, origin = "https://app.test") => new Request("https://app.test/api/study/points", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); resetRateLimitsForTests();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a", email: "a@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  mocks.award.mockResolvedValue({ awarded: true, points: 20, totalPoints: 20 });
  mocks.list.mockResolvedValue({ items: [], totalPoints: 0, nextCursor: null });
});
it("requires authentication and the existing same-origin boundary", async () => {
  expect((await POST(post(input, "https://evil.test"))).status).toBe(403);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(new Request("https://app.test/api/study/points"))).status).toBe(401);
  expect((await POST(post(input))).status).toBe(401);
  expect(mocks.award).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
it("rejects a queued account assertion that differs from the verified cookie or bearer identity", async () => {
  const request = post(input);
  request.headers.set(studyPointsAccountHeader, "user-a");
  expect((await POST(request)).status).toBe(200);
  mocks.award.mockClear();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-b", email: "b@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  for (const bearer of [false, true]) {
    const switched = post(input);
    switched.headers.set(studyPointsAccountHeader, "user-a");
    if (bearer) switched.headers.set("authorization", "Bearer user-b-token");
    const response = await POST(switched);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ACCOUNT_CHANGED");
  }
  expect((await GET(new Request("https://app.test/api/study/points", { headers: { [studyPointsAccountHeader]: "user-a" } }))).status).toBe(403);
  expect(mocks.award).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
it("rejects client-supplied rewards, owners, invalid activities and oversized bodies", async () => {
  for (const body of [{ ...input, points: 999 }, { ...input, ownerId: "other" }, { ...input, activity: "review" }, { ...input, eventId: "not-uuid" }, { ...input, activityId: "" }]) {
    expect((await POST(post(body))).status).toBe(400);
  }
  expect((await POST(post({ ...input, activityId: "가".repeat(1000) }))).status).toBe(413);
  expect((await POST(new Request("https://app.test/api/study/points", { method: "POST", headers: { origin: "https://app.test" }, body: "{" }))).status).toBe(400);
  expect(mocks.award).not.toHaveBeenCalled();
});
it("returns confirmed server amounts privately and accepts idempotent retries", async () => {
  const response = await POST(post(input));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ totalPoints: 20, points: 20 });
  expect(mocks.award).toHaveBeenCalledWith(input);
  mocks.award.mockResolvedValue({ awarded: false, points: 0, totalPoints: 20 });
  expect(await (await POST(post(input))).json()).toMatchObject({ awarded: false, totalPoints: 20 });
});
it("validates cursor pagination and distinguishes empty history from failure", async () => {
  expect((await GET(new Request("https://app.test/api/study/points?cursor=bad"))).status).toBe(400);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(await (await GET(new Request("https://app.test/api/study/points"))).json()).toMatchObject({ totalPoints: 0, items: [] });
  const cursor = `2026-09-14T00:00:00.123Z|${input.eventId}`;
  expect(parseStudyPointsCursor(cursor)).toEqual({ createdAt: new Date("2026-09-14T00:00:00.123Z"), id: input.eventId });
  mocks.list.mockRejectedValue(new Error("private SQL"));
  const response = await GET(new Request("https://app.test/api/study/points"));
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("private SQL");
});
it("reports write failures as retryable and rate limits spam", async () => {
  mocks.award.mockRejectedValueOnce(new Error("private SQL"));
  const response = await POST(post(input));
  expect(response.status).toBe(500);
  expect((await response.json()).error.retryable).toBe(true);
  for (let i = 0; i < 59; i++) await POST(post(input));
  expect((await POST(post(input))).status).toBe(429);
});
it("rejects unverified legacy claims without granting XP", async () => {
  mocks.award.mockResolvedValueOnce(null);
  const response = await POST(post(input));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "POINTS_PROOF_REQUIRED", retryable: false } });
});
