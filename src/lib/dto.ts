import type { LanguageCode, TargetLanguage } from "@/lib/languages";
import type { Tone } from "@/lib/translation-contract";

export type TranslationVariantDto = {
  id: string;
  tone: Tone;
  translatedText: string;
  transliteration: string | null;
  hangulPronunciation: string | null;
  contextNote: string;
  warning: string | null;
  savedPhraseId: string | null;
};

export type TranslationSessionDto = {
  id: string;
  sourceText: string;
  sourceLanguage: LanguageCode;
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
  hangulPronunciation: string | null;
  contextNote: string;
  warning: string | null;
  savedAt: string;
};

export type StudyRating = "again" | "hard" | "good" | "easy";

export type StudyItemDto = SavedPhraseDto & {
  repetitions: number;
  intervalDays: number;
  reviewCount: number;
  nextReviewAt: string | null;
};

export type StudySummaryDto = {
  totalSaved: number;
  dueCount: number;
  reviewedToday: number;
  masteredCount: number;
  streakDays: number;
  dailyGoal: number;
  nextReviewAt: string | null;
};

export type ProfileDto = {
  id: string;
  email: string | null;
  displayName: string;
  defaultTargetLanguage: TargetLanguage;
  dailyStudyGoal: number;
  createdAt: string;
};

export type ProfileStatsDto = {
  translationCount: number;
  savedPhraseCount: number;
  masteredCount: number;
  streakDays: number;
};
