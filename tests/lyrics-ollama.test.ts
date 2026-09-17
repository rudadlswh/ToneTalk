import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/ai-usage", () => ({ withAiUsage: (_signal: AbortSignal, work: () => Promise<unknown>) => work() }));
vi.mock("@/server/env", () => ({ getEnv: () => ({
  OLLAMA_BASE_URL: "https://ollama.example",
  OLLAMA_MODEL: "test-model",
  OLLAMA_TIMEOUT_MS: 5000,
  OLLAMA_BASIC_AUTH_USERNAME: "test-user",
  OLLAMA_BASIC_AUTH_PASSWORD: "test-password",
}) }));

import { generateTranslation, generateRoleplayReply, generateLyrics, generateLyricExplanation, OllamaOutputError, SameLanguageError } from "@/server/ollama";
import { AiServiceError } from "@/server/ai-error";
import type { LyricsRequest } from "@/lib/lyrics-contract";
import { tones } from "@/lib/translation-contract";
import { buildPrompt } from "@/lib/translation-prompt";

const input: LyricsRequest = { sourceLanguage: "en", targetLanguage: "ko", lines: [{ id: 3, text: "Morning light" }] };
const result = { lines: [{ id: 3, sourceLanguage: "en", translation: "아침 햇살", romanization: "Morning light", hangulPronunciation: "모닝 라이트" }] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Ollama lyrics integration", () => {
  it("preserves all four POST envelopes and classifies upstream outage consistently", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(generateTranslation("Hello", "en", "ja")).rejects.toMatchObject({ code: "OLLAMA_UNAVAILABLE", status: 503 });
    await expect(generateLyrics(input, new AbortController().signal)).rejects.toBeInstanceOf(AiServiceError);
    await expect(generateLyricExplanation({ action: "explain", text: "Hello", sourceLanguage: "en" }, new AbortController().signal)).rejects.toBeInstanceOf(AiServiceError);
    await expect(generateRoleplayReply({ scenario: "cafe", language: "en", messages: [{ role: "user", content: "Hello" }] }, new AbortController().signal)).rejects.toBeInstanceOf(AiServiceError);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const expectedOptions = [
      { temperature: 0, num_predict: 1600, num_ctx: 4096 },
      { temperature: 0, num_predict: 1200 },
      { temperature: 0, num_predict: 2200 },
      { temperature: 0.3, num_predict: 500 },
    ];
    fetcher.mock.calls.forEach(([url, init], index) => {
      expect(url).toBe("https://ollama.example/api/chat");
      expect(init.method).toBe("POST");
      expect(init.cache).toBe("no-store");
      expect(init.headers.get("content-type")).toBe("application/json");
      expect(init.headers.get("ngrok-skip-browser-warning")).toBe("1");
      expect(init.headers.get("authorization")).toBe(`Basic ${Buffer.from("test-user:test-password").toString("base64")}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init.body)).toMatchObject({ model: "test-model", stream: false, keep_alive: "10m", options: expectedOptions[index] });
    });
  });
  it("generates explanations with a schema and rejects rewritten source segments", async () => {
    const detail = { segments: [{ text: "Morning light", reading: "" }], words: [{ text: "light", reading: "light", hangulPronunciation: "라이트", meaning: "빛", grammar: "명사로 아침의 빛을 뜻해요." }], nuance: "아침 햇살의 이미지를 표현해요." };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify(detail) } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ ...detail, segments: [{ text: "Wrong line", reading: "" }] }) } }));
    vi.stubGlobal("fetch", fetcher);
    const request = { action: "explain" as const, text: "Morning light", sourceLanguage: "en" as const };
    expect(await generateLyricExplanation(request, new AbortController().signal)).toEqual(detail);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.format.properties).toHaveProperty("segments");
    expect(payload.messages[1].content).toBe("Morning light");
    await expect(generateLyricExplanation(request, new AbortController().signal)).rejects.toBeInstanceOf(OllamaOutputError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses server authentication and prompts for ORIGINAL pronunciation, not translated text", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify(result) } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await generateLyrics(input, new AbortController().signal)).toEqual(result);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://ollama.example/api/chat");
    expect(options.headers.get("authorization")).toMatch(/^Basic /);
    const payload = JSON.parse(options.body);
    expect(payload.messages[0].content).toContain("ORIGINAL source lyric, NOT its translation");
    expect(JSON.parse(payload.messages[1].content)).toEqual(input.lines);
    expect(payload.stream).toBe(false);
    expect(payload.format.properties.lines.items.properties.id.enum).toEqual([3]);
    expect(payload.format.properties.lines.items.properties.hangulPronunciation.pattern).toContain("가-힣");
  });
  it("rejects malformed output and wrong target language without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ message: { content: "not JSON" } }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ lines: [{ ...result.lines[0], translation: "Morning light" }] }) } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(generateLyrics(input, new AbortController().signal)).rejects.toBeInstanceOf(OllamaOutputError);
    await expect(generateLyrics(input, new AbortController().signal)).rejects.toBeInstanceOf(OllamaOutputError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("passes cancellation to fetch and safely maps network failures", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn().mockImplementation((_url, options) => {
      expect(options.signal.aborted).toBe(true);
      throw new DOMException("Aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(generateLyrics(input, controller.signal)).rejects.toBeInstanceOf(AiServiceError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("single-attempt translation generation", () => {
  const output = {
    sourceLanguage: "en",
    ...Object.fromEntries(tones.map(tone => [tone, {
      translatedText: "こんにちは", romanization: "Konnichiwa", hangulPronunciation: "콘니치와",
    }])),
  };
  it("returns all five validated tones using the shared prompt", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const translation = await generateTranslation("Hello", "en", "ja");
    expect(translation.sourceLanguage).toBe("en");
    expect(translation.variants.map(variant => variant.tone)).toEqual(tones);
    expect(translation.variants[0]).toMatchObject({ translatedText: "こんにちは", transliteration: "Konnichiwa", hangulPronunciation: "콘니치와" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[1].content).toBe(buildPrompt("Hello", "en", "ja"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["", "not JSON", "{}", JSON.stringify({ ...output, sourceLanguage: "ko" })])("rejects invalid output without retrying: %s", async content => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: { content } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(generateTranslation("Hello", "en", "ja")).rejects.toBeInstanceOf(OllamaOutputError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves the detected same-language error without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify({ ...output, sourceLanguage: "ja" }) } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(generateTranslation("こんにちは", "auto", "ja")).rejects.toBeInstanceOf(SameLanguageError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
