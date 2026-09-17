import { expect, it } from "vitest";
import { dailyPracticeDeck, practiceDay, type PracticePhrase } from "@/lib/study-practice";

import { tones } from "@/lib/translation-contract";

const savedPhrases: PracticePhrase[] = Array.from({ length: 15 }, (_, index) => ({
  id: `saved-${index}`,
  sourceText: `저장 문장 ${index}`,
  translatedText: `Saved sentence ${index}.`,
  targetLanguage: "en",
  tone: tones[index % tones.length],
  contextNote: "테스트용 어투 설명",
}));

it("changes at Korean midnight", () => {
  expect(practiceDay(new Date("2026-09-10T15:00:00Z"))).toBe(practiceDay(new Date("2026-09-10T14:59:59Z")) + 1);
});
it("keeps today's saved practice stable and selects different saved phrases tomorrow", () => {
  for (const kind of ["quiz", "puzzle"] as const) {
    const today = dailyPracticeDeck(savedPhrases, 20000, kind);
    const tomorrow = dailyPracticeDeck(savedPhrases, 20001, kind);
    expect(today).toEqual(dailyPracticeDeck(savedPhrases, 20000, kind));
    expect(today).toHaveLength(5);
    expect(tomorrow.every(p => !today.some(t => t.id === p.id))).toBe(true);
    expect(new Set(today.map(p => p.tone)).size).toBe(5);
  }
});
it("handles empty and small saved collections without duplicate questions", () => {
  expect(dailyPracticeDeck([], 1, "quiz")).toEqual([]);
  expect(new Set(dailyPracticeDeck(savedPhrases.slice(0, 3), 1, "puzzle").map(p => p.id)).size).toBe(3);
});
