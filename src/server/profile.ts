import "server-only";

import { eq, sql } from "drizzle-orm";
import { appUsers, translationSessions } from "@/db/schema";
import type { ProfileDto, ProfileStatsDto } from "@/lib/dto";
import type { TargetLanguage } from "@/lib/languages";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";
import { getStudySummary } from "@/server/study";

export async function getProfile(): Promise<{
  profile: ProfileDto;
  stats: ProfileStatsDto;
}> {
  const ownerId = await getCurrentOwnerId();
  const [users, translationCount, study] = await Promise.all([
    db.select().from(appUsers).where(eq(appUsers.id, ownerId)).limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(translationSessions)
      .where(eq(translationSessions.ownerId, ownerId)),
    getStudySummary(),
  ]);
  const user = users[0];
  if (!user) throw new Error("Profile not found");

  return {
    profile: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      defaultTargetLanguage: user.defaultTargetLanguage as TargetLanguage,
      dailyStudyGoal: user.dailyStudyGoal,
      createdAt: user.createdAt.toISOString(),
    },
    stats: {
      translationCount: translationCount[0]?.count ?? 0,
      savedPhraseCount: study.totalSaved,
      masteredCount: study.masteredCount,
      streakDays: study.streakDays,
    },
  };
}

export async function updateProfile(input: {
  displayName: string;
  defaultTargetLanguage: TargetLanguage;
  dailyStudyGoal: number;
}) {
  const ownerId = await getCurrentOwnerId();
  await db
    .update(appUsers)
    .set({
      displayName: input.displayName,
      defaultTargetLanguage: input.defaultTargetLanguage,
      dailyStudyGoal: input.dailyStudyGoal,
      updatedAt: new Date(),
    })
    .where(eq(appUsers.id, ownerId));
  return getProfile();
}
