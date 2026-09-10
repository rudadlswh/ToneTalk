import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ signUp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), exchangeCodeForSession: vi.fn(), getAll: vi.fn(), get: vi.fn(), delete: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({ createAuthClient: async () => ({ auth: mocks }) }));
vi.mock("next/headers", () => ({ cookies: async () => mocks }));
import { POST as login } from "@/app/api/auth/login/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as callback } from "@/app/auth/callback/route";
import { resetRateLimitsForTests } from "@/server/rate-limit";
const request = (body: unknown, origin = "https://app.test") => new Request("https://app.test/api/auth/login", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
const input = { username: "Learner_1", password: "password-123" };
beforeEach(() => {
  vi.clearAllMocks(); resetRateLimitsForTests();
  mocks.signUp.mockResolvedValue({ data: { session: {} }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.getAll.mockReturnValue([]); mocks.get.mockReturnValue(undefined);
});
it("rejects CSRF and invalid credentials before provider calls", async () => {
  expect((await signup(request(input, "https://evil.test"))).status).toBe(403);
  for (const body of [{ ...input, username: "x@y.com" }, { ...input, password: "short" }, { ...input, username: "a" }]) expect((await login(request(body))).status).toBe(400);
  expect(mocks.signInWithPassword).not.toHaveBeenCalled();
});
it("normalizes IDs and uses password authentication without mail", async () => {
  expect((await signup(request(input))).status).toBe(200);
  const response = await login(request(input));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.signUp).toHaveBeenCalledWith({ email: "learner_1@users.tonetalk.invalid", password: input.password });
  expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "learner_1@users.tonetalk.invalid", password: input.password });
  expect(await response.text()).not.toContain(input.password);
});
it("fails closed on missing session and hides provider details", async () => {
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  expect((await signup(request(input))).status).toBe(503);
  mocks.signUp.mockResolvedValue({ error: { status: 400, message: "private detail" } });
  expect((await signup(request(input))).status).toBe(400);
  mocks.signInWithPassword.mockResolvedValue({ error: { status: 400, message: "private detail" } });
  const response = await login(request(input));
  expect(response.status).toBe(401); expect(await response.text()).not.toContain("private detail");
});
it("limits repeated account attempts", async () => {
  for (let i = 0; i < 5; i++) await login(request(input));
  const response = await login(request(input));
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
  expect(mocks.signInWithPassword).toHaveBeenCalledTimes(5);
});
it("handles provider outages and rate limits", async () => {
  mocks.signInWithPassword.mockRejectedValue(new Error("secret"));
  expect((await login(request(input))).status).toBe(503);
  mocks.signInWithPassword.mockResolvedValue({ error: { status: 429 } });
  expect((await login(request(input))).status).toBe(429);
});
it("retains logout CSRF checks and safe legacy callback redirects", async () => {
  expect((await logout(request({}, "https://evil.test"))).status).toBe(403);
  expect((await logout(request({}))).status).toBe(200);
  const response = await callback(new Request("https://app.test/auth/callback?code=secret&next=https://evil.test"));
  expect(response.headers.get("location")).toBe("https://app.test/auth/complete?next=%2F");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
