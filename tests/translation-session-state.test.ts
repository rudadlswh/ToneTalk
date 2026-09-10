import { describe, expect, it } from "vitest";
import type { TranslationSessionDto } from "@/lib/dto";
import { updateSessionBookmark } from "@/lib/translation-session-state";

const session: TranslationSessionDto = {
  id: "old", sourceText: "Hello", sourceLanguage: "en", targetLanguage: "ja",
  model: "test", latencyMs: 1, createdAt: "2026-09-09T00:00:00Z",
  variants: [{ id: "variant", tone: "casual", translatedText: "こんにちは",
    transliteration: null, hangulPronunciation: null, contextNote: "", warning: null,
    savedPhraseId: null }],
};

describe("translation save response reconciliation", () => {
  it("does not restore a cleared session", () => {
    expect(updateSessionBookmark(null, "old", "variant", "saved")).toBeNull();
  });
  it("leaves a newer translation untouched", () => {
    const newer = { ...session, id: "new" };
    expect(updateSessionBookmark(newer, "old", "variant", "saved")).toBe(newer);
  });
  it("updates the current state without mutating the captured session", () => {
    const current = { ...session, latencyMs: 42 };
    const saved = updateSessionBookmark(current, "old", "variant", "saved");
    expect(saved?.latencyMs).toBe(42);
    expect(saved?.variants[0].savedPhraseId).toBe("saved");
    expect(session.variants[0].savedPhraseId).toBeNull();
    expect(updateSessionBookmark(saved, "old", "variant", null)?.variants[0].savedPhraseId).toBeNull();
  });
});
