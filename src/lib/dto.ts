import type { TargetLanguage } from "@/lib/languages";
import type { Tone } from "@/lib/translation-contract";

export type TranslationVariantDto = {
  id: string;
  tone: Tone;
  translatedText: string;
  transliteration: string | null;
  contextNote: string;
  warning: string | null;
  savedPhraseId: string | null;
};

export type TranslationSessionDto = {
  id: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: TargetLanguage;
  model: string;
  latencyMs: number;
  createdAt: string;
  variants: TranslationVariantDto[];
};

export type SavedPhraseDto = {
  id: string;
  variantId: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone: Tone;
  translatedText: string;
  transliteration: string | null;
  contextNote: string;
  warning: string | null;
  savedAt: string;
};
