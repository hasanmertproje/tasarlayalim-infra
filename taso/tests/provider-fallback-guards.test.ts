import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission, Project } from '../src/domain.js';
import { MultiProviderPlanner } from '../src/multi-provider-planner.js';

const envNames = ['TASO_PROVIDER_NVIDIA_BASE_URL', 'TASO_PROVIDER_NVIDIA_API_KEY',
  'TASO_PROVIDER_NVIDIA_MODEL', 'TASO_PROVIDER_NVIDIA_DATA',
  'TASO_PROVIDER_GROQ_BASE_URL', 'TASO_PROVIDER_GROQ_API_KEY',
  'TASO_PROVIDER_GROQ_MODEL', 'TASO_PROVIDER_GROQ_DATA'] as const;

function configuredTestProviders() {
  const saved = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const id of ['NVIDIA', 'GROQ']) {
    process.env[`TASO_PROVIDER_${id}_BASE_URL`] = 'https://example.invalid/v1';
    process.env[`TASO_PROVIDER_${id}_API_KEY`] = 'unit-test-only';
    process.env[`TASO_PROVIDER_${id}_MODEL`] = 'test-model';
  }
  process.env.TASO_PROVIDER_NVIDIA_DATA = 'public';
  process.env.TASO_PROVIDER_GROQ_DATA = 'private_code';
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const project = { name: 'Isolated test project', technology: {} } as Project;
const mission = { providerChain: ['nvidia', 'groq'], dataClass: 'private_code' } as Mission;

test('private code skips an unapproved provider without contacting it', async () => {
  const restoreEnv = configuredTestProviders();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Approved response' } }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const planner = new MultiProviderPlanner(['nvidia', 'groq']);
    assert.equal(await planner.analyze(project, mission, []), 'Approved response');
    assert.deepEqual(calls, ['https://example.invalid/v1/chat/completions']);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('non-retryable HTTP 401 falls back immediately without repeating the rejected request', async () => {
  const restoreEnv = configuredTestProviders();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    process.env.TASO_PROVIDER_NVIDIA_DATA = 'private_code';
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response('Unauthorized: do not include upstream body in logs', { status: 401 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Fallback completed' } }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const planner = new MultiProviderPlanner(['nvidia', 'groq']);
    assert.equal(await planner.analyze(project, mission, []), 'Fallback completed');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('provider error messages do not expose untrusted upstream response bodies', async () => {
  const restoreEnv = configuredTestProviders();
  const originalFetch = globalThis.fetch;
  try {
    process.env.TASO_PROVIDER_NVIDIA_DATA = 'private_code';
    globalThis.fetch = async () => new Response('secret-upstream-body', { status: 403 });
    const planner = new MultiProviderPlanner(['nvidia']);
    await assert.rejects(planner.analyze(project, mission, []), (error: unknown) => {
      assert.match(String(error), /HTTP 403/);
      assert.doesNotMatch(String(error), /secret-upstream-body/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
