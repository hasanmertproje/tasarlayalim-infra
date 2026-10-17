/** Pure retry policy. No network calls, secrets, timers, or automatic spending. */
export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: 'temporary' | 'permanent' | 'exhausted';
}
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}
const MAX_RETRY_AFTER_MS = 120_000;
const DEFAULT_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 };
function positiveInteger(value: number, fallback: number, limit: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(limit, Math.trunc(value))) : fallback;
}
export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
  }
  // HTTP-date is allowed; other strings fail closed to the ordinary backoff.
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, timestamp - now));
}
export function decideProviderRetry(
  status: number | undefined,
  attempt: number,
  retryAfter: string | null = null,
  policy: Partial<RetryPolicy> = {},
  now = Date.now(),
): RetryDecision {
  const maxAttempts = positiveInteger(policy.maxAttempts ?? DEFAULT_POLICY.maxAttempts, 3, 5);
  const baseDelayMs = positiveInteger(policy.baseDelayMs ?? DEFAULT_POLICY.baseDelayMs, 500, 10_000);
  const maxDelayMs = positiveInteger(policy.maxDelayMs ?? DEFAULT_POLICY.maxDelayMs, 10_000, 120_000);
  const transient = status === undefined || [408, 409, 425, 429].includes(status) || (status >= 500 && status <= 599);
  if (!transient) return { retry: false, delayMs: 0, reason: 'permanent' };
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= maxAttempts) {
    return { retry: false, delayMs: 0, reason: 'exhausted' };
  }
  const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const header = (status === 429 || status === 503) ? retryAfterMilliseconds(retryAfter, now) : undefined;
  return { retry: true, delayMs: Math.min(MAX_RETRY_AFTER_MS, Math.max(backoff, header ?? 0)), reason: 'temporary' };
}
