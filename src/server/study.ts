import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  appUsers,
  savedPhrases,
  studyProgress,
  studyReviewEvents,
  translationSessions,
  translationVariants,
} from "@/db/schema";
import type {
  StudyItemDto,
  StudyRating,
  StudySummaryDto,
} from "@/lib/dto";
import { calculateNextReview } from "@/lib/study-schedule";
import type { Tone } from "@/lib/translation-contract";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";

const studyDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function studyDay(date: Date) {
  return studyDayFormatter.format(date);
}

export function calculateStreak(reviewedDays: Set<string>, now: Date) {
  let streak = 0;
  const cursor = new Date(now);
  if (!reviewedDays.has(studyDay(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (reviewedDays.has(studyDay(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export async function listDueStudyItems(limit = 20, now = new Date()) {
  const ownerId = await getCurrentOwnerId();
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
      repetitions: studyProgress.repetitions,
      intervalDays: studyProgress.intervalDays,
      reviewCount: studyProgress.reviewCount,
      nextReviewAt: studyProgress.nextReviewAt,
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
    .leftJoin(
      studyProgress,
      and(
        eq(studyProgress.savedPhraseId, savedPhrases.id),
        eq(studyProgress.ownerId, ownerId),
      ),
    )
    .where(
      and(
        eq(savedPhrases.ownerId, ownerId),
        or(
          isNull(studyProgress.id),
          lte(studyProgress.nextReviewAt, now),
        ),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${studyProgress.nextReviewAt}, ${savedPhrases.createdAt})`),
    )
    .limit(Math.min(limit, 50));

  return rows.map(
    (row): StudyItemDto => ({
      ...row,
      tone: row.tone as Tone,
      savedAt: row.savedAt.toISOString(),
      repetitions: row.repetitions ?? 0,
      intervalDays: row.intervalDays ?? 0,
      reviewCount: row.reviewCount ?? 0,
      nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    }),
  );
}

export async function getStudySummary(now = new Date()): Promise<StudySummaryDto> {
  const ownerId = await getCurrentOwnerId();
  const historyStart = new Date(now.getTime() - 370 * 86_400_000);

  const today = studyDay(now);
  // One round trip and one pass over saved cards. Transfer distinct dates, not
  // every review event; the existing 370-day streak window stays bounded.
  const result = await db.execute<{
    totalSaved: number; dueCount: number; masteredCount: number;
    nextReviewAt: string | Date | null; dailyGoal: number;
    reviewedToday: number; reviewedDays: string[];
  }>(sql`
    with phrase_stats as (
      select count(*)::int as "totalSaved",
        count(*) filter (where p.id is null or p.next_review_at <= ${now.toISOString()}::timestamptz)::int as "dueCount",
        count(*) filter (where p.interval_days >= 21)::int as "masteredCount",
        min(p.next_review_at) filter (where p.next_review_at > ${now.toISOString()}::timestamptz) as "nextReviewAt"
      from ${savedPhrases} s left join ${studyProgress} p
        on p.saved_phrase_id = s.id and p.owner_id = ${ownerId}
      where s.owner_id = ${ownerId}
    ), review_days as (
      select to_char(reviewed_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day, count(*)::int as count
      from ${studyReviewEvents}
      where owner_id = ${ownerId} and reviewed_at > ${historyStart.toISOString()}::timestamptz
      group by 1
    )
    select phrase_stats.*,
      coalesce((select daily_study_goal from ${appUsers} where id = ${ownerId}), 10) as "dailyGoal",
      coalesce((select count from review_days where day = ${today}), 0) as "reviewedToday",
      coalesce((select json_agg(day) from review_days), '[]'::json) as "reviewedDays"
    from phrase_stats
  `);
  const row = result.rows[0];
  return {
    totalSaved: row.totalSaved,
    dueCount: row.dueCount,
    reviewedToday: row.reviewedToday,
    masteredCount: row.masteredCount,
    streakDays: calculateStreak(new Set(row.reviewedDays), now),
    dailyGoal: row.dailyGoal,
    nextReviewAt: row.nextReviewAt ? new Date(row.nextReviewAt).toISOString() : null,
  };
}

export async function reviewStudyItem(
  savedPhraseId: string,
  rating: StudyRating,
  now = new Date(),
) {
  const ownerId = await getCurrentOwnerId();
  const [ownedItem] = await db
    .select({
      id: savedPhrases.id,
      progressId: studyProgress.id,
      repetitions: studyProgress.repetitions,
      intervalDays: studyProgress.intervalDays,
      easePercent: studyProgress.easePercent,
      reviewCount: studyProgress.reviewCount,
    })
    .from(savedPhrases)
    .leftJoin(
      studyProgress,
      and(
        eq(studyProgress.savedPhraseId, savedPhrases.id),
        eq(studyProgress.ownerId, ownerId),
      ),
    )
    .where(
      and(
        eq(savedPhrases.id, savedPhraseId),
        eq(savedPhrases.ownerId, ownerId),
      ),
    )
    .limit(1);

  if (!ownedItem) return null;

  const next = calculateNextReview(
    ownedItem.progressId
      ? {
          repetitions: ownedItem.repetitions ?? 0,
          intervalDays: ownedItem.intervalDays ?? 0,
          easePercent: ownedItem.easePercent ?? 250,
        }
      : null,
    rating,
    now,
  );

  await db.transaction(async (tx) => {
    await tx
      .insert(studyProgress)
      .values({
        id: randomUUID(),
        ownerId,
        savedPhraseId,
        repetitions: next.repetitions,
        intervalDays: next.intervalDays,
        easePercent: next.easePercent,
        reviewCount: 1,
        lastReviewedAt: now,
        nextReviewAt: next.nextReviewAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: studyProgress.savedPhraseId,
        set: {
          repetitions: next.repetitions,
          intervalDays: next.intervalDays,
          easePercent: next.easePercent,
          reviewCount: sql`${studyProgress.reviewCount} + 1`,
          lastReviewedAt: now,
          nextReviewAt: next.nextReviewAt,
          updatedAt: now,
        },
      });

    await tx.insert(studyReviewEvents).values({
      id: randomUUID(),
      ownerId,
      savedPhraseId,
      rating,
      reviewedAt: now,
    });
  });

  return {
    savedPhraseId,
    repetitions: next.repetitions,
    intervalDays: next.intervalDays,
    reviewCount: (ownedItem.reviewCount ?? 0) + 1,
    nextReviewAt: next.nextReviewAt.toISOString(),
  };
}
