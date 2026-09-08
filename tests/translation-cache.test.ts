import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ pool: { query: vi.fn() } }));
const env = vi.hoisted(() => ({ DATABASE_SCHEMA: "tonetalk_dev", OLLAMA_BASE_URL: "http://test.local", OLLAMA_MODEL: "model-a" }));
vi.mock("@/server/env", () => ({ getEnv: () => env }));
import { pool } from "@/server/db";
import { readTranslationCache, translationCacheKey, writeTranslationCache } from "@/server/translation-cache";
import { tones } from "@/lib/translation-contract";
const value = { sourceLanguage: "en" as const, latencyMs: 20, variants: tones.map((tone) => ({ tone, translatedText: "こんにちは", transliteration: "Konnichiwa", hangulPronunciation: "곤니치와", contextNote: "설명", warning: null })) };
beforeEach(() => { vi.mocked(pool.query).mockReset(); env.OLLAMA_MODEL = "model-a"; });
it("isolates keys by owner, model, source and target, preserves meaningful whitespace", () => {
  const key = translationCacheKey("a", "Hello", "auto", "ja");
  expect(translationCacheKey("a", " Hello ", "auto", "ja")).toBe(key);
  expect(translationCacheKey("b", "Hello", "auto", "ja")).not.toBe(key);
  expect(translationCacheKey("a", "Hello", "en", "ja")).not.toBe(key);
  expect(translationCacheKey("a", "Hello", "auto", "ko")).not.toBe(key);
  env.OLLAMA_MODEL = "model-b";
  expect(translationCacheKey("a", "Hello", "auto", "ja")).not.toBe(key);
});
it("treats missing or invalid entries as misses and checks expiry in SQL", async () => {
  vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never)
    .mockResolvedValueOnce({ rows: [{ payload: {} }] } as never)
    .mockResolvedValueOnce({ rows: [{ payload: value }] } as never);
  expect(await readTranslationCache("key")).toBeNull();
  expect(await readTranslationCache("key")).toBeNull();
  expect(await readTranslationCache("key")).toEqual(value);
  expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("expires_at > now()");
});
it("validates before writing and prunes only bounded cache data", async () => {
  await expect(writeTranslationCache("key", { ...value, variants: [] })).rejects.toThrow();
  expect(pool.query).not.toHaveBeenCalled();
  vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
  await writeTranslationCache("key", value);
  expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("7 days");
  expect(vi.mocked(pool.query).mock.calls[1][0]).toContain("offset 1000");
});
