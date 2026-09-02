import { describe, expect, it } from "vitest";
import { calculateNextReview } from "@/lib/study-schedule";

const now = new Date("2026-09-02T00:00:00.000Z");

describe("study schedule", () => {
  it("schedules a missed card again in ten minutes", () => {
    const result = calculateNextReview(
      { repetitions: 4, intervalDays: 12, easePercent: 250 },
      "again",
      now,
    );
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(0);
    expect(result.easePercent).toBe(230);
    expect(result.nextReviewAt.toISOString()).toBe("2026-09-02T00:10:00.000Z");
  });

  it("uses one and three day steps for successful first reviews", () => {
    const first = calculateNextReview(null, "good", now);
    const second = calculateNextReview(first, "good", now);
    expect(first.intervalDays).toBe(1);
    expect(second.intervalDays).toBe(3);
  });

  it("extends an easy card and caps its ease", () => {
    const result = calculateNextReview(
      { repetitions: 5, intervalDays: 20, easePercent: 295 },
      "easy",
      now,
    );
    expect(result.intervalDays).toBe(60);
    expect(result.easePercent).toBe(300);
  });

  it("never lowers ease below the supported minimum", () => {
    const result = calculateNextReview(
      { repetitions: 2, intervalDays: 2, easePercent: 130 },
      "hard",
      now,
    );
    expect(result.easePercent).toBe(130);
    expect(result.intervalDays).toBeGreaterThanOrEqual(1);
  });
});
