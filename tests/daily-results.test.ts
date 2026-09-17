import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { dailyAttemptInputSchema, dailyPracticeSchema, gradeDailyAnswer, isDailyComplete, nextDailyQuestion, type DailyPractice } from "@/lib/daily-ai-practice";
import { puzzleWords } from "@/lib/study-practice";
import { tones } from "@/lib/translation-contract";

const practice: DailyPractice = { id: randomUUID(), day: 20000, kind: "quiz", source: "daily", results: [], phrases: tones.map(tone => ({ id: tone, tone, sourceText: "예문", translatedText: "You said you would help.", contextNote: "해설", targetLanguage: "en" })) };
it("allows small saved sets without relaxing the five-question AI contract", () => {
  const small = { ...practice, phrases: practice.phrases.slice(0, 1) };
  expect(dailyPracticeSchema.safeParse(small).success).toBe(false);
  expect(dailyPracticeSchema.safeParse({ ...small, source: "saved" }).success).toBe(true);
});
it("resumes after a first quiz choice, but resumes an incorrect puzzle on the same question", () => {
  const wrong = { eventId: randomUUID(), questionIndex: 0, attemptNumber: 1, answer: { type: "quiz" as const, tone: "formal" as const }, outcome: "wrong" as const };
  expect(nextDailyQuestion({ ...practice, results: [wrong] })).toBe(1);
  expect(nextDailyQuestion({ ...practice, kind: "puzzle", results: [wrong] })).toBe(0);
  expect(isDailyComplete("puzzle", { ...wrong, outcome: "revealed" })).toBe(true);
  expect(nextDailyQuestion({ ...practice, results: practice.phrases.map((_, i) => ({ ...wrong, questionIndex: i })) })).toBe(5);
});
it("grades stored data, validates a complete permutation and treats identical words equivalently", () => {
  const phrase = practice.phrases[0];
  const order = puzzleWords(phrase.translatedText, "en").map((_, i) => i);
  expect(gradeDailyAnswer("quiz", phrase, { type: "quiz", tone: phrase.tone })).toBe("correct");
  expect(gradeDailyAnswer("puzzle", phrase, { type: "puzzle", order })).toBe("correct");
  expect(gradeDailyAnswer("puzzle", phrase, { type: "puzzle", order: order.toReversed() })).toBe("wrong");
  expect(() => gradeDailyAnswer("puzzle", phrase, { type: "puzzle", order: order.map(() => 0) })).toThrow();
  expect(() => gradeDailyAnswer("quiz", phrase, { type: "reveal" })).toThrow();
  const repeated = { ...phrase, translatedText: "Go Go now." };
  expect(gradeDailyAnswer("puzzle", repeated, { type: "puzzle", order: [1, 0, 2] })).toBe("correct");
});
it("rejects forged owners, rewards, outcomes and malformed question positions", () => {
  const input = { eventId: randomUUID(), setId: randomUUID(), questionIndex: 0, answer: { type: "quiz", tone: "casual" } };
  expect(dailyAttemptInputSchema.safeParse(input).success).toBe(true);
  for (const extra of [{ ownerId: "other" }, { points: 999 }, { outcome: "correct" }, { questionIndex: 5 }, { answer: { type: "puzzle", order: [-1, 2] } }]) {
    expect(dailyAttemptInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  }
});
