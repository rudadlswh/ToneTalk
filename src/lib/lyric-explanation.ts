import { z } from "zod";
import { languageCodes } from "@/lib/languages";

export const lyricExplanationRequestSchema = z.object({
  action: z.literal("explain"),
  text: z.string().trim().min(1).max(200),
  sourceLanguage: z.enum(languageCodes),
});

const koreanExplanation = z.string().trim().min(1).max(240).regex(/[가-힣]/u);
export const lyricExplanationSchema = z.object({
  segments: z.array(z.object({
    text: z.string().min(1).max(200),
    reading: z.string().max(200),
  })).min(1).max(60),
  words: z.array(z.object({
    text: z.string().trim().min(1).max(200),
    reading: z.string().trim().max(200),
    hangulPronunciation: z.string().trim().min(1).max(200).regex(/^[가-힣 .,!?'-]+$/u).regex(/[가-힣]/u),
    meaning: koreanExplanation,
    grammar: koreanExplanation,
  })).min(1).max(8),
  nuance: koreanExplanation,
});

export type LyricExplanationRequest = z.infer<typeof lyricExplanationRequestSchema>;
export type LyricExplanation = z.infer<typeof lyricExplanationSchema>;

const hasKanji = (text: string) => /[\u3400-\u9fff]/u.test(text);
const kanaReading = (text: string) => /^[ぁ-ゖァ-ヺー ・]+$/u.test(text);

export function parseLyricExplanation(value: unknown, input: LyricExplanationRequest) {
  const result = lyricExplanationSchema.parse(value);
  if (result.segments.map((segment) => segment.text).join("") !== input.text) throw new Error("The model changed the original text");
  if (result.words.some((word) => !input.text.includes(word.text)) || new Set(result.words.map((word) => word.text)).size !== result.words.length) throw new Error("Invalid vocabulary references");
  if (input.sourceLanguage === "ja") {
    for (const segment of result.segments) {
      if ((hasKanji(segment.text) && !segment.reading) || (segment.reading && !kanaReading(segment.reading))) throw new Error("Invalid furigana");
    }
    for (const word of result.words) {
      if (!kanaReading(word.reading)) throw new Error("Invalid word reading");
    }
  }
  return result;
}
