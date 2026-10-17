import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';

test('real Core health and operations endpoints agree on executor capability status', async () => {
  const app = buildServer();
  try {
    const healthResponse = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(healthResponse.statusCode, 200);
    const health = healthResponse.json() as {
      ok: boolean;
      service: string;
      state: string;
      gateway: string;
      executor: { read: boolean; write: boolean; deploy: boolean };
    };
    assert.equal(health.ok, true);
    assert.equal(health.service, 'taso-core');
    assert.ok(['persistent', 'memory'].includes(health.state));
    assert.ok(['configured', 'missing'].includes(health.gateway));
    assert.equal(typeof health.executor.read, 'boolean');
    assert.equal(typeof health.executor.write, 'boolean');
    assert.equal(typeof health.executor.deploy, 'boolean');

    const headers = process.env.TASO_GATEWAY_SECRET
      ? { 'x-taso-gateway': process.env.TASO_GATEWAY_SECRET }
      : {};
    const operationsResponse = await app.inject({ method: 'GET', url: '/v1/operations?limit=5', headers });
    assert.equal(operationsResponse.statusCode, 200);
    const operations = operationsResponse.json().operations as {
      generatedAt: string;
      agents: Array<{ id: string; status: string; activeMissions?: number }>;
    };
    assert.ok(Number.isFinite(Date.parse(operations.generatedAt)));
    const executor = operations.agents.find(agent => agent.id === 'executor');
    assert.ok(executor, 'executor must be represented in operations snapshot');
    if (!health.executor.read || !health.executor.write) {
      assert.equal(executor.status, 'degraded', 'an unready executor must not appear ready');
    } else {
      assert.ok(['ready', 'busy'].includes(executor.status));
    }
    assert.equal(
      operations.agents.filter(agent => agent.id === 'executor').length,
      1,
      'the executor must not appear as multiple contradictory agents',
    );
  } finally {
    await app.close();
  }
});
