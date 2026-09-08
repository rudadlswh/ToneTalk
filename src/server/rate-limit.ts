type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function consumeRateLimit(
  key: string,
  limit = 10,
  windowMs = 60_000,
) {
  const now = Date.now();
  // Best-effort per-instance spam guard. Global AI admission is in PostgreSQL.
  if (buckets.size >= 1000) {
    for (const [oldKey, oldBucket] of buckets) {
      if (oldBucket.resetAt <= now) buckets.delete(oldKey);
    }
    if (buckets.size >= 1000 && !buckets.has(key)) {
      return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
    }
  }
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
