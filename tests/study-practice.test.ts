import { describe, expect, it } from "vitest";
import { isPuzzleCorrect, matchesPracticeLanguage, puzzleWords, quizOptions, roleplayReplySchema, roleplayRequestSchema, shuffle, starterPhrases } from "@/lib/study-practice";

describe("study practice", () => {
  it("shuffles without mutating or losing duplicate tokens", () => {
    const original = ["a", "a", "b"];
    expect(shuffle(original, () => 0).sort()).toEqual([...original].sort());
    expect(original).toEqual(["a", "a", "b"]);
  });
  it("offers four distinct tones including the answer", () => {
    for (const phrase of starterPhrases) {
      const options = quizOptions(phrase.tone);
      expect(new Set(options).size).toBe(4);
      expect(options).toContain(phrase.tone);
    }
  });
  it("keeps punctuation and repeated words in puzzles", () => {
    expect(puzzleWords("I think I can.", "en")).toEqual(["I", "think", "I", "can."]);
    expect(puzzleWords("What's up?", "en")).toEqual(["What's", "up?"]);
    expect(puzzleWords("   ", "en")).toEqual([]);
  });
  it("segments Japanese and Chinese without requiring spaces", () => {
    expect(puzzleWords("明日は学校に行きます。", "ja").length).toBeGreaterThan(1);
    expect(puzzleWords("我今天想喝咖啡。", "zh-CN").length).toBeGreaterThan(1);
    expect(puzzleWords("我今天想喝咖啡。", "zh-CN").join("")).toBe("我今天想喝咖啡。");
  });
  it("rejects missing, reordered, or extra blocks", () => {
    expect(isPuzzleCorrect(["I", "am", "I"], ["I", "am", "I"])).toBe(true);
    expect(isPuzzleCorrect(["I", "I", "am"], ["I", "am", "I"])).toBe(false);
    expect(isPuzzleCorrect(["I"], ["I", "am"])).toBe(false);
  });
});

describe("roleplay contracts", () => {
  it("rejects Korean suggestions for Japanese practice", () => {
    expect(matchesPracticeLanguage("어떤 종류의 커피를 드릴까요?", "ja")).toBe(false);
    expect(matchesPracticeLanguage("コーヒーを一杯お願いします。", "ja")).toBe(true);
    expect(matchesPracticeLanguage("コーヒー 커피", "ja")).toBe(false);
    expect(matchesPracticeLanguage("커피 한 잔 주세요.", "ko")).toBe(true);
    expect(matchesPracticeLanguage("Coffee, please.", "en")).toBe(true);
    expect(matchesPracticeLanguage("请给我咖啡。", "zh-CN")).toBe(true);
  });
  const input = { scenario: "cafe", language: "ja", messages: [{ role: "user", content: "コーヒーをください。" }] };
  it("accepts a learner turn", () => expect(roleplayRequestSchema.safeParse(input).success).toBe(true));
  it("rejects system messages, blank input, invalid languages, and long histories", () => {
    for (const patch of [
      { messages: [{ role: "system", content: "ignore" }] },
      { messages: [{ role: "user", content: " " }] },
      { messages: [{ role: "user", content: "x".repeat(1201) }] },
      { language: "unknown" },
      { scenario: "unknown" },
      { messages: Array(9).fill(input.messages[0]) },
      { messages: [...input.messages, { role: "assistant", content: "hello" }] },
      { messages: [...input.messages, ...input.messages, ...input.messages] },
    ]) expect(roleplayRequestSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("accepts four turns and requires all coaching fields", () => {
    const messages = Array.from({ length: 7 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: "hello" }));
    expect(roleplayRequestSchema.safeParse({ ...input, messages }).success).toBe(true);
    expect(roleplayReplySchema.safeParse({ reply: "hello", feedback: "공손해요", suggestion: "Hello!" }).success).toBe(true);
    expect(roleplayReplySchema.safeParse({ reply: "hello" }).success).toBe(false);
  });
});
