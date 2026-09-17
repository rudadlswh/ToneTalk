import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ getEnv: () => ({ GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_API_KEY: "test-secret" }) }));
import { postGemini } from "@/server/gemini";

const body = { messages: [{ role: "system", content: "coach" }, { role: "user", content: "hello" }, { role: "assistant", content: "hi" }], format: { type: "object" }, options: { temperature: 0, num_predict: 500 } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Gemini transport", () => {
  it("preserves schema and chat roles, excludes thought parts", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "hidden" }, { text: "{}" }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await (await postGemini(body, new AbortController().signal)).json()).toEqual({ message: { content: "{}" } });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toContain("gemini-3.1-flash-lite:generateContent");
    expect(url).not.toContain("test-secret");
    const payload = JSON.parse(request.body);
    expect(payload.contents.map((m: { role: string }) => m.role)).toEqual(["user", "model"]);
    expect(payload.generationConfig.responseJsonSchema).toEqual(body.format);
  });
  it("reports quota without retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 429, code: "AI_QUOTA_EXCEEDED", retryAfterSeconds: 120, cooldownSeconds: 120, retainLease: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] })));
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 502, cooldownSeconds: 0 });
  });
  it.each([400, 401, 403, 404, 500, 503])("distinguishes configuration and provider errors (%s) without leaking responses", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private provider diagnostic", { status }));
    vi.stubGlobal("fetch", fetcher);
    const error = await postGemini(body, new AbortController().signal).catch(error => error);
    expect(error).toMatchObject({ status: 503, cooldownSeconds: status < 500 ? 300 : 30 });
    expect(error.message).not.toContain("private provider diagnostic");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps an ambiguous network failure leased and does not retry", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("private connection detail"));
    vi.stubGlobal("fetch", fetcher);
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 503, code: "GEMINI_UNAVAILABLE", cooldownSeconds: 30, retainLease: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes deadline from client cancellation without sending a cancelled request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 504, code: "AI_TIMEOUT", retainLease: true });
    await expect(postGemini(body, AbortSignal.abort())).rejects.toMatchObject({ status: 499, code: "AI_CANCELLED", cooldownSeconds: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
