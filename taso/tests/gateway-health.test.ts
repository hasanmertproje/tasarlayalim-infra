import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';

test('gateway readiness validates live nginx-to-Core secret without disclosure', async () => {
  const oldSecret = process.env.TASO_GATEWAY_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.TASO_GATEWAY_SECRET = 'gateway-health-contract-secret';
  const app = buildServer();
  try {
    const processHealth = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(processHealth.statusCode, 200);

    const withoutHeader = await app.inject({ method: 'GET', url: '/gateway/health' });
    assert.equal(withoutHeader.statusCode, 401);
    assert.equal(withoutHeader.json().ok, false);

    const wrongHeader = await app.inject({
      method: 'GET',
      url: '/gateway/health',
      headers: { 'x-taso-gateway': 'wrong-gateway' },
    });
    assert.equal(wrongHeader.statusCode, 401);

    const matched = await app.inject({
      method: 'GET',
      url: '/gateway/health',
      headers: { 'x-taso-gateway': 'gateway-health-contract-secret' },
    });
    assert.equal(matched.statusCode, 200);
    assert.deepEqual(matched.json(), { ok: true, gateway: 'verified' });
    assert.equal(matched.headers['cache-control'], 'no-store');

    const directUnauthorized = await app.inject({ method: 'GET', url: '/v1/providers' });
    assert.equal(directUnauthorized.statusCode, 401);
    for (const response of [withoutHeader, wrongHeader, matched, directUnauthorized]) {
      assert.equal(response.body.includes('gateway-health-contract-secret'), false);
    }
  } finally {
    await app.close();
    if (oldSecret === undefined) delete process.env.TASO_GATEWAY_SECRET;
    else process.env.TASO_GATEWAY_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }
});

test('gateway readiness rejects absent secret even though process health can be up', async () => {
  const oldSecret = process.env.TASO_GATEWAY_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  delete process.env.TASO_GATEWAY_SECRET;
  process.env.NODE_ENV = 'test';
  const app = buildServer();
  try {
    const response = await app.inject({ method: 'GET', url: '/gateway/health' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { ok: false, gateway: 'unavailable' });
  } finally {
    await app.close();
    if (oldSecret === undefined) delete process.env.TASO_GATEWAY_SECRET;
    else process.env.TASO_GATEWAY_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }
});
