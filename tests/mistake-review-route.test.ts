import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), list: vi.fn(), submit: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ AuthConfigurationError: class extends Error {}, createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/server/mistake-review", () => ({ listMistakes: mocks.list, submitMistakeReview: mocks.submit,
  MistakeReviewError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
import { GET, POST } from "@/app/api/study/mistakes/route";
import { mistakeCursorSchema } from "@/lib/mistake-review";
import { MistakeReviewError } from "@/server/mistake-review";
import { resetRateLimitsForTests } from "@/server/rate-limit";
const input = { setId: randomUUID(), eventId: randomUUID(), questionIndex: 0, answer: { type: "quiz", tone: "casual" } };
const request = (method = "GET", body?: unknown, query = "") => new Request(`https://app.test/api/study/mistakes${query}`, { method, headers: { origin: "https://app.test", "x-tonetalk-account": "a" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks(); resetRateLimitsForTests();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "a", email: "a@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  mocks.list.mockResolvedValue({ items: [], nextCursor: null }); mocks.submit.mockResolvedValue({ result: { eventId: input.eventId, outcome: "correct" }, points: 0, replayed: false });
});
it("requires verified identity, matching account and same-origin mutations", async () => {
  const changed = request(); changed.headers.set("x-tonetalk-account", "b");
  expect((await GET(changed)).status).toBe(403);
  const external = request("POST", input); external.headers.set("origin", "https://evil.test");
  expect((await POST(external)).status).toBe(403);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request())).status).toBe(401); expect((await POST(request("POST", input))).status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
});
it("uses validated filters/cursors and never caches account history publicly", async () => {
  const cursor = `20700|${input.setId}|2`;
  const response = await GET(request("GET", undefined, `?kind=puzzle&tone=polite&status=resolved&cursor=${encodeURIComponent(cursor)}`));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.list).toHaveBeenCalledWith({ kind: "puzzle", tone: "polite", status: "resolved", cursor: { day: 20700, setId: input.setId, questionIndex: 2 } });
  for (const query of ["?kind=chat", "?tone=bad", "?status=bad", "?ownerId=b", "?cursor=bad"]) expect((await GET(request("GET", undefined, query))).status).toBe(400);
  for (const cursor of [`0|${input.setId}|1`, `9999999999|${input.setId}|1`, `20700|${input.setId}|`, `20700|${input.setId}|2|extra`]) expect(mistakeCursorSchema.safeParse(cursor).success).toBe(false);
});
it("bounds bytes/fields and refuses client-supplied grading or rewards", async () => {
  for (const extras of [{ points: 20 }, { ownerId: "b" }, { outcome: "correct" }, { questionIndex: 5 }]) expect((await POST(request("POST", { ...input, ...extras }))).status).toBe(400);
  expect((await POST(request("POST", { ...input, filler: "가".repeat(1000) }))).status).toBe(413);
  const malformed = new Request("https://app.test/api/study/mistakes", { method: "POST", headers: { origin: "https://app.test" }, body: "{" });
  expect((await POST(malformed)).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
  const response = await POST(request("POST", input));
  expect(await response.json()).toMatchObject({ points: 0, replayed: false }); expect(mocks.submit).toHaveBeenCalledWith(input);
});
it("distinguishes empty records from failures and preserves safe conflict errors", async () => {
  expect(await (await GET(request())).json()).toMatchObject({ items: [], nextCursor: null });
  mocks.list.mockRejectedValueOnce(new Error("private database details"));
  const failed = await GET(request()); expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("private database details");
  mocks.submit.mockRejectedValueOnce(new MistakeReviewError(409, "REVIEW_CONFLICT", "충돌"));
  expect((await POST(request("POST", input))).status).toBe(409);
});
it("limits repeated review submissions without touching persistence after the limit", async () => {
  for (let i = 0; i < 60; i++) expect((await POST(request("POST", input))).status).toBe(200);
  const response = await POST(request("POST", input)); expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0); expect(mocks.submit).toHaveBeenCalledTimes(60);
});
