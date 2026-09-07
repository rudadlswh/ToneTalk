import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  savedPhrases,
  translationSessions,
  translationVariants,
} from "@/db/schema";
import type { SavedPhraseDto } from "@/lib/dto";
import type { Tone } from "@/lib/translation-contract";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";

export async function listSavedPhrases(options: {
  query?: string;
  language?: string;
  limit?: number;
}) {
  const ownerId = await getCurrentOwnerId();
  const query = options.query?.trim();
  const conditions = [eq(savedPhrases.ownerId, ownerId)];

  if (options.language) {
    conditions.push(eq(translationSessions.targetLanguage, options.language));
  }

  if (query) {
    const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(
      or(
        ilike(translationSessions.sourceText, pattern),
        ilike(translationVariants.translatedText, pattern),
        ilike(translationVariants.transliteration, pattern),
        ilike(translationVariants.hangulPronunciation, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      id: savedPhrases.id,
      variantId: translationVariants.id,
      sourceText: translationSessions.sourceText,
      sourceLanguage: translationSessions.sourceLanguage,
      targetLanguage: translationSessions.targetLanguage,
      tone: translationVariants.tone,
      translatedText: translationVariants.translatedText,
      transliteration: translationVariants.transliteration,
      hangulPronunciation: translationVariants.hangulPronunciation,
      contextNote: translationVariants.contextNote,
      warning: translationVariants.warning,
      savedAt: savedPhrases.createdAt,
    })
    .from(savedPhrases)
    .innerJoin(
      translationVariants,
      eq(savedPhrases.variantId, translationVariants.id),
    )
    .innerJoin(
      translationSessions,
      eq(translationVariants.sessionId, translationSessions.id),
    )
    .where(and(...conditions))
    .orderBy(desc(savedPhrases.createdAt))
    .limit(Math.min(options.limit ?? 50, 100));

  return rows.map(
    (row): SavedPhraseDto => ({
      ...row,
      tone: row.tone as Tone,
      savedAt: row.savedAt.toISOString(),
    }),
  );
}

export async function savePhrase(variantId: string) {
  const ownerId = await getCurrentOwnerId();

  const [ownedVariant] = await db
    .select({ id: translationVariants.id })
    .from(translationVariants)
    .innerJoin(
      translationSessions,
      eq(translationVariants.sessionId, translationSessions.id),
    )
    .where(
      and(
        eq(translationVariants.id, variantId),
        eq(translationSessions.ownerId, ownerId),
      ),
    )
    .limit(1);

  if (!ownedVariant) return null;

  const [inserted] = await db
    .insert(savedPhrases)
    .values({ id: randomUUID(), ownerId, variantId })
    .onConflictDoNothing({
      target: [savedPhrases.ownerId, savedPhrases.variantId],
    })
    .returning({ id: savedPhrases.id });

  if (inserted) return inserted;

  const [existing] = await db
    .select({ id: savedPhrases.id })
    .from(savedPhrases)
    .where(
      and(
        eq(savedPhrases.ownerId, ownerId),
        eq(savedPhrases.variantId, variantId),
      ),
    )
    .limit(1);

  return existing ?? null;
}

export async function deleteSavedPhrase(id: string) {
  const ownerId = await getCurrentOwnerId();
  const result = await db
    .delete(savedPhrases)
    .where(and(eq(savedPhrases.id, id), eq(savedPhrases.ownerId, ownerId)))
    .returning({ id: savedPhrases.id });
  return result.length > 0;
}

export async function countSavedPhrases() {
  const ownerId = await getCurrentOwnerId();
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(savedPhrases)
    .where(eq(savedPhrases.ownerId, ownerId));
  return result?.count ?? 0;
}
