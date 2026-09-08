import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";
import { withRequestBudget } from "@/server/request-budget";
it("enforces byte size without relying on Content-Length", async () => {
  const request = new Request("https://test.local", { method: "POST", body: JSON.stringify({ text: "가".repeat(10) }) });
  await expect(readLimitedJson(request, 20)).rejects.toBeInstanceOf(PayloadTooLargeError);
});
it("cancels a stalled request body when its total deadline expires", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  const request = new Request("https://test.local", { method: "POST", body, duplex: "half" } as RequestInit);
  const response = await withRequestBudget(request, async () => Response.json(await readLimitedJson(request, 100)), 10);
  expect(response.status).toBe(504);
  expect(cancel).toHaveBeenCalledTimes(1);
});
