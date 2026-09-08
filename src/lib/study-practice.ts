import { z } from "zod";
import { languageCodes } from "@/lib/languages";
import { tones, type Tone } from "@/lib/translation-contract";

export const practiceTones: Record<Tone, { label: string; explanation: string }> = {
  casual: { label: "친구체", explanation: "친한 사람과 편안하게 말할 때 쓰는 표현이에요." },
  polite: { label: "공손체", explanation: "상대에게 예의를 갖추는 일상적인 표현이에요." },
  formal: { label: "격식체", explanation: "공식적인 자리나 업무 상황에 어울리는 표현이에요." },
  slang: { label: "슬랭", explanation: "아주 친한 사이에서 쓰는 구어적 표현이에요. 낯선 상대에게는 주의하세요." },
  written: { label: "문어체", explanation: "대화보다 이메일이나 글에 어울리는 표현이에요." },
};

export type PracticePhrase = {
  id: string;
  sourceText: string;
  translatedText: string;
  targetLanguage: string;
  tone: Tone;
  contextNote: string;
};

// Reviewed starter examples keep the activities usable before the first save.
export const starterPhrases: PracticePhrase[] = [
  { id: "demo-casual", sourceText: "친구에게: 나중에 보자!", translatedText: "See you later!", targetLanguage: "en", tone: "casual", contextNote: "짧고 편안한 작별 인사로 친구 사이에 자연스러워요." },
  { id: "demo-polite", sourceText: "낯선 사람에게: 잠시 도와주실 수 있나요?", translatedText: "Could you help me for a moment, please?", targetLanguage: "en", tone: "polite", contextNote: "Could you와 please로 부탁을 부드럽고 공손하게 만들어요." },
  { id: "demo-formal", sourceText: "공식 회의에서: 참석해 주셔서 감사합니다.", translatedText: "We sincerely appreciate your attendance today.", targetLanguage: "en", tone: "formal", contextNote: "sincerely appreciate와 attendance가 공식적인 분위기를 만들어요." },
  { id: "demo-slang", sourceText: "친한 친구에게: 뭐 해?", translatedText: "Yo, what's up?", targetLanguage: "en", tone: "slang", contextNote: "Yo는 매우 비격식적인 인사예요. 업무나 공식적인 자리에는 피하세요." },
  { id: "demo-written", sourceText: "이메일에서: 요청하신 서류를 첨부합니다.", translatedText: "Please find the requested documents attached.", targetLanguage: "en", tone: "written", contextNote: "첨부 문서를 안내하는 전형적인 이메일 문구예요. 공손체와 겹칠 수도 있어요." },
];

export function shuffle<T>(values: readonly T[], random = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function quizOptions(answer: Tone): Tone[] {
  return shuffle([answer, ...shuffle(tones.filter((tone) => tone !== answer)).slice(0, 3)]);
}

const segmenters = new Map<string, Intl.Segmenter>();

export function puzzleWords(text: string, language: string): string[] {
  // Segment words for Japanese/Chinese too; punctuation stays with its word.
  const locale = languageCodes.find((code) => code === language) ?? "en";
  let segmenter = segmenters.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, segmenter);
  }
  const segments = segmenter.segment(text);
  const words: string[] = [];
  let prefix = "";
  for (const part of segments) {
    if (part.isWordLike) {
      words.push(prefix + part.segment);
      prefix = "";
    } else if (part.segment.trim()) {
      if (words.length) words[words.length - 1] += part.segment;
      else prefix += part.segment;
    }
  }
  return words;
}

export function isPuzzleCorrect(words: string[], answer: string[]) {
  return words.length === answer.length && words.every((word, index) => word === answer[index]);
}

export const scenarios = {
  cafe: { label: "카페 주문", role: "a cafe barista", goal: "음료와 크기를 정하고 공손하게 주문해 보세요.", situation: "The learner is ordering a drink at your cafe. Ask about their order." },
  meeting: { label: "비즈니스 회의", role: "a colleague in a project meeting", goal: "프로젝트 일정을 제안하고 상대의 의견을 물어보세요.", situation: "Discuss a project deadline professionally with the learner." },
  friends: { label: "친구와 약속", role: "a close friend", goal: "친구에게 주말 계획을 제안하고 약속을 잡아보세요.", situation: "Make weekend plans with the learner in a friendly casual tone." },
} as const;

export const roleplayRequestSchema = z.object({
  scenario: z.enum(["cafe", "meeting", "friends"]),
  language: z.enum(languageCodes),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(1200),
  })).min(1).max(7),
}).superRefine((value, context) => {
  if (value.messages.some((message, index) => message.role !== (index % 2 === 0 ? "user" : "assistant"))) {
    context.addIssue({ code: "custom", path: ["messages"], message: "대화 순서가 올바르지 않습니다." });
  }
  if (value.messages.at(-1)?.role !== "user") {
    context.addIssue({ code: "custom", path: ["messages"], message: "마지막 메시지는 사용자 발화여야 합니다." });
  }
});

export const roleplayReplySchema = z.object({
  reply: z.string().trim().min(1).max(1200),
  feedback: z.string().trim().min(1).max(800),
  suggestion: z.string().trim().min(1).max(800),
});

export function matchesPracticeLanguage(text: string, language: string) {
  if (language === "ja") return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text) && !/[\uac00-\ud7af]/u.test(text);
  if (language === "ko") return /[\uac00-\ud7af]/u.test(text);
  if (language === "zh-CN") return /[\u3400-\u9fff]/u.test(text) && !/[\u3040-\u30ff\uac00-\ud7af]/u.test(text);
  // Script checks catch common cross-language failures, not semantic accuracy.
  return /[a-z]/iu.test(text) && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text);
}
export type RoleplayRequest = z.infer<typeof roleplayRequestSchema>;
export type RoleplayReply = z.infer<typeof roleplayReplySchema>;
