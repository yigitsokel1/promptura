/**
 * Blok D: Basic in-memory rate limit for expensive API routes.
 * Per-user throttle (e.g. iteration/generate). Not distributed — use Redis etc. in multi-instance.
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

const store = new Map<string, number[]>();

function prune(ts: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  return ts.filter((t) => t > cutoff);
}

/**
 * Check if the identifier (e.g. userId) is over the limit.
 * If under limit, records this request and returns true. If over, returns false.
 */
export function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  let timestamps = store.get(identifier) ?? [];
  timestamps = prune(timestamps);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  timestamps.push(now);
  store.set(identifier, timestamps);
  return true;
}

export function getRateLimitMax(): number {
  return MAX_REQUESTS_PER_WINDOW;
}

export function getRateLimitWindowMs(): number {
  return WINDOW_MS;
}
