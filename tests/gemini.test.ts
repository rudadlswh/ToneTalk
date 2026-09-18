import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_API_KEY: "test-secret", GEMINI_API_KEYS: undefined as string | undefined }));
const context = vi.hoisted(() => ({ requestId: "a" }));
vi.mock("@/server/env", () => ({ getEnv: () => config }));
vi.mock("@/server/diagnostics", () => ({ getRequestId: () => context.requestId }));
import { postGemini } from "@/server/gemini";

const body = { messages: [{ role: "system", content: "coach" }, { role: "user", content: "hello" }, { role: "assistant", content: "hi" }], format: { type: "object" }, options: { temperature: 0, num_predict: 500 } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Gemini transport", () => {
  beforeEach(() => { config.GEMINI_API_KEY = "test-secret"; config.GEMINI_API_KEYS = undefined; context.requestId = "a"; });
  it("preserves schema and chat roles, excludes thought parts, and logs safe token usage", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "hidden" }, { text: "{}" }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 18, serviceTier: "FREE" },
    }));
    vi.stubGlobal("fetch", fetcher);
    expect(await (await postGemini(body, new AbortController().signal)).json()).toEqual({ message: { content: "{}" } });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toContain("gemini-3.1-flash-lite:generateContent");
    expect(url).not.toContain("test-secret");
    const payload = JSON.parse(request.body);
    expect(payload.contents.map((m: { role: string }) => m.role)).toEqual(["user", "model"]);
    expect(payload.generationConfig.responseJsonSchema).toEqual(body.format);
    expect(log).toHaveBeenCalledWith("gemini_usage", expect.objectContaining({
      provider: "gemini", model: "gemini-3.1-flash-lite", keySlot: 1,
      promptTokens: 12, outputTokens: 4, thoughtTokens: 2, totalTokens: 18,
      remainingTokens: null, remainingTokensReason: "not_provided_by_gemini_api",
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret");
  });
  it("distributes requests across configured keys before failover", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    config.GEMINI_API_KEYS = "project-a-key,project-b-key";
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] })));
    vi.stubGlobal("fetch", fetcher);

    context.requestId = "a";
    await postGemini(body, new AbortController().signal);
    context.requestId = "b";
    await postGemini(body, new AbortController().signal);

    expect(fetcher.mock.calls[0][1].headers["x-goog-api-key"]).not.toBe(fetcher.mock.calls[1][1].headers["x-goog-api-key"]);
  });
  it("rotates to a different configured key after quota exhaustion", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    config.GEMINI_API_KEYS = "project-a-key,project-b-key";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    await expect((await postGemini(body, new AbortController().signal)).json()).resolves.toEqual({ message: { content: "{}" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].headers["x-goog-api-key"]).not.toBe(fetcher.mock.calls[1][1].headers["x-goog-api-key"]);
    expect(warning).toHaveBeenCalledWith("gemini_key_failover", expect.objectContaining({ failedKeySlot: expect.any(Number), nextKeySlot: expect.any(Number), status: 429 }));
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/project-[ab]-key/);
  });
  it("reports quota after every configured project is exhausted", async () => {
    config.GEMINI_API_KEYS = "project-a-key,project-b-key";
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 429, code: "AI_QUOTA_EXCEEDED", retryAfterSeconds: 120, cooldownSeconds: 120, retainLease: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rotates on a structured invalid-key response but not an ordinary bad request", async () => {
    config.GEMINI_API_KEYS = "expired-key,working-key";
    const invalidKey = { error: { details: [{ reason: "API_KEY_INVALID" }] } };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(invalidKey, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    await expect((await postGemini(body, new AbortController().signal)).json()).resolves.toEqual({ message: { content: "{}" } });
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockReset().mockResolvedValue(new Response("bad schema", { status: 400 }));
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ code: "AI_CONFIGURATION_ERROR" });
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
