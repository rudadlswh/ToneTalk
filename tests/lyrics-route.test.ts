import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase-auth", () => ({
  AuthConfigurationError: class extends Error {},
  createAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001", email: "test@example.com", email_confirmed_at: "2026-01-01" } }, error: null }) } }),
}));
vi.mock("@/server/inference-limit", () => ({ withInferenceSlot: (work: () => Promise<unknown>) => work(), InferenceBusyError: class extends Error {} }));

vi.mock("@/server/ollama", () => ({
  generateLyrics: vi.fn(),
  generateLyricExplanation: vi.fn(),
  OllamaUnavailableError: class extends Error {},
  OllamaOutputError: class extends Error {},
}));
import { POST } from "@/app/api/lyrics/route";
import { generateLyrics, generateLyricExplanation, OllamaOutputError, OllamaUnavailableError } from "@/server/ollama";
import { resetRateLimitsForTests } from "@/server/rate-limit";

const body = JSON.stringify({ lines: [{ id: 0, text: "Morning light" }] });
const request = (text = body, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/lyrics", { method: "POST", headers: { origin }, body: text });
beforeEach(() => { resetRateLimitsForTests(); vi.mocked(generateLyrics).mockReset(); vi.mocked(generateLyricExplanation).mockReset(); });

describe("POST /api/lyrics", () => {
  it("routes explicit explanation requests separately with the abort signal", async () => {
    const input = { action: "explain", text: "青い空", sourceLanguage: "ja" };
    const explanation = { segments: [{ text: "青い空", reading: "あおいそら" }], words: [{ text: "空", reading: "そら", hangulPronunciation: "소라", meaning: "하늘", grammar: "명사예요." }], nuance: "푸른 하늘을 뜻해요." };
    vi.mocked(generateLyricExplanation).mockResolvedValue(explanation);
    const req = request(JSON.stringify(input));
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ explanation });
    expect(generateLyricExplanation).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    expect(generateLyrics).not.toHaveBeenCalled();
    expect((await POST(request(JSON.stringify({ ...input, sourceLanguage: "auto" })))).status).toBe(400);
  });
  it("passes cancellation signal and defaults, returns uncached results", async () => {
    vi.mocked(generateLyrics).mockResolvedValue({ lines: [{ id: 0, sourceLanguage: "en", translation: "아침 햇살", romanization: "Morning light", hangulPronunciation: "모닝 라이트" }] });
    const req = request();
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(generateLyrics).toHaveBeenCalledWith({ sourceLanguage: "auto", targetLanguage: "ko", lines: [{ id: 0, text: "Morning light" }] }, expect.any(AbortSignal));
  });
  it("rejects cross-origin, invalid JSON, huge bodies and too many lines before inference", async () => {
    expect((await POST(request(body, "https://other.example"))).status).toBe(403);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request("x".repeat(6001)))).status).toBe(413);
    expect((await POST(request(JSON.stringify({ lines: Array(3).fill({ id: 0, text: "Hello" }) })))).status).toBe(400);
    expect(generateLyrics).not.toHaveBeenCalled();
  });
  it("maps bad output and network errors without exposing secrets", async () => {
    vi.mocked(generateLyrics).mockRejectedValueOnce(new OllamaOutputError("private upstream details"));
    const invalid = await POST(request());
    expect(invalid.status).toBe(502);
    expect(await invalid.text()).not.toContain("private upstream details");
    vi.mocked(generateLyrics).mockRejectedValueOnce(new OllamaUnavailableError());
    expect((await POST(request())).status).toBe(503);
  });
  it("rate-limits repeated requests", async () => {
    for (let i = 0; i < 30; i++) await POST(request("{"));
    expect((await POST(request())).status).toBe(429);
  });
});
