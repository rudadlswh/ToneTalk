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
import { withInferenceSlot } from "@/server/inference-limit";
import { assertRequestActive } from "@/server/request-budget";
import { readTranslationCache, translationCacheKey, writeTranslationCache } from "@/server/translation-cache";

export async function createTranslation(
  sourceText: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
): Promise<TranslationSessionDto> {
  const ownerId = await getCurrentOwnerId();
  const cacheKey = translationCacheKey(ownerId, sourceText, sourceLanguage, targetLanguage);
  let cacheHit = false;
  const readCached = async () => {
    const cached = await readTranslationCache(cacheKey);
    if (cached) cacheHit = true;
    return cached;
  };
  const generated = await readCached() ?? await withInferenceSlot(async () => {
    // Recheck after admission: another request may have filled the cache.
    const cached = await readCached();
    if (cached) return cached;
    const fresh = await generateTranslation(sourceText, sourceLanguage, targetLanguage);
    assertRequestActive();
    await writeTranslationCache(cacheKey, fresh);
    return fresh;
  });
  assertRequestActive();
  const sessionId = randomUUID();
  const inferenceLatencyMs = cacheHit ? 0 : generated.latencyMs;
  const createdAt = new Date();
  const env = getEnv();
  const model = env.AI_PROVIDER === "gemini" ? env.GEMINI_MODEL : env.OLLAMA_MODEL;

  const variants = generated.variants.map((variant, position) => ({
    id: randomUUID(),
    sessionId,
    tone: variant.tone,
    translatedText: variant.translatedText,
    transliteration: variant.transliteration,
    hangulPronunciation: variant.hangulPronunciation,
    contextNote: variant.contextNote,
    warning: variant.warning,
    position,
    createdAt,
  }));

  await db.transaction(async (tx) => {
    assertRequestActive();
    await tx.insert(translationSessions).values({
      id: sessionId,
      ownerId,
      sourceText,
      sourceLanguage: generated.sourceLanguage,
      targetLanguage,
      status: "complete",
      model,
      latencyMs: inferenceLatencyMs,
      createdAt,
    });
    await tx.insert(translationVariants).values(variants);
    assertRequestActive();
  });

  return {
    id: sessionId,
    sourceText,
    sourceLanguage: generated.sourceLanguage,
    targetLanguage,
    model,
    latencyMs: inferenceLatencyMs,
    cacheHit,
    createdAt: createdAt.toISOString(),
    variants: variants.map((variant) => ({
      id: variant.id,
      tone: variant.tone as Tone,
      translatedText: variant.translatedText,
      transliteration: variant.transliteration,
      hangulPronunciation: variant.hangulPronunciation,
      contextNote: variant.contextNote,
      warning: variant.warning,
      savedPhraseId: null,
    })),
  };
}
