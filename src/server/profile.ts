import "server-only";

import { eq, sql } from "drizzle-orm";
import { appUsers, translationSessions } from "@/db/schema";
import type { ProfileDto, ProfileStatsDto } from "@/lib/dto";
import type { TargetLanguage } from "@/lib/languages";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";
import { getStudySummary } from "@/server/study";
import { getAuthenticatedUser } from "@/server/auth";

export async function getProfile(): Promise<{
  profile: ProfileDto;
  stats: ProfileStatsDto;
}> {
  const ownerId = await getCurrentOwnerId();
  const [users, study] = await Promise.all([
    db.select({
      id: appUsers.id,
      displayName: appUsers.displayName,
      defaultTargetLanguage: appUsers.defaultTargetLanguage,
      dailyStudyGoal: appUsers.dailyStudyGoal,
      createdAt: appUsers.createdAt,
      translationCount: sql<number>`(select count(*)::int from ${translationSessions} where ${translationSessions.ownerId} = ${ownerId})`,
    }).from(appUsers).where(eq(appUsers.id, ownerId)).limit(1),
    getStudySummary(),
  ]);
  const user = users[0];
  if (!user) throw new Error("Profile not found");

  return {
    profile: {
      id: user.id,
      email: (await getAuthenticatedUser()).email,
      displayName: user.displayName,
      defaultTargetLanguage: user.defaultTargetLanguage as TargetLanguage,
      dailyStudyGoal: user.dailyStudyGoal,
      createdAt: user.createdAt.toISOString(),
    },
    stats: {
      translationCount: user.translationCount,
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
