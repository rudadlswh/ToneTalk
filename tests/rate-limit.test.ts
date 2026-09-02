import { beforeEach, describe, expect, it } from "vitest";
import { consumeRateLimit, resetRateLimitsForTests } from "@/server/rate-limit";

describe("rate limit", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("allows requests until the configured limit", () => {
    expect(consumeRateLimit("client", 2, 60_000).allowed).toBe(true);
    expect(consumeRateLimit("client", 2, 60_000).allowed).toBe(true);
    const blocked = consumeRateLimit("client", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks clients independently", () => {
    consumeRateLimit("one", 1, 60_000);
    expect(consumeRateLimit("one", 1, 60_000).allowed).toBe(false);
    expect(consumeRateLimit("two", 1, 60_000).allowed).toBe(true);
  });
});
