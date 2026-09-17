import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ execute: vi.fn(), ai: vi.fn() }));
vi.mock("@/server/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/server/ollama", () => ({ checkOllama: mocks.ai }));
// Authentication is covered separately by auth.test.ts.
vi.mock("@/server/auth", () => ({ withAuth: (handler: () => Promise<Response>) => handler }));
import { GET } from "@/app/api/health/route";
beforeEach(() => { mocks.execute.mockReset().mockResolvedValue([]); mocks.ai.mockReset().mockResolvedValue(true); });
it("returns 200 only when both dependencies are healthy", async () => {
  const response = await GET(new Request("https://app.test/api/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", database: true, ollama: true });
});
it("returns 503 for AI false, AI rejection and DB failure without logging details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.ai.mockResolvedValue(false);
    expect((await GET(new Request("https://app.test/api/health"))).status).toBe(503);
    mocks.ai.mockRejectedValue(new Error("private model output"));
    expect((await GET(new Request("https://app.test/api/health"))).status).toBe(503);
    mocks.ai.mockResolvedValue(true);
    mocks.execute.mockRejectedValue(new Error("private SQL params"));
    const response = await GET(new Request("https://app.test/api/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ database: false, ollama: true });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  } finally { log.mockRestore(); }
});
