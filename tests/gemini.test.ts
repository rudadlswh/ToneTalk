import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ getEnv: () => ({ GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_API_KEY: "test-secret" }) }));
import { postGemini } from "@/server/gemini";

const body = { messages: [{ role: "system", content: "coach" }, { role: "user", content: "hello" }, { role: "assistant", content: "hi" }], format: { type: "object" }, options: { temperature: 0, num_predict: 500 } };
afterEach(() => vi.unstubAllGlobals());
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
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 429, code: "AI_QUOTA_EXCEEDED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] })));
    await expect(postGemini(body, new AbortController().signal)).rejects.toMatchObject({ status: 502 });
  });
});
