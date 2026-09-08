import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LyricStudyCard } from "@/components/lyric-study-card";
import { lyricExplanationRequestSchema, parseLyricExplanation, type LyricExplanation } from "@/lib/lyric-explanation";

const input = lyricExplanationRequestSchema.parse({ action: "explain", text: "青い空を見た", sourceLanguage: "ja" });
const detail: LyricExplanation = {
  segments: [{ text: "青", reading: "あお" }, { text: "い", reading: "" }, { text: "空", reading: "そら" }, { text: "を", reading: "" }, { text: "見", reading: "み" }, { text: "た", reading: "" }],
  words: [{ text: "空", reading: "そら", hangulPronunciation: "소라", meaning: "하늘", grammar: "명사로, を 앞에서 보는 대상을 나타내요." }],
  nuance: "푸른 하늘을 보았다는 과거의 경험을 나타내요.",
};

describe("lyric explanations", () => {
  it("validates original-preserving furigana and contextual vocabulary", () => {
    expect(parseLyricExplanation(detail, input)).toEqual(detail);
  });
  it("rejects altered original text, missing Kanji readings and non-kana furigana", () => {
    for (const segments of [[{ text: "青い星", reading: "あおいほし" }], [{ text: input.text, reading: "" }], [{ text: input.text, reading: "aoi sora" }]]) {
      expect(() => parseLyricExplanation({ ...detail, segments }, input)).toThrow();
    }
  });
  it("rejects vocabulary outside the source, duplicates and untranslated explanations", () => {
    expect(() => parseLyricExplanation({ ...detail, words: [{ ...detail.words[0], text: "海" }] }, input)).toThrow();
    expect(() => parseLyricExplanation({ ...detail, words: [detail.words[0], detail.words[0]] }, input)).toThrow();
    expect(() => parseLyricExplanation({ ...detail, nuance: "blue sky" }, input)).toThrow();
  });
  it("preserves spaces and punctuation for non-Japanese input", () => {
    const english = { ...input, text: "Blue sky!", sourceLanguage: "en" as const };
    const result = { ...detail, segments: [{ text: "Blue ", reading: "" }, { text: "sky!", reading: "" }], words: [{ ...detail.words[0], text: "sky", reading: "sky" }] };
    expect(parseLyricExplanation(result, english)).toEqual(result);
    expect(() => parseLyricExplanation({ ...result, segments: [{ text: "Bluesky!", reading: "" }] }, english)).toThrow();
  });
  it("renders semantic ruby, highlighted translation, vocabulary and toggle states", () => {
    const props = { text: input.text, result: { id: 0, sourceLanguage: "ja" as const, translation: "푸른 하늘을 봤어", romanization: "Aoi sora o mita", hangulPronunciation: "아오이 소라 오 미타" }, targetLanguage: "ko", explanation: detail, showRomanization: true, showHangul: true };
    const html = renderToStaticMarkup(createElement(LyricStudyCard, props));
    expect(html).toContain("<rt>そら</rt>");
    expect(html).toContain("단어 · 표현 풀이");
    expect(html).toContain("Aoi sora o mita");
    expect(html).toContain("아오이 소라 오 미타");
    const hidden = renderToStaticMarkup(createElement(LyricStudyCard, { ...props, showRomanization: false, showHangul: false }));
    expect(hidden).not.toContain("Aoi sora o mita");
    expect(hidden).not.toContain("아오이 소라 오 미타");
    expect(hidden).toContain("<rt>そら</rt>");
  });
});
