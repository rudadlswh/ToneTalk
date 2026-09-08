// Decoder constraints supplement, but never replace, semantic validation.
const tone = {
  type: "object",
  properties: {
    translatedText: { type: "string" },
    romanization: { type: "string", pattern: "^[A-Za-zÀ-ž0-9 .,!?'-]+$" },
    hangulPronunciation: { type: "string", pattern: "^[가-힣0-9 .,!?'-]+$" },
  },
  required: ["translatedText", "romanization", "hangulPronunciation"],
  additionalProperties: false,
};
export const translationFormat = {
  type: "object",
  properties: {
    sourceLanguage: { type: "string", enum: ["en", "ja", "ko", "fr", "es", "zh-CN", "de"] },
    casual: tone, polite: tone, formal: tone, slang: tone, written: tone,
  },
  required: ["sourceLanguage", "casual", "polite", "formal", "slang", "written"],
  additionalProperties: false,
};
