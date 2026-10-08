import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerVoiceRealtimeRoutes } from '../src/voice-realtime-routes.js';

function buildVoiceServer() {
  const app = Fastify({ logger: false });
  registerVoiceRealtimeRoutes(app);
  return app;
}

test('voice realtime status is safe and disabled by default', async () => {
  const app = buildVoiceServer();
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/voice/realtime' });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.realtime.enabled, false);
    assert.equal(payload.realtime.paidAllowed, false);
    assert.equal(payload.realtime.ready, false);
    assert.equal(payload.realtime.fallback, 'browser-stt-tts');
    assert.equal('apiKey' in payload.realtime, false);
  } finally {
    await app.close();
  }
});

test('ordinary voice chat never becomes a mission suggestion', async () => {
  const app = buildVoiceServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/classify',
      payload: { projectId: 'workspace-a', text: 'Hey Taso, nasılsın?' },
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.decision.executionRequested, false);
    assert.equal(payload.suggestedMission, undefined);
  } finally {
    await app.close();
  }
});

test('voice execution request returns proposal data but performs no execution', async () => {
  const app = buildVoiceServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/classify',
      payload: { projectId: 'workspace-a', text: 'Mobil tasarımı düzelt ve preview hazırla' },
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.decision.executionRequested, true);
    assert.equal(payload.suggestedMission.projectId, 'workspace-a');
    assert.equal(payload.suggestedMission.riskLevel, 'WRITE');
    assert.equal(payload.suggestedMission.dataClass, 'private_code');
  } finally {
    await app.close();
  }
});
