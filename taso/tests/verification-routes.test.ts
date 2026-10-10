import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerVerificationRoutes } from '../src/verification-routes.js';

test('verification status exposes lifecycle without auto production deploy', async () => {
  const app = Fastify();
  registerVerificationRoutes(app);
  const response = await app.inject({ method: 'GET', url: '/v1/verification/status' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.autoPromotionToProduction, false);
  assert.equal(body.productionDeploy, 'explicit-approval-required');
  await app.close();
});

test('verification evaluate returns production ready only with all gates passed', async () => {
  const app = Fastify();
  registerVerificationRoutes(app);
  const ids = ['core-tests','ci','functional','browser-qa','responsive','visual','auth-security','accessibility','approval'];
  const response = await app.inject({
    method: 'POST',
    url: '/v1/verification/evaluate',
    payload: { missionId: 'mission_1', gates: ids.map((id) => ({ id, label: id, state: 'passed' })) },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().verification.state, 'PRODUCTION_READY');
  await app.close();
});
