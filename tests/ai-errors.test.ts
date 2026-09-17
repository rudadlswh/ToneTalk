import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AiServiceError, aiErrorResponse, retryAfterSeconds } from "@/server/ai-error";
import { readJson } from "@/lib/api";
afterEach(() => vi.restoreAllMocks());

it("normalizes provider Retry-After and bounds malformed or excessive waits", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-15T00:00:00Z"));
  expect(retryAfterSeconds("Tue, 15 Sep 2026 00:02:00 GMT")).toBe(120);
  expect(retryAfterSeconds("1.2")).toBe(2);
  expect(retryAfterSeconds("-10")).toBe(1);
  expect(retryAfterSeconds("999999999")).toBe(86400);
  expect(retryAfterSeconds(null)).toBe(60);
  expect(retryAfterSeconds("not a date")).toBe(60);
});
it("returns structured private errors and displays wait time without retrying", async () => {
  const response = aiErrorResponse(new AiServiceError(429, "AI_DAILY_LIMIT", "오늘 한도 초과", 90), "request-id")!;
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("90");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.clone().json()).toMatchObject({ error: { code: "AI_DAILY_LIMIT", retryable: true }, requestId: "request-id" });
  await expect(readJson(response)).rejects.toThrow("오늘 한도 초과 (약 2분 후 다시 요청해 주세요.)");
  expect(aiErrorResponse(new Error("private diagnostic"), "id")).toBeNull();
  expect((await aiErrorResponse(new AiServiceError(499, "AI_CANCELLED", "취소"), "id")!.json()).error.retryable).toBe(false);
});
