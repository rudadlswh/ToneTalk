import { z } from "zod";

export const studyPointRewards = { quiz: 20, puzzle: 25, chat: 35 } as const;
export const studyPointLabels = {
  quiz: "어투 뉘앙스 퀴즈 정답",
  puzzle: "단어 나열 퍼즐 완성",
  chat: "롤플레이 4회 대화 완료",
} as const;
export type StudyPointActivity = keyof typeof studyPointRewards;
// Assertion only: the authenticated server identity remains the source of truth.
export const studyPointsAccountHeader = "x-tonetalk-account";

// The client identifies the completion, never its owner or reward amount.
export const studyPointInputSchema = z.object({
  eventId: z.uuid(),
  activity: z.enum(["quiz", "puzzle", "chat"]),
  activityId: z.string().trim().min(1).max(240),
}).strict();
export type StudyPointInput = z.infer<typeof studyPointInputSchema>;
export type StudyPointItem = {
  id: string;
  activity: StudyPointActivity;
  points: number;
  createdAt: string;
};
export type StudyPointsResponse = {
  totalPoints: number;
  items: StudyPointItem[];
  nextCursor: string | null;
};
export const studyPointAwardResponseSchema = z.object({
  awarded: z.boolean(), points: z.number().int().nonnegative(), totalPoints: z.number().int().nonnegative(),
});

export function parseStudyPointsCursor(value: string | null) {
  if (value === null) return null;
  const [createdAt, id] = z.tuple([z.iso.datetime(), z.uuid()]).parse(value.split("|"));
  return { createdAt: new Date(createdAt), id };
}
