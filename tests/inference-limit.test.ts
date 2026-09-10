import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ pool: { query: vi.fn() } }));
const config = vi.hoisted(() => ({ AI_PROVIDER: "ollama", DATABASE_SCHEMA: "tonetalk_dev", OLLAMA_LEASE_SCHEMA: undefined as string | undefined }));
vi.mock("@/server/env", () => ({ getEnv: () => config }));
import { pool } from "@/server/db";
import { withInferenceSlot, InferenceBusyError } from "@/server/inference-limit";
import { withRequestBudget } from "@/server/request-budget";
beforeEach(() => { vi.mocked(pool.query).mockReset(); config.AI_PROVIDER = "ollama"; config.OLLAMA_LEASE_SCHEMA = undefined; });
it("does not acquire a PC lease for Gemini", async () => {
  config.AI_PROVIDER = "gemini";
  expect(await withInferenceSlot(async () => "done")).toBe("done");
  expect(pool.query).not.toHaveBeenCalled();
});
it("uses the shared lease schema without changing the data schema", async () => {
  config.OLLAMA_LEASE_SCHEMA = "tonetalk_prod";
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ token: "ok" }] } as never);
  await withInferenceSlot(async () => "ok");
  for (const [query] of vi.mocked(pool.query).mock.calls) expect(query).toContain('"tonetalk_prod"."inference_leases"');
  expect(config.DATABASE_SCHEMA).toBe("tonetalk_dev");
});
it("refuses inference when the shared lease is taken", async () => {
  vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
  const work = vi.fn();
  await expect(withInferenceSlot(work)).rejects.toBeInstanceOf(InferenceBusyError);
  expect(work).not.toHaveBeenCalled();
});
it("releases only its own token after success", async () => {
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ token: "acquired" }] } as never);
  expect(await withInferenceSlot(async () => "done")).toBe("done");
  const [acquire, release] = vi.mocked(pool.query).mock.calls;
  expect(acquire[0]).toContain("on conflict");
  expect(release[0]).toContain("token = $1");
  expect(release[1]).toEqual(acquire[1]);
});
it("retains a cancelled request's lease until expiry", async () => {
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ token: "acquired" }] } as never);
  const controller = new AbortController();
  const response = await withRequestBudget(new Request("https://test.local", { signal: controller.signal }), () => withInferenceSlot(async () => {
    controller.abort(); return Response.json({});
  }));
  expect(response.status).toBe(499);
  expect(pool.query).toHaveBeenCalledTimes(1);
});
