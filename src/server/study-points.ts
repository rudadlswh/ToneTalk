import "server-only";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { studyPointEvents } from "@/db/schema";
import { type StudyPointInput, type StudyPointsResponse, type parseStudyPointsCursor } from "@/lib/study-points";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";

const pageSize = 20;

async function totalForOwner(ownerId: string) {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${studyPointEvents.points}), 0)` })
    .from(studyPointEvents).where(eq(studyPointEvents.ownerId, ownerId));
  return Number(row.total);
}

export async function awardStudyPoints(input: StudyPointInput) {
  const ownerId = await getCurrentOwnerId();
  // Legacy outbox acknowledgement only. New rewards come from server grading
  // or a committed fourth AI response, never a client completion claim.
  const [existing] = await db.select({ id: studyPointEvents.id }).from(studyPointEvents).where(and(
    eq(studyPointEvents.id, input.eventId), eq(studyPointEvents.ownerId, ownerId),
    eq(studyPointEvents.activity, input.activity), eq(studyPointEvents.activityId, input.activityId),
  ));
  if (!existing) return null;
  return { awarded: false, points: 0, totalPoints: await totalForOwner(ownerId) };
}

export async function listStudyPoints(cursor: ReturnType<typeof parseStudyPointsCursor>): Promise<StudyPointsResponse> {
  const ownerId = await getCurrentOwnerId();
  const beforeCursor = cursor ? or(
    lt(studyPointEvents.createdAt, cursor.createdAt),
    and(eq(studyPointEvents.createdAt, cursor.createdAt), lt(studyPointEvents.id, cursor.id)),
  ) : undefined;
  const [totalPoints, rows] = await Promise.all([
    totalForOwner(ownerId),
    db.select({ id: studyPointEvents.id, activity: studyPointEvents.activity, points: studyPointEvents.points, createdAt: studyPointEvents.createdAt })
      .from(studyPointEvents).where(and(eq(studyPointEvents.ownerId, ownerId), beforeCursor))
      .orderBy(desc(studyPointEvents.createdAt), desc(studyPointEvents.id)).limit(pageSize + 1),
  ]);
  const items = rows.slice(0, pageSize).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  const last = items.at(-1);
  return { totalPoints, items, nextCursor: rows.length > pageSize && last ? `${last.createdAt}|${last.id}` : null };
}
