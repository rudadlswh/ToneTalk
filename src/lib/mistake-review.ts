import { z } from "zod";
import { dailyKindSchema, dailyResultSchema, practicePhraseSchema, practiceSourceSchema } from "@/lib/daily-ai-practice";
import { tones } from "@/lib/translation-contract";

export const mistakeCursorSchema = z.string().max(80).regex(/^[1-9]\d{0,9}\|[0-9a-f-]{36}\|[0-4]$/i).transform(value => {
  const [day, setId, questionIndex] = value.split("|");
  return { day: Number(day), setId, questionIndex: Number(questionIndex) };
}).pipe(z.object({ day: z.number().int().positive().max(2147483647), setId: z.uuid(), questionIndex: z.number().int().min(0).max(4) }));
export const mistakeQuerySchema = z.object({
  kind: z.enum(["all", "quiz", "puzzle"]).default("all"),
  tone: z.enum(["all", ...tones]).default("all"),
  status: z.enum(["pending", "resolved", "all"]).default("pending"),
  cursor: mistakeCursorSchema.optional(),
}).strict();
export type MistakeQuery = z.infer<typeof mistakeQuerySchema>;
export const mistakeItemSchema = z.object({
  setId: z.uuid(), day: z.number().int().positive(), kind: dailyKindSchema, source: practiceSourceSchema,
  questionIndex: z.number().int().min(0).max(4), phrase: practicePhraseSchema,
  original: dailyResultSchema, review: dailyResultSchema.nullable(),
});
export type MistakeItem = z.infer<typeof mistakeItemSchema>;
export const mistakeListSchema = z.object({ items: z.array(mistakeItemSchema).max(20), nextCursor: z.string().nullable() });
export const mistakeReceiptSchema = z.object({ result: dailyResultSchema, replayed: z.boolean(), points: z.literal(0) });
