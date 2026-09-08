import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { jsonError } from "@/lib/api";

const budget = new AsyncLocalStorage<AbortSignal>();
export function requestSignal() { return budget.getStore(); }
export function assertRequestActive() { requestSignal()?.throwIfAborted(); }

// Includes body reading, database waits, inference and persistence, not a fresh
// timeout per retry. Reserve 10 seconds below Vercel's 180-second function limit.
export async function withRequestBudget(request: Request, work: () => Promise<Response>, timeoutMs = 150_000) {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), Math.min(timeoutMs, 170_000));
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([signal.aborted ? aborted : budget.run(signal, work), aborted]);
  } catch (error) {
    if (!signal.aborted) throw error;
    return jsonError(crypto.randomUUID(), request.signal.aborted ? 499 : 504,
      request.signal.aborted ? "CANCELLED" : "REQUEST_TIMEOUT",
      request.signal.aborted ? "요청을 취소했어요." : "처리 시간이 초과됐어요. 문장을 짧게 나눠 다시 시도해 주세요.", true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
