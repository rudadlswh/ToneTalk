import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { requestSignal, withRequestBudget } from "@/server/request-budget";
afterEach(() => vi.useRealTimers());

it("bounds the whole operation and aborts its inference signal", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const pending = withRequestBudget(new Request("https://test.local"), async () => {
    signal = requestSignal();
    return new Promise<Response>(() => {});
  }, 50);
  await vi.advanceTimersByTimeAsync(50);
  expect((await pending).status).toBe(504);
  expect(signal?.aborted).toBe(true);
});
it("does not start an already cancelled request", async () => {
  const controller = new AbortController(); controller.abort();
  const work = vi.fn();
  expect((await withRequestBudget(new Request("https://test.local", { signal: controller.signal }), work)).status).toBe(499);
  expect(work).not.toHaveBeenCalled();
});
it("isolates simultaneous requests and clears successful timers", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  await Promise.all([1, 2].map(() => withRequestBudget(new Request("https://test.local"), async () => {
    signals.push(requestSignal()!);
    return Response.json({ ok: true });
  })));
  expect(signals[0]).not.toBe(signals[1]);
  expect(vi.getTimerCount()).toBe(0);
  expect(requestSignal()).toBeUndefined();
});
