// A small in-memory fixed-window limiter. Good for one instance; on serverless it applies per instance.
// Pass your own `(key) => boolean | Promise<boolean>` to createOpenCtrlMcp for a shared store.
export function memoryRateLimiter(limit: number, windowMs = 60_000): (key: string) => boolean {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (key) => {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
      return false;
    }
    b.count++;
    return b.count > limit;
  };
}
