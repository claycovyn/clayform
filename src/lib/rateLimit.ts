// Small in-memory limiter. Good enough for a single self-hosted instance.
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimited(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
    }
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
