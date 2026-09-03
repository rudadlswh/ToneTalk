import type { SourceLanguage } from "@/lib/languages";

export const examplePools: Record<SourceLanguage, string[]> = {
  auto: [
    "How are you?",
    "정말 감사합니다!",
    "Enchanté de vous rencontrer.",
    "お手伝いいただけますか？",
    "¿Qué me recomienda?",
    "你能说慢一点吗？",
    "Das klingt nach einer guten Idee.",
  ],
  en: [
    "How are you?",
    "Thank you so much!",
    "Could you help me?",
    "What do you recommend?",
    "Could you speak more slowly?",
    "I'd like to make a reservation.",
    "That sounds like a great idea.",
  ],
  ja: [
    "お元気ですか？",
    "本当にありがとうございます！",
    "手伝ってもらえますか？",
    "おすすめは何ですか？",
    "もう少しゆっくり話していただけますか？",
    "予約をしたいのですが。",
    "それはいい考えですね。",
  ],
  ko: [
    "어떻게 지내세요?",
    "정말 감사합니다!",
    "도와주실 수 있나요?",
    "무엇을 추천하시나요?",
    "조금 천천히 말씀해 주시겠어요?",
    "예약하고 싶습니다.",
    "좋은 생각인 것 같아요.",
  ],
  fr: [
    "Comment allez-vous ?",
    "Merci beaucoup !",
    "Pourriez-vous m'aider ?",
    "Que me conseillez-vous ?",
    "Pourriez-vous parler plus lentement ?",
    "Je voudrais faire une réservation.",
    "Cela me semble être une bonne idée.",
  ],
  es: [
    "¿Cómo estás?",
    "¡Muchas gracias!",
    "¿Podrías ayudarme?",
    "¿Qué me recomienda?",
    "¿Podría hablar más despacio?",
    "Quisiera hacer una reserva.",
    "Me parece una gran idea.",
  ],
  "zh-CN": [
    "你好吗？",
    "非常感谢！",
    "你能帮我吗？",
    "你有什么推荐？",
    "你能说慢一点吗？",
    "我想预订一个位置。",
    "听起来是个好主意。",
  ],
  de: [
    "Wie geht es dir?",
    "Vielen Dank!",
    "Könntest du mir helfen?",
    "Was würden Sie empfehlen?",
    "Könnten Sie bitte langsamer sprechen?",
    "Ich möchte gerne reservieren.",
    "Das klingt nach einer guten Idee.",
  ],
};

const visibleExampleCount = 3;

export function getInitialExamples(language: SourceLanguage) {
  return examplePools[language].slice(0, visibleExampleCount);
}

export function getRandomExamples(
  language: SourceLanguage,
  currentExamples: string[],
  random: () => number = Math.random,
) {
  const shuffled = [...examplePools[language]];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const nextExamples = shuffled.slice(0, visibleExampleCount);
  const currentSet = new Set(currentExamples);
  if (nextExamples.every((example) => currentSet.has(example))) {
    const replacement = shuffled.find((example) => !currentSet.has(example));
    if (replacement) nextExamples[nextExamples.length - 1] = replacement;
  }

  return nextExamples;
}
