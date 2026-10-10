import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission, Project } from '../src/domain.js';
import { FunctionalVerifier } from '../src/functional-verifier.js';

const project: Project = {
  id: 'project_functional',
  slug: 'functional',
  name: 'Functional Preview',
  repository: 'example/functional',
  isExisting: true,
  defaultBranch: 'main',
  technology: { stackMode: 'preserve', architecture: 'preserve_existing' },
  createdAt: '2026-10-10T04:30:00.000Z',
};

const mission: Mission = {
  id: 'mission_functional',
  projectId: project.id,
  objective: 'Add a health page that shows Service ready',
  riskLevel: 'WRITE',
  dataClass: 'private_code',
  status: 'testing',
  providerChain: ['functional-test'],
  autonomous: {
    enabled: true,
    maxRetries: 2,
    previewRequired: true,
    production: 'ask',
    destructive: 'deny',
    paidAi: false,
    notifications: 'important_only',
  },
  approvalRequired: false,
  execution: {
    workPlan: [{
      id: 'health-page',
      title: 'Add health page',
      objective: 'Render Service ready on /health-ui',
      specialist: 'frontend',
      status: 'completed',
      dependsOn: [],
      targetPaths: ['src/health.tsx'],
      progress: 100,
    }],
  },
  createdAt: '2026-10-10T04:30:00.000Z',
  updatedAt: '2026-10-10T04:31:00.000Z',
};

function configureProvider() {
  const previous = {
    baseUrl: process.env.TASO_PROVIDER_FUNCTIONAL_TEST_BASE_URL,
    apiKey: process.env.TASO_PROVIDER_FUNCTIONAL_TEST_API_KEY,
    model: process.env.TASO_PROVIDER_FUNCTIONAL_TEST_MODEL,
    data: process.env.TASO_PROVIDER_FUNCTIONAL_TEST_DATA,
  };
  process.env.TASO_PROVIDER_FUNCTIONAL_TEST_BASE_URL = 'https://ai.example.test';
  process.env.TASO_PROVIDER_FUNCTIONAL_TEST_API_KEY = 'key';
  process.env.TASO_PROVIDER_FUNCTIONAL_TEST_MODEL = 'model';
  process.env.TASO_PROVIDER_FUNCTIONAL_TEST_DATA = 'private_code';
  return () => {
    if (previous.baseUrl === undefined) delete process.env.TASO_PROVIDER_FUNCTIONAL_TEST_BASE_URL; else process.env.TASO_PROVIDER_FUNCTIONAL_TEST_BASE_URL = previous.baseUrl;
    if (previous.apiKey === undefined) delete process.env.TASO_PROVIDER_FUNCTIONAL_TEST_API_KEY; else process.env.TASO_PROVIDER_FUNCTIONAL_TEST_API_KEY = previous.apiKey;
    if (previous.model === undefined) delete process.env.TASO_PROVIDER_FUNCTIONAL_TEST_MODEL; else process.env.TASO_PROVIDER_FUNCTIONAL_TEST_MODEL = previous.model;
    if (previous.data === undefined) delete process.env.TASO_PROVIDER_FUNCTIONAL_TEST_DATA; else process.env.TASO_PROVIDER_FUNCTIONAL_TEST_DATA = previous.data;
  };
}

test('functional verifier executes only safe same-origin read checks', async () => {
  const restoreEnv = configureProvider();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      requests.push({ url, method });
      if (url === 'https://ai.example.test/chat/completions') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            checks: [
              { id: 'health', title: 'Health UI', method: 'GET', path: '/health-ui', expectedStatuses: [200], mustContain: ['Service ready'] },
              { id: 'unsafe-method', title: 'No writes', method: 'POST', path: '/health-ui', expectedStatuses: [200], mustContain: ['Service ready'] },
              { id: 'cross-origin', title: 'No cross origin', method: 'GET', path: 'https://evil.example/', expectedStatuses: [200] },
            ],
          }) } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://preview.example.test/health-ui') return new Response('Service ready', { status: 200 });
      throw new Error(`Unexpected request ${method} ${url}`);
    }) as typeof fetch;

    const verifier = FunctionalVerifier.fromMission(mission);
    assert.ok(verifier);
    const report = await verifier.verify(project, mission, 'https://preview.example.test');

    assert.equal(report.passed, true);
    assert.equal(report.planned, 2);
    assert.equal(report.passedCount, 2);
    assert.deepEqual(requests.slice(1).map((request) => request.url), [
      'https://preview.example.test/health-ui',
      'https://preview.example.test/health-ui',
    ]);
    assert.deepEqual(requests.slice(1).map((request) => request.method), ['GET', 'GET']);
    assert.equal(requests.some((request) => request.url.includes('evil.example')), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('functional verifier reports semantic content mismatch even when HTTP is 200', async () => {
  const restoreEnv = configureProvider();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://ai.example.test/chat/completions') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            checks: [{ id: 'health', title: 'Health UI', method: 'GET', path: '/health-ui', expectedStatuses: [200], mustContain: ['Service ready'] }],
          }) } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('Loading...', { status: 200 });
    }) as typeof fetch;

    const verifier = FunctionalVerifier.fromMission(mission);
    assert.ok(verifier);
    const report = await verifier.verify(project, mission, 'https://preview.example.test');

    assert.equal(report.passed, false);
    assert.equal(report.planned, 1);
    assert.equal(report.passedCount, 0);
    assert.match(report.summary, /missing required content/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});