import { z } from "zod";
import { languageCodes, sourceLanguageCodes } from "@/lib/languages";

export const tones = [
  "casual",
  "polite",
  "formal",
  "slang",
  "written",
] as const;

export type Tone = (typeof tones)[number];

const contextNotes: Record<Tone, string> = {
  casual: "친한 친구나 가까운 사이에서 편하게 말할 때",
  polite: "낯선 사람에게 예의를 갖춰 말할 때",
  formal: "업무나 공식적인 상황에서 격식을 갖출 때",
  slang: "친한 사이에서 자연스러운 구어체로 말할 때",
  written: "이메일이나 글로 자연스럽게 표현할 때",
};

export const translateRequestSchema = z.object({
  sourceText: z
    .string()
    .trim()
    .min(1, "번역할 문장을 입력해 주세요.")
    .max(500, "문장은 500자 이하로 입력해 주세요."),
  sourceLanguage: z.enum(sourceLanguageCodes).default("auto"),
  targetLanguage: z.enum(languageCodes),
}).superRefine((input, context) => {
  if (input.sourceLanguage !== "auto" && input.sourceLanguage === input.targetLanguage) {
    context.addIssue({
      code: "custom",
      path: ["targetLanguage"],
      message: "입력 언어와 번역 언어를 다르게 선택해 주세요.",
    });
  }
});

export const translationVariantSchema = z.object({
  tone: z.enum(tones),
  translatedText: z.string().trim().min(1).max(1200),
  transliteration: z.string().trim().max(1200).nullable(),
  hangulPronunciation: z.string().trim().max(1200).nullable(),
  contextNote: z.string().trim().min(1).max(240),
  warning: z.string().trim().max(240).nullable(),
});

const modelTextSchema = z.string().trim().min(1).max(1200);
const forbiddenAsianScriptPattern = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af]/gu;
const hangulPronunciationAllowedPattern = /[^\u1100-\u11ff\u3130-\u318f\uac00-\ud7af0-9\s.,!?"'()\-:;·…]/gu;

const romanizationSchema = modelTextSchema
  .transform((value) => value.replace(forbiddenAsianScriptPattern, " ").replace(/\s+/g, " ").trim())
  .pipe(modelTextSchema)
  .refine(
  (value) =>
    /[a-z]/iu.test(value),
  "로마자 발음에는 한중일 문자를 사용할 수 없습니다.",
);
const hangulPronunciationSchema = modelTextSchema
  .transform((value) => value.replace(hangulPronunciationAllowedPattern, " ").replace(/\s+/g, " ").trim())
  .pipe(modelTextSchema)
  .refine(
  (value) =>
    /[\uac00-\ud7af]/u.test(value),
  "한글 발음에는 한글과 문장부호만 사용할 수 있습니다.",
);
const ollamaToneSchema = z.object({
  translatedText: modelTextSchema,
  romanization: romanizationSchema,
  hangulPronunciation: hangulPronunciationSchema,
});

export const ollamaTranslationSchema = z.object({
  sourceLanguage: z.enum(languageCodes),
  casual: ollamaToneSchema,
  polite: ollamaToneSchema,
  formal: ollamaToneSchema,
  slang: ollamaToneSchema,
  written: ollamaToneSchema,
});

export type TranslationVariant = z.infer<typeof translationVariantSchema>;

export function normalizeVariants(
  output: z.infer<typeof ollamaTranslationSchema>,
): TranslationVariant[] {
  return tones.map((tone) => ({
    tone,
    translatedText: output[tone].translatedText,
    transliteration: output[tone].romanization,
    hangulPronunciation: output[tone].hangulPronunciation,
    contextNote: contextNotes[tone],
    warning:
      tone === "slang"
        ? "상대와 상황에 따라 가볍거나 무례하게 들릴 수 있어요."
        : null,
  }));
}
