import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("@/server/owner", () => ({ getCurrentOwnerId: async () => "test-owner" }));
import { db } from "@/server/db";
import { calculateStreak, getStudySummary } from "@/server/study";

it("counts days across Seoul midnight, tolerates an unfinished today", () => {
  const days = new Set(["2026-09-08", "2026-09-07", "2026-09-05"]);
  expect(calculateStreak(days, new Date("2026-09-08T14:59:59Z"))).toBe(2);
  expect(calculateStreak(days, new Date("2026-09-08T15:00:00Z"))).toBe(2);
  expect(calculateStreak(days, new Date("2026-09-09T15:00:00Z"))).toBe(0);
  expect(calculateStreak(new Set(), new Date())).toBe(0);
});
it("builds the full summary from one aggregated query", async () => {
  vi.mocked(db.execute).mockResolvedValue({ rows: [{ totalSaved: 3, dueCount: 2, masteredCount: 1, nextReviewAt: "2026-10-01T00:00:00Z", dailyGoal: 10, reviewedToday: 12, reviewedDays: ["2026-09-08", "2026-09-07"] }] } as never);
  expect(await getStudySummary(new Date("2026-09-08T03:00:00Z"))).toEqual({ totalSaved: 3, dueCount: 2, masteredCount: 1, nextReviewAt: "2026-10-01T00:00:00.000Z", dailyGoal: 10, reviewedToday: 12, streakDays: 2 });
  expect(db.execute).toHaveBeenCalledTimes(1);
});
