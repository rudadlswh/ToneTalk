import { z } from "zod";
import { languageCodes, type LanguageCode } from "@/lib/languages";

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1, "읽을 문장이 없습니다.").max(1200),
  language: z.enum(languageCodes),
});

export const macSystemVoices: Record<LanguageCode, string> = {
  en: "Samantha",
  ja: "Kyoko",
  ko: "Yuna",
  fr: "Thomas",
  es: "Mónica",
  "zh-CN": "Tingting",
  de: "Anna",
};
