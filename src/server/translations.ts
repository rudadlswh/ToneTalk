import "server-only";

import { randomUUID } from "node:crypto";
import {
  translationSessions,
  translationVariants,
} from "@/db/schema";
import type { TranslationSessionDto } from "@/lib/dto";
import type { SourceLanguage, TargetLanguage } from "@/lib/languages";
import type { Tone } from "@/lib/translation-contract";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { generateTranslation } from "@/server/ollama";
import { getCurrentOwnerId } from "@/server/owner";

export async function createTranslation(
  sourceText: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
): Promise<TranslationSessionDto> {
  const ownerId = await getCurrentOwnerId();
  const generated = await generateTranslation(
    sourceText,
    sourceLanguage,
    targetLanguage,
  );
  const sessionId = randomUUID();
  const createdAt = new Date();
  const model = getEnv().OLLAMA_MODEL;

  const variants = generated.variants.map((variant, position) => ({
    id: randomUUID(),
    sessionId,
    tone: variant.tone,
    translatedText: variant.translatedText,
    transliteration: variant.transliteration,
    contextNote: variant.contextNote,
    warning: variant.warning,
    position,
    createdAt,
  }));

  await db.transaction(async (tx) => {
    await tx.insert(translationSessions).values({
      id: sessionId,
      ownerId,
      sourceText,
      sourceLanguage: generated.sourceLanguage,
      targetLanguage,
      status: "complete",
      model,
      latencyMs: generated.latencyMs,
      createdAt,
    });
    await tx.insert(translationVariants).values(variants);
  });

  return {
    id: sessionId,
    sourceText,
    sourceLanguage: generated.sourceLanguage,
    targetLanguage,
    model,
    latencyMs: generated.latencyMs,
    createdAt: createdAt.toISOString(),
    variants: variants.map((variant) => ({
      id: variant.id,
      tone: variant.tone as Tone,
      translatedText: variant.translatedText,
      transliteration: variant.transliteration,
      contextNote: variant.contextNote,
      warning: variant.warning,
      savedPhraseId: null,
    })),
  };
}
