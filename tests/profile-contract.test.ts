import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "@/lib/profile-contract";

describe("profile contract", () => {
  it("trims a valid profile update", () => {
    expect(
      updateProfileSchema.parse({
        displayName: "  민지  ",
        defaultTargetLanguage: "ko",
        dailyStudyGoal: 12,
      }),
    ).toEqual({
      displayName: "민지",
      defaultTargetLanguage: "ko",
      dailyStudyGoal: 12,
    });
  });

  it("rejects unsupported languages and unreasonable goals", () => {
    expect(() =>
      updateProfileSchema.parse({
        displayName: "Learner",
        defaultTargetLanguage: "en",
        dailyStudyGoal: 0,
      }),
    ).toThrow();
  });
});
