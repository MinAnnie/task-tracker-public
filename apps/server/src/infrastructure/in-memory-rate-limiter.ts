export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one request for `key` and tells whether it is within the limit. */
  hit(key: string): RateLimitDecision;
  /** Number of keys currently tracked. */
  size(): number;
}

/**
 * Fixed-window limiter kept in process memory: good enough for a single server
 * instance (counts reset on restart). Ended windows are swept at most once per
 * window, so memory stays proportional to the keys seen in the last window.
 */
export function createInMemoryRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  let nextSweep = now() + windowMs;

  const sweep = (at: number) => {
    if (at < nextSweep) return;
    for (const [key, window] of windows) if (at - window.start >= windowMs) windows.delete(key);
    nextSweep = at + windowMs;
  };

  return {
    hit(key) {
      const at = now();
      sweep(at);
      let window = windows.get(key);
      if (window === undefined || at - window.start >= windowMs) {
        window = { start: at, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count <= limit) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - at) / 1000)) };
    },
    size: () => windows.size,
  };
}
