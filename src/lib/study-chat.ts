import { z } from "zod";
import { roleplayReplySchema, roleplayRequestSchema } from "@/lib/study-practice";

export const chatStartSchema = z.object({
  scenario: roleplayRequestSchema.shape.scenario, language: roleplayRequestSchema.shape.language,
}).strict();
export const chatTurnSchema = roleplayRequestSchema.and(z.object({ sessionId: z.uuid(), eventId: z.uuid() }));
export type ChatTurnInput = z.infer<typeof chatTurnSchema>;
export const chatReceiptSchema = z.object({
  sessionId: z.uuid(), turns: z.number().int().min(1).max(4), replayed: z.boolean(),
  response: roleplayReplySchema.nullable(), points: z.number().int().nonnegative(), totalPoints: z.number().int().nonnegative(),
});
