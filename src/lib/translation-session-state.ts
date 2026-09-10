import type { TranslationSessionDto } from "@/lib/dto";

/** A completed save must not restore a translation that the user has left. */
export function updateSessionBookmark(
  current: TranslationSessionDto | null,
  sessionId: string,
  variantId: string,
  savedPhraseId: string | null,
): TranslationSessionDto | null {
  if (!current || current.id !== sessionId) return current;
  return {
    ...current,
    variants: current.variants.map((variant) =>
      variant.id === variantId ? { ...variant, savedPhraseId } : variant,
    ),
  };
}
