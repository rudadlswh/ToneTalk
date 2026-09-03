import { describe, expect, it } from "vitest";
import {
  examplePools,
  getInitialExamples,
  getRandomExamples,
} from "@/lib/examples";

describe("example prompts", () => {
  it("shows three initial examples", () => {
    expect(getInitialExamples("ko")).toEqual(examplePools.ko.slice(0, 3));
  });

  it("returns three unique examples from the selected language", () => {
    const examples = getRandomExamples("ja", [], () => 0.42);

    expect(examples).toHaveLength(3);
    expect(new Set(examples).size).toBe(3);
    expect(examples.every((example) => examplePools.ja.includes(example))).toBe(true);
  });

  it("changes at least one example when refreshing", () => {
    const current = getInitialExamples("en");
    const refreshed = getRandomExamples("en", current, () => 0.999);

    expect(refreshed.some((example) => !current.includes(example))).toBe(true);
  });
});
