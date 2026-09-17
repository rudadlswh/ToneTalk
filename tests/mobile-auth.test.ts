import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), create: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({
  AuthConfigurationError: class extends Error {},
  createAuthClient: mocks.create,
}));
import { getAuthenticatedUser, withAuth } from "@/server/auth";
beforeEach(() => {
  mocks.getUser.mockReset(); mocks.create.mockReset();
  mocks.create.mockResolvedValue({ auth: { getUser: mocks.getUser } });
});
it("verifies the bearer token and scopes the existing API to its owner", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "mobile-owner", email: "mobile@users.tonetalk.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  const handler = withAuth(async () => Response.json(await getAuthenticatedUser()));
  const response = await handler(new Request("https://app.test/api/profile", { headers: { authorization: "Bearer valid-token" } }));
  expect(response.status).toBe(200);
  expect((await response.json()).id).toBe("mobile-owner");
  expect(mocks.getUser).toHaveBeenCalledWith("valid-token");
  expect(mocks.create).toHaveBeenCalledWith("valid-token");
});
it("rejects malformed and invalid bearer credentials without cookie fallback", async () => {
  const inner = vi.fn(async () => new Response());
  const handler = withAuth(inner);
  for (const authorization of ["Basic abc", "", "Bearer a b"]) {
    expect((await handler(new Request("https://app.test/api/profile", { headers: { authorization } }))).status).toBe(401);
  }
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
  expect((await handler(new Request("https://app.test/api/profile", { headers: { authorization: "Bearer expired" } }))).status).toBe(401);
  expect(inner).not.toHaveBeenCalled();
});
it("keeps cookie mutation CSRF protection", async () => {
  const handler = withAuth(async () => new Response());
  expect((await handler(new Request("https://app.test/api/profile", { method: "PATCH", headers: { origin: "https://evil.test" } }))).status).toBe(403);
  expect(mocks.getUser).not.toHaveBeenCalled();
});
