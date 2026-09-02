import { z } from "zod";
import { languageCodes } from "@/lib/languages";

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, "이름을 입력해 주세요.").max(80),
  defaultTargetLanguage: z.enum(languageCodes),
  dailyStudyGoal: z.coerce.number().int().min(1).max(100),
});
