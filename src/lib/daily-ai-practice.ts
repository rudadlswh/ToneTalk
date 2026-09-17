import { z } from "zod";
import { tones } from "@/lib/translation-contract";
import { languageCodes } from "@/lib/languages";
import { isPuzzleCorrect, practiceDay, puzzleWords, type PracticePhrase } from "@/lib/study-practice";

const dailyPhraseSchema = z.object({
  sourceText: z.string().trim().min(1).max(200),
  translatedText: z.string().trim().min(1).max(200),
  tone: z.enum(tones),
  contextNote: z.string().trim().min(1).max(400),
});
export const dailyReplySchema = z.object({ phrases: z.array(dailyPhraseSchema).length(5) });
export const practiceSourceSchema = z.enum(["daily", "saved"]);
export type PracticeSource = z.infer<typeof practiceSourceSchema>;
export const dailyInputSchema = z.object({
  kind: z.enum(["quiz", "puzzle"]),
  source: practiceSourceSchema.default("daily"),
  exclude: z.array(z.string().max(200)).max(150).default([]),
});
const normalizePracticeText = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
export function validateDailyReply(value: unknown, exclude: string[], day = practiceDay()) {
  const parsed = dailyReplySchema.parse(value);
  const texts = parsed.phrases.map(p => normalizePracticeText(p.translatedText));
  const previous = new Set(exclude.map(normalizePracticeText));
  if (new Set(texts).size !== 5 || texts.some(t => !t || previous.has(t)) ||
      new Set(parsed.phrases.map(p => p.tone)).size !== 5) throw new Error("Repeated or incomplete practice set");
  return parsed.phrases.map((p, index) => ({ ...p, id: `ai-${day}-${index}-${texts[index]}`, targetLanguage: "en" }));
}

export const dailyKindSchema = z.enum(["quiz", "puzzle"]);
export type DailyKind = z.infer<typeof dailyKindSchema>;
export const dailyAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("quiz"), tone: z.enum(tones) }).strict(),
  z.object({ type: z.literal("puzzle"), order: z.array(z.number().int().min(0).max(23)).min(2).max(24) }).strict(),
  z.object({ type: z.literal("reveal") }).strict(),
]);
export type DailyAnswer = z.infer<typeof dailyAnswerSchema>;
export const dailyAttemptInputSchema = z.object({
  eventId: z.uuid(), setId: z.uuid(), questionIndex: z.number().int().min(0).max(4), answer: dailyAnswerSchema,
}).strict();
export type DailyAttemptInput = z.infer<typeof dailyAttemptInputSchema>;
export const dailyResultSchema = z.object({
  eventId: z.uuid(), questionIndex: z.number().int().min(0).max(4), answer: dailyAnswerSchema,
  outcome: z.enum(["correct", "wrong", "revealed"]), attemptNumber: z.number().int().positive(),
});
export type DailyResult = z.infer<typeof dailyResultSchema>;
export const practicePhraseSchema = dailyPhraseSchema.extend({
  id: z.string().min(1).max(240), targetLanguage: z.enum(languageCodes),
  sourceText: z.string().min(1).max(500), translatedText: z.string().min(1).max(2000), contextNote: z.string().max(2000),
});
export const dailyPracticeSchema = z.object({
  id: z.uuid(), day: z.number().int().positive(), kind: dailyKindSchema,
  source: practiceSourceSchema.default("daily"),
  phrases: z.array(practicePhraseSchema).min(1).max(5),
  results: z.array(dailyResultSchema).max(5),
}).refine(value => value.source === "saved" || value.phrases.length === 5, "Daily AI sets contain exactly five questions");
export type DailyPractice = z.infer<typeof dailyPracticeSchema>;
export const dailyAttemptResponseSchema = z.object({
  result: dailyResultSchema, awarded: z.boolean(), points: z.number().int().nonnegative(), totalPoints: z.number().int().nonnegative(),
});
export function isDailyComplete(kind: DailyKind, result?: DailyResult) {
  return Boolean(result && (kind === "quiz" || result.outcome !== "wrong"));
}
export function nextDailyQuestion(practice: DailyPractice, start = 0) {
  const next = practice.phrases.findIndex((_, index) => index >= start && !isDailyComplete(practice.kind, practice.results.find(r => r.questionIndex === index)));
  return next < 0 ? practice.phrases.length : next;
}
export function gradeDailyAnswer(kind: DailyKind, phrase: PracticePhrase, answer: DailyAnswer): DailyResult["outcome"] {
  if (kind === "quiz" && answer.type === "quiz") return answer.tone === phrase.tone ? "correct" : "wrong";
  if (kind === "puzzle" && answer.type === "reveal") return "revealed";
  if (kind !== "puzzle" || answer.type !== "puzzle") throw new Error("Answer kind mismatch");
  const words = puzzleWords(phrase.translatedText, phrase.targetLanguage);
  if (answer.order.length !== words.length || new Set(answer.order).size !== words.length || answer.order.some(i => i >= words.length)) throw new Error("Invalid word order");
  return isPuzzleCorrect(answer.order.map(i => words[i]), words) ? "correct" : "wrong";
}
