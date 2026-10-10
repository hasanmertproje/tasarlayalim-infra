import assert from 'node:assert/strict';
import test from 'node:test';
import { CoolifyTools } from '../src/coolify-tools.js';
import type { Project } from '../src/domain.js';

const project: Project = {
  id: 'project_preview',
  slug: 'preview-app',
  name: 'Preview App',
  repository: 'example/preview-app',
  isExisting: true,
  defaultBranch: 'main',
  technology: { stackMode: 'preserve', architecture: 'preserve_existing' },
  createdAt: new Date().toISOString(),
};

function tools() {
  return new CoolifyTools({
    baseUrl: 'https://coolify.example/api/v1',
    token: 'test-token',
    resourceMap: { 'preview-app': 'resource-1' },
  });
}

test('preview runtime probe accepts a healthy HTTP response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body>ok</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  try {
    const result = await tools().probeRuntime('https://preview.example');
    assert.equal(result.healthy, true);
    assert.equal(result.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test('preview runtime probe rejects a nominal 200 response containing a runtime failure signature', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body>Internal Server Error</body></html>', { status: 200 });
  try {
    const result = await tools().probeRuntime('https://preview.example');
    assert.equal(result.healthy, false);
    assert.match(result.summary, /runtime failure signature/i);
  } finally {
    globalThis.fetch = original;
  }
});

test('preview deploy performs one bounded redeploy after runtime failure and returns only after a healthy probe', async () => {
  const original = globalThis.fetch;
  let deployCalls = 0;
  let probeCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/deploy') && init?.method === 'POST') {
      deployCalls += 1;
      return Response.json({ deployments: [{ deployment_uuid: `deployment-${deployCalls}` }] });
    }
    if (url.includes('/deployments/')) {
      return Response.json({ status: 'completed', deployment_url: 'https://preview.example' });
    }
    if (url === 'https://preview.example') {
      probeCalls += 1;
      return probeCalls <= 5
        ? new Response('503 Service Unavailable', { status: 503 })
        : new Response('<html>healthy</html>', { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const result = await tools().deploy(project, 42);
    assert.equal(deployCalls, 2);
    assert.equal(result.runtimeRedeploys, 1);
    assert.equal(result.runtimeProbe?.healthy, true);
  } finally {
    globalThis.fetch = original;
  }
});
