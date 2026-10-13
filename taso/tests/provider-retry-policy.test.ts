import assert from 'node:assert/strict';
import test from 'node:test';
import { decideProviderRetry, retryAfterMilliseconds } from '../src/provider-retry-policy.js';

test('never retries permanent provider failures or spends on unauthorized requests', () => {
  for (const status of [400, 401, 402, 403, 404, 422]) {
    assert.deepEqual(decideProviderRetry(status, 1), { retry: false, delayMs: 0, reason: 'permanent' });
  }
});
test('only transient errors retry, with bounded exponential delay and attempts', () => {
  assert.equal(decideProviderRetry(429, 1).delayMs, 500);
  assert.equal(decideProviderRetry(503, 2).delayMs, 1000);
  assert.equal(decideProviderRetry(502, 3).retry, false);
  assert.equal(decideProviderRetry(408, 1).retry, true);
  assert.equal(decideProviderRetry(undefined, 1).retry, true);
  assert.equal(decideProviderRetry(200, 1).retry, false);
});
test('Retry-After supports seconds and HTTP-date without unbounded delay', () => {
  const now = Date.parse('2026-10-13T00:00:00.000Z');
  assert.equal(retryAfterMilliseconds('3', now), 3000);
  assert.equal(retryAfterMilliseconds('999999999', now), 120_000);
  assert.equal(retryAfterMilliseconds('Tue, 13 Oct 2026 00:00:04 GMT', now), 4000);
  assert.equal(retryAfterMilliseconds('invalid', now), undefined);
  assert.equal(decideProviderRetry(429, 1, '8').delayMs, 8000);
  assert.equal(decideProviderRetry(503, 1, '999999').delayMs, 120_000);
  assert.equal(decideProviderRetry(500, 1, '20').delayMs, 500);
});
test('malformed settings and attempts cannot create unlimited retries', () => {
  assert.equal(decideProviderRetry(429, 6, '1', {maxAttempts: Infinity}).retry, false);
  assert.equal(decideProviderRetry(429, 1, '0', {maxAttempts: 1}).retry, false);
  assert.equal(decideProviderRetry(429, -1).retry, false);
  assert.equal(decideProviderRetry(429, 1, null, {baseDelayMs: 999999, maxDelayMs: 999999}).delayMs, 10_000);
});
