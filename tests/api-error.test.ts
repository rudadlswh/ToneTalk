import { expect, it } from "vitest";
import { ApiError, jsonError, readJson } from "@/lib/api";
it("preserves error code, status, retryability and support ID", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const response = jsonError(id, 503, "AUTH_UNAVAILABLE", "잠시 후 재시도", true);
  expect(response.headers.get("x-request-id")).toBe(id);
  await expect(readJson(response)).rejects.toMatchObject({ name: "ApiError", code: "AUTH_UNAVAILABLE", requestId: id, status: 503, retryable: true, message: expect.stringContaining(id) });
});
it("retains successful JSON and handles non-JSON errors", async () => {
  expect(await readJson(Response.json({ ok: true }))).toEqual({ ok: true });
  await expect(readJson(new Response("unavailable", { status: 502 }))).rejects.toBeInstanceOf(ApiError);
});
it("preserves credential rejection details without redirecting the login form", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  await expect(readJson(jsonError(id, 401, "CREDENTIALS_REJECTED", "아이디 확인"), { redirectOnUnauthorized: false })).rejects.toMatchObject({ code: "CREDENTIALS_REJECTED", requestId: id, status: 401 });
});
