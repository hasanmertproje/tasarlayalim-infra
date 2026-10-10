import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { assessVisualQaEvidence, registerVisualQaRoutes, runBoundedVisualRepairLoop } from '../src/visual-qa.js';

test('visual QA marks overflow and browser errors as blockers', () => {
  const report = assessVisualQaEvidence({
    ok: true,
    target: 'https://preview.example.test/',
    generatedAt: '2026-10-10T00:00:00.000Z',
    evidence: [
      {
        viewport: 'desktop',
        httpStatus: 200,
        horizontalOverflow: false,
        console: [],
        pageErrors: [],
        requestFailures: [],
        screenshot: { mime: 'image/png', base64: 'abc', bytes: 3 },
      },
      {
        viewport: 'mobile',
        httpStatus: 200,
        horizontalOverflow: true,
        documentWidth: 430,
        viewportWidth: 390,
        overflowers: [{ tag: 'div', className: 'wide-card' }],
        console: [{ type: 'error', text: 'Unhandled error' }],
        pageErrors: ['boom'],
        requestFailures: [{ url: 'https://preview.example.test/api', error: 'net::ERR_FAILED' }],
        screenshot: { mime: 'image/png', base64: 'abc', bytes: 3 },
      },
    ],
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.blockerCount, 3);
  assert.equal(report.warningCount, 1);
  assert.ok(report.issues.some((issue) => issue.code === 'horizontal-overflow'));
  assert.ok(report.issues.some((issue) => issue.code === 'console-error'));
  assert.ok(report.issues.some((issue) => issue.code === 'page-error'));
});

test('visual QA passes clean desktop and mobile evidence', () => {
  const report = assessVisualQaEvidence({
    ok: true,
    evidence: ['desktop', 'mobile'].map((viewport) => ({
      viewport,
      httpStatus: 200,
      horizontalOverflow: false,
      console: [],
      pageErrors: [],
      requestFailures: [],
      screenshot: { mime: 'image/png', base64: 'abc', bytes: 3 },
    })),
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.blockerCount, 0);
  assert.equal(report.warningCount, 0);
});

test('bounded visual repair stops after at most three repair cycles', async () => {
  let verifies = 0;
  let repairs = 0;
  const result = await runBoundedVisualRepairLoop({
    verify: async () => ({ status: 'failed' as const, verifies: ++verifies }),
    repair: async (_report, attempt) => {
      repairs += 1;
      return { repaired: true, summary: `repair ${attempt}` };
    },
    maxAttempts: 99,
  });

  assert.equal(result.maxAttempts, 3);
  assert.equal(result.passed, false);
  assert.equal(result.exhausted, true);
  assert.equal(repairs, 3);
  assert.equal(verifies, 4);
});

test('bounded visual repair re-verifies and exits as soon as QA passes', async () => {
  let verifies = 0;
  const result = await runBoundedVisualRepairLoop({
    verify: async () => ({ status: (++verifies >= 2 ? 'passed' : 'failed') as 'passed' | 'failed' }),
    repair: async () => ({ repaired: true, summary: 'scoped repair' }),
  });
  assert.equal(result.passed, true);
  assert.equal(result.exhausted, false);
  assert.equal(result.attempts.length, 1);
  assert.equal(verifies, 2);
});

test('visual QA status is truthful when browser worker is not configured', async () => {
  const oldUrl = process.env.TASO_BROWSER_WORKER_URL;
  const oldSecret = process.env.TASO_BROWSER_WORKER_SECRET;
  delete process.env.TASO_BROWSER_WORKER_URL;
  delete process.env.TASO_BROWSER_WORKER_SECRET;
  const app = Fastify();
  registerVisualQaRoutes(app);
  const response = await app.inject({ method: 'GET', url: '/v1/visual-qa/status' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.configured, false);
  assert.equal(body.maxAutoRepairAttempts, 3);
  await app.close();
  if (oldUrl === undefined) delete process.env.TASO_BROWSER_WORKER_URL; else process.env.TASO_BROWSER_WORKER_URL = oldUrl;
  if (oldSecret === undefined) delete process.env.TASO_BROWSER_WORKER_SECRET; else process.env.TASO_BROWSER_WORKER_SECRET = oldSecret;
});
