import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/server/supabase-auth", () => ({
  AuthConfigurationError: class extends Error {},
  createAuthClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/server/db", () => ({ db: {}, pool: {} }));

import { AuthenticationError, getAuthenticatedUser, requestOwner, verifyUser, withAuth } from "@/server/auth";
import { isSameOriginRequest, safeAuthNext } from "@/lib/auth-navigation";

const user = (id: string) => ({ id, email: `${id}@example.invalid`, email_confirmed_at: "2026-01-01", is_anonymous: false });
beforeEach(() => { mocks.getUser.mockReset(); });

describe("verified request identity", () => {
  it("rejects missing, invalid, unconfirmed and anonymous users without a fixed owner fallback", async () => {
    for (const value of [null, { ...user("a"), email_confirmed_at: null }, { ...user("a"), is_anonymous: true }]) {
      mocks.getUser.mockResolvedValue({ data: { user: value }, error: null });
      await expect(verifyUser()).rejects.toBeInstanceOf(AuthenticationError);
    }
    mocks.getUser.mockResolvedValue({ data: { user: user("a") }, error: { status: 401 } });
    await expect(verifyUser()).rejects.toBeInstanceOf(AuthenticationError);
  });
  it("keeps two simultaneous requests isolated and deduplicates owner bootstrap only within each request", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: user("a") }, error: null });
    mocks.getUser.mockResolvedValueOnce({ data: { user: user("b") }, error: null });
    const initialize = vi.fn(async () => (await getAuthenticatedUser()).id);
    const handle = withAuth(async () => {
      const first = await getAuthenticatedUser();
      await new Promise((resolve) => setTimeout(resolve, first.id === "a" ? 15 : 1));
      const [owner1, owner2] = await Promise.all([requestOwner(initialize), requestOwner(initialize)]);
      return Response.json({ id: (await getAuthenticatedUser()).id, owner1, owner2 });
    });
    const responses = await Promise.all([handle(new Request("https://app.test/api/profile")), handle(new Request("https://app.test/api/profile"))]);
    expect(await responses[0].json()).toEqual({ id: "a", owner1: "a", owner2: "a" });
    expect(await responses[1].json()).toEqual({ id: "b", owner1: "b", owner2: "b" });
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(responses[0].headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("does not trust a forged owner header and fails closed on auth outages", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await withAuth(handler)(new Request("https://app.test/api/profile", { headers: { "x-user-id": "single-user" } }))).status).toBe(401);
    mocks.getUser.mockRejectedValue(new Error("private detail"));
    const response = await withAuth(handler)(new Request("https://app.test/api/profile"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private detail");
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and missing-origin mutations", async () => {
    const handler = vi.fn(async () => new Response());
    for (const origin of [undefined, "https://attacker.test", "null"]) {
      const response = await withAuth(handler)(new Request("https://app.test/api/profile", { method: "PATCH", headers: origin ? { origin } : {} }));
      expect(response.status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(isSameOriginRequest(new Request("https://app.test/api/x", { headers: { origin: "https://app.test" } }))).toBe(true);
  });
  it("allows only known local pages as login destinations", () => {
    for (const next of ["https://evil.test", "//evil.test", "/\\evil.test", "/auth/callback", "/api/profile", "/saved?next=//evil.test"]) expect(safeAuthNext(next)).toBe("/");
    expect(safeAuthNext("/saved")).toBe("/saved");
  });
  it("every existing app API rejects unauthenticated direct access before data/AI work", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const routes = [
      [await import("@/app/api/profile/route"), ["GET", "PATCH"]],
      [await import("@/app/api/saved-phrases/route"), ["GET", "POST"]],
      [await import("@/app/api/saved-phrases/[id]/route"), ["DELETE"]],
      [await import("@/app/api/study/route"), ["GET"]],
      [await import("@/app/api/study/reviews/route"), ["POST"]],
      [await import("@/app/api/settings/route"), ["GET"]],
      [await import("@/app/api/health/route"), ["GET"]],
      [await import("@/app/api/translations/route"), ["POST"]],
      [await import("@/app/api/lyrics/route"), ["POST"]],
      [await import("@/app/api/study/chat/route"), ["POST"]],
      [await import("@/app/api/tts/route"), ["POST"]],
    ] as const;
    for (const [module, methods] of routes) {
      for (const method of methods) {
        const handler = (module as unknown as Record<string, (request: Request) => Promise<Response>>)[method];
        expect((await handler(new Request("https://app.test/api/test", { method, headers: { origin: "https://app.test" } }))).status).toBe(401);
      }
    }
  });
});
