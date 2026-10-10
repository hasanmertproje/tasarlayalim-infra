import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerBrowserOperatorRoutes } from '../src/browser-operator-routes.js';

test('browser operator reports not configured truthfully', async () => {
  const oldUrl = process.env.TASO_BROWSER_WORKER_URL;
  const oldSecret = process.env.TASO_BROWSER_WORKER_SECRET;
  delete process.env.TASO_BROWSER_WORKER_URL;
  delete process.env.TASO_BROWSER_WORKER_SECRET;
  const app = Fastify();
  registerBrowserOperatorRoutes(app);
  const response = await app.inject({ method: 'GET', url: '/v1/browser/status' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.configured, false);
  assert.equal(body.ready, false);
  assert.equal(body.state, 'not-configured');
  assert.equal(body.externalWrite, false);
  await app.close();
  if (oldUrl === undefined) delete process.env.TASO_BROWSER_WORKER_URL; else process.env.TASO_BROWSER_WORKER_URL = oldUrl;
  if (oldSecret === undefined) delete process.env.TASO_BROWSER_WORKER_SECRET; else process.env.TASO_BROWSER_WORKER_SECRET = oldSecret;
});

test('browser operator blocks unsupported authority before worker call', async () => {
  const oldUrl = process.env.TASO_BROWSER_WORKER_URL;
  const oldSecret = process.env.TASO_BROWSER_WORKER_SECRET;
  process.env.TASO_BROWSER_WORKER_URL = 'http://127.0.0.1:65534';
  process.env.TASO_BROWSER_WORKER_SECRET = 'test-secret';
  const app = Fastify();
  registerBrowserOperatorRoutes(app);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/browser/run',
    payload: { url: 'https://example.com', authority: 'HIGH_IMPACT' },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.json().error, /READ\/DRAFT/);
  await app.close();
  if (oldUrl === undefined) delete process.env.TASO_BROWSER_WORKER_URL; else process.env.TASO_BROWSER_WORKER_URL = oldUrl;
  if (oldSecret === undefined) delete process.env.TASO_BROWSER_WORKER_SECRET; else process.env.TASO_BROWSER_WORKER_SECRET = oldSecret;
});
