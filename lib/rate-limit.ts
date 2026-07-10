// In-memory, per-process rate limiting. This protects a single Dokploy
// instance's OpenAI budget from an unauthenticated public endpoint being
// hit in a loop. It resets on redeploy and doesn't coordinate across
// multiple instances — if this app ever scales horizontally, replace the
// in-memory Map with a shared store (e.g. Redis) so the limit applies
// across instances instead of per-process.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 15;

const requestTimestamps = new Map<string, number[]>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const timestamps = (requestTimestamps.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - timestamps[0])) / 1000);
    requestTimestamps.set(key, timestamps);
    return { allowed: false, retryAfterSeconds };
  }

  timestamps.push(now);
  requestTimestamps.set(key, timestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
