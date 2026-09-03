import { describe, expect, it } from "vitest";
import {
  normalizeVariants,
  ollamaTranslationSchema,
  translateRequestSchema,
  tones,
} from "@/lib/translation-contract";

const validOutput = Object.fromEntries(
  tones.map((tone) => [tone, `${tone} translation`]),
) as Record<(typeof tones)[number], string> & { sourceLanguage: "en" };
validOutput.sourceLanguage = "en";

describe("translation contract", () => {
  it("accepts a valid translation request", () => {
    expect(
      translateRequestSchema.parse({
        sourceText: "  Thank you  ",
        sourceLanguage: "auto",
        targetLanguage: "ko",
      }),
    ).toEqual({ sourceText: "Thank you", sourceLanguage: "auto", targetLanguage: "ko" });
  });

  it("rejects blank and oversized source text", () => {
    expect(() =>
      translateRequestSchema.parse({ sourceText: "   ", targetLanguage: "ja" }),
    ).toThrow();
    expect(() =>
      translateRequestSchema.parse({
        sourceText: "a".repeat(501),
        targetLanguage: "ja",
      }),
    ).toThrow();
  });

  it("defaults to automatic detection for older clients", () => {
    expect(
      translateRequestSchema.parse({
        sourceText: "Bonjour",
        targetLanguage: "ko",
      }).sourceLanguage,
    ).toBe("auto");
  });

  it("rejects identical manually selected languages", () => {
    expect(() =>
      translateRequestSchema.parse({
        sourceText: "Bonjour",
        sourceLanguage: "fr",
        targetLanguage: "fr",
      }),
    ).toThrow();
  });

  it("validates and preserves the canonical tone order", () => {
    const parsed = ollamaTranslationSchema.parse(validOutput);
    expect(normalizeVariants(parsed).map((variant) => variant.tone)).toEqual(tones);
  });

  it("rejects an output with a missing tone", () => {
    const missingTone: Partial<typeof validOutput> = { ...validOutput };
    delete missingTone.written;
    expect(() => ollamaTranslationSchema.parse(missingTone)).toThrow();
  });
});
