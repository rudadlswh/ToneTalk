import { z } from "zod";
import { languageCodes, sourceLanguageCodes } from "@/lib/languages";

export const lyricsLimits = { characters: 6000, lines: 80, lineLength: 200, batch: 10 } as const;

// Keep blank lines and repeated choruses in their original positions.
export function splitLyrics(text: string) {
  return text.replace(/\r\n?/g, "\n").trim().split("\n").map((text, id) => ({ id, text: text.trim() }));
}

export function lyricsInputError(text: string): string | null {
  if (!text.trim()) return "번역할 가사를 붙여 넣어 주세요.";
  if (text.length > lyricsLimits.characters) return "가사는 6,000자 이하로 입력해 주세요.";
  const lines = splitLyrics(text);
  if (lines.length > lyricsLimits.lines) return "가사는 빈 줄을 포함해 80줄 이하로 입력해 주세요.";
  if (lines.some((line) => line.text.length > lyricsLimits.lineLength)) return "한 줄이 200자를 넘으면 줄바꿈으로 나눠 주세요.";
  return null;
}

export const lyricsRequestSchema = z.object({
  sourceLanguage: z.enum(sourceLanguageCodes).default("auto"),
  targetLanguage: z.enum(languageCodes).default("ko"),
  lines: z.array(z.object({
    id: z.number().int().min(0).max(79),
    text: z.string().trim().min(1).max(lyricsLimits.lineLength),
  })).min(1).max(lyricsLimits.batch),
}).refine((input) => new Set(input.lines.map((line) => line.id)).size === input.lines.length, "중복된 줄 번호입니다.");

export const lyricResultSchema = z.object({
  id: z.number().int().min(0).max(79),
  sourceLanguage: z.enum(languageCodes),
  translation: z.string().trim().min(1).max(800),
  romanization: z.string().trim().min(1).max(800)
    .regex(/\p{Script=Latin}/u)
    .regex(/^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{Zs}]+$/u),
  hangulPronunciation: z.string().trim().min(1).max(800)
    .regex(/[가-힣]/u)
    .regex(/^[\p{Script=Hangul}\p{N}\p{P}\p{Zs}]+$/u),
});

export const lyricsReplySchema = z.object({ lines: z.array(lyricResultSchema).min(1).max(lyricsLimits.batch) });
export type LyricsRequest = z.infer<typeof lyricsRequestSchema>;
export type LyricResult = z.infer<typeof lyricResultSchema>;

export function parseLyricsReply(value: unknown, input: LyricsRequest) {
  const result = lyricsReplySchema.parse(value);
  if (result.lines.length !== input.lines.length || new Set(result.lines.map((line) => line.id)).size !== input.lines.length) {
    throw new Error("Missing or duplicate lyric lines");
  }
  return input.lines.map((source) => {
    const line = result.lines.find((line) => line.id === source.id);
    if (!line || (input.sourceLanguage !== "auto" && line.sourceLanguage !== input.sourceLanguage)) throw new Error("Mismatched lyric line");
    return line;
  });
}
