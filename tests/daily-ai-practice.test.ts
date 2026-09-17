import { expect, it } from "vitest";
import { validateDailyReply } from "@/lib/daily-ai-practice";
import { tones } from "@/lib/translation-contract";
const input = { phrases: tones.map((tone) => ({
  sourceText: `${tone} 예문`,
  translatedText: `This is a ${tone} sentence.`,
  tone,
  contextNote: "테스트용 어투 설명",
})) };
it("accepts five distinct tones and supplies exercise identifiers", () => {
  const result = validateDailyReply(input, []);
  expect(result).toHaveLength(5);
  expect(result.every(p => p.id.startsWith("ai-") && p.targetLanguage === "en")).toBe(true);
});
it("rejects a recent sentence even with punctuation and case changes", () => {
  expect(() => validateDailyReply(input, [input.phrases[0].translatedText.toUpperCase()])).toThrow();
});
it("rejects duplicate questions and missing tones", () => {
  expect(() => validateDailyReply({ phrases: Array(5).fill(input.phrases[0]) }, [])).toThrow();
});
