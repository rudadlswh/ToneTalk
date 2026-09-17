import { z } from "zod";
export const aiUsageSchema = z.object({
  used: z.number().int().nonnegative(), limit: z.number().int().positive(), remaining: z.number().int().nonnegative(),
  resetsAt: z.iso.datetime(), enabled: z.boolean(), available: z.boolean(), retryAfterSeconds: z.number().int().nonnegative(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;
