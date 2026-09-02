import type { StudyRating } from "@/lib/dto";

export const studyRatings = ["again", "hard", "good", "easy"] as const;

export type StudySchedule = {
  repetitions: number;
  intervalDays: number;
  easePercent: number;
  nextReviewAt: Date;
};

export function calculateNextReview(
  current: Pick<StudySchedule, "repetitions" | "intervalDays" | "easePercent"> | null,
  rating: StudyRating,
  now = new Date(),
): StudySchedule {
  const previous = current ?? {
    repetitions: 0,
    intervalDays: 0,
    easePercent: 250,
  };

  let repetitions = previous.repetitions;
  let intervalDays = previous.intervalDays;
  let easePercent = previous.easePercent;
  let delayMs: number;

  if (rating === "again") {
    repetitions = 0;
    intervalDays = 0;
    easePercent = Math.max(130, easePercent - 20);
    delayMs = 10 * 60 * 1_000;
  } else if (rating === "hard") {
    repetitions += 1;
    intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * 1.2));
    easePercent = Math.max(130, easePercent - 15);
    delayMs = intervalDays * 86_400_000;
  } else if (rating === "good") {
    repetitions += 1;
    intervalDays =
      repetitions === 1
        ? 1
        : repetitions === 2
          ? 3
          : Math.max(4, Math.round(intervalDays * (easePercent / 100)));
    delayMs = intervalDays * 86_400_000;
  } else {
    repetitions += 1;
    easePercent = Math.min(300, easePercent + 15);
    intervalDays =
      repetitions === 1
        ? 3
        : Math.max(6, Math.round(Math.max(1, intervalDays) * (easePercent / 100)));
    delayMs = intervalDays * 86_400_000;
  }

  return {
    repetitions,
    intervalDays,
    easePercent,
    nextReviewAt: new Date(now.getTime() + delayMs),
  };
}
