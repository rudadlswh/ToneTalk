import { z } from "zod";
import { languageCodes } from "@/lib/languages";
import { tones, type Tone } from "@/lib/translation-contract";

export const practiceTones: Record<Tone, { label: string; explanation: string }> = {
  casual: { label: "일상 표현", explanation: "친한 사람과 편안하게 말할 때 쓰는 표현이에요." },
  polite: { label: "공손한 표현", explanation: "상대에게 예의를 갖추는 일상적인 표현이에요." },
  formal: { label: "공식적인 표현", explanation: "공식적인 자리나 업무 상황에 어울리는 표현이에요." },
  slang: { label: "슬랭", explanation: "아주 친한 사이에서 쓰는 구어적 표현이에요. 낯선 상대에게는 주의하세요." },
  written: { label: "글쓰기 표현", explanation: "대화보다 이메일이나 글에 어울리는 표현이에요." },
};

export type PracticePhrase = {
  id: string;
  sourceText: string;
  translatedText: string;
  targetLanguage: string;
  tone: Tone;
  contextNote: string;
};

export function shuffle<T>(values: readonly T[], random = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function practiceDay(now = new Date()): number {
  // Calendar day in Korea, independent of the browser's timezone.
  return Math.floor((now.getTime() + 9 * 60 * 60 * 1000) / 86_400_000);
}

export function dailyPracticeDeck(values: readonly PracticePhrase[], day: number, kind: "quiz" | "puzzle") {
  if (!values.length) return [];
  const count = Math.min(5, values.length);
  const step = values.length > 5 ? 5 : 1;
  const offset = ((day * step + (kind === "puzzle" ? 5 : 0)) % values.length + values.length) % values.length;
  return Array.from({ length: count }, (_, i) => values[(offset + i) % values.length]);
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

export const scenarioIds = [
  "cafe", "restaurant", "shopping", "directions", "hotel",
  "airport", "meeting", "interview", "support", "friends",
] as const;

export const scenarios: Record<typeof scenarioIds[number], { label: string; role: string; goal: string; situation: string }> = {
  cafe: { label: "카페 주문", role: "a cafe barista", goal: "음료와 크기를 정하고 공손하게 주문해 보세요.", situation: "The learner is ordering a drink at your cafe. Ask about their order." },
  restaurant: { label: "식당에서 주문", role: "a restaurant server", goal: "메뉴를 묻고 원하는 음식과 요청 사항을 자연스럽게 전달해 보세요.", situation: "Help the learner choose and order a meal. Ask one practical follow-up question at a time." },
  shopping: { label: "쇼핑과 교환", role: "a store clerk", goal: "상품의 색상과 크기를 묻고 교환이나 결제를 요청해 보세요.", situation: "The learner is shopping and may ask about size, color, price, payment, or an exchange." },
  directions: { label: "길 묻기", role: "a helpful local resident", goal: "목적지까지 가는 길과 교통편을 묻고 안내를 확인해 보세요.", situation: "Give the learner clear directions to a nearby destination and check that they understood." },
  hotel: { label: "호텔 체크인", role: "a hotel receptionist", goal: "예약을 확인하고 객실이나 편의시설에 관해 요청해 보세요.", situation: "Handle the learner's hotel check-in and one realistic request about the room or facilities." },
  airport: { label: "공항 수속", role: "an airline check-in agent", goal: "체크인하면서 좌석과 수하물에 필요한 정보를 확인해 보세요.", situation: "Guide the learner through airport check-in, including seat preference and baggage questions." },
  meeting: { label: "비즈니스 회의", role: "a colleague in a project meeting", goal: "프로젝트 일정을 제안하고 상대의 의견을 물어보세요.", situation: "Discuss a project deadline professionally with the learner." },
  interview: { label: "취업 면접", role: "a job interviewer", goal: "경험과 강점을 설명하고 직무에 관한 질문에 답해 보세요.", situation: "Conduct a supportive job interview. Ask one concise question about the learner's experience or strengths." },
  support: { label: "고객 문의", role: "a customer support agent", goal: "제품이나 서비스 문제를 설명하고 해결 방법을 요청해 보세요.", situation: "Help the learner report a product or service problem, clarify the issue, and agree on a next step." },
  friends: { label: "친구와 약속", role: "a close friend", goal: "친구에게 주말 계획을 제안하고 약속을 잡아보세요.", situation: "Make weekend plans with the learner in a friendly casual tone." },
};

export const roleplayRequestSchema = z.object({
  scenario: z.enum(scenarioIds),
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
