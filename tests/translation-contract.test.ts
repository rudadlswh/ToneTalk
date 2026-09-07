import { describe, expect, it } from "vitest";
import {
  normalizeVariants,
  ollamaTranslationSchema,
  translateRequestSchema,
  tones,
} from "@/lib/translation-contract";

const validOutput = Object.fromEntries(
  tones.map((tone) => [tone, {
    translatedText: `${tone} translation`,
    romanization: `${tone} pronunciation`,
    hangulPronunciation: "발음 표기",
  }]),
) as Record<string, unknown>;
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
    const variants = normalizeVariants(parsed);
    expect(variants.map((variant) => variant.tone)).toEqual(tones);
    expect(variants[0]).toMatchObject({
      transliteration: "casual pronunciation",
      hangulPronunciation: "발음 표기",
    });
  });

  it("rejects an output with a missing tone", () => {
    const missingTone = { ...validOutput };
    delete missingTone.written;
    expect(() => ollamaTranslationSchema.parse(missingTone)).toThrow();
  });

  it("rejects pronunciation values written in the wrong scripts", () => {
    expect(() => ollamaTranslationSchema.parse({
      ...validOutput,
      casual: {
        translatedText: "casual translation",
        romanization: "캐주얼",
        hangulPronunciation: "casual",
      },
    })).toThrow();

    const sanitized = ollamaTranslationSchema.parse({
      ...validOutput,
      formal: {
        translatedText: "誠にありがとうございます。",
        romanization: "誠に arigatou gozaimasu",
        hangulPronunciation: "마코토니 아리가とう고자이마스",
      },
    });
    expect(sanitized.formal.romanization).toBe("arigatou gozaimasu");
    expect(sanitized.formal.hangulPronunciation).toBe("마코토니 아리가 고자이마스");
  });
});
