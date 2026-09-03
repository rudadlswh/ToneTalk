import { describe, expect, it } from "vitest";
import { getLanguage, languages } from "@/lib/languages";
import { macSystemVoices, ttsRequestSchema } from "@/lib/tts-contract";

describe("language speech metadata", () => {
  it("provides a speech locale for every supported language", () => {
    for (const language of languages) {
      expect(language.speechLocale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(getLanguage(language.code)?.speechLocale).toBe(
        language.speechLocale,
      );
    }
  });

  it("keeps language and speech locale codes unique", () => {
    expect(new Set(languages.map((language) => language.code)).size).toBe(
      languages.length,
    );
    expect(
      new Set(languages.map((language) => language.speechLocale)).size,
    ).toBe(languages.length);
  });

  it("maps every supported language to a macOS voice", () => {
    expect(Object.keys(macSystemVoices).sort()).toEqual(
      languages.map((language) => language.code).sort(),
    );
  });

  it("validates and trims local TTS requests", () => {
    expect(
      ttsRequestSchema.parse({ text: "  안녕하세요  ", language: "ko" }),
    ).toEqual({ text: "안녕하세요", language: "ko" });
    expect(() =>
      ttsRequestSchema.parse({ text: "", language: "ko" }),
    ).toThrow();
  });
});
