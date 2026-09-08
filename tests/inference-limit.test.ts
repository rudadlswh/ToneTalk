import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("@/server/env", () => ({ getEnv: () => ({ DATABASE_SCHEMA: "tonetalk_dev" }) }));
import { pool } from "@/server/db";
import { withInferenceSlot, InferenceBusyError } from "@/server/inference-limit";
import { withRequestBudget } from "@/server/request-budget";
beforeEach(() => vi.mocked(pool.query).mockReset());
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
