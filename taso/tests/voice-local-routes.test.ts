import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerLocalVoiceRoutes } from '../src/voice-local-routes.js';

function buildLocalVoiceServer() {
  const app = Fastify({ logger: false });
  registerLocalVoiceRoutes(app);
  return app;
}

test('local voice is safely unavailable when no service URL is configured', async () => {
  const previous = process.env.TASO_LOCAL_VOICE_URL;
  delete process.env.TASO_LOCAL_VOICE_URL;
  const app = buildLocalVoiceServer();
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/voice/local' });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.local.configured, false);
    assert.equal(payload.local.ready, false);
    assert.deepEqual(payload.local.voices, []);
  } finally {
    if (previous === undefined) delete process.env.TASO_LOCAL_VOICE_URL;
    else process.env.TASO_LOCAL_VOICE_URL = previous;
    await app.close();
  }
});

test('local synthesis refuses to pretend success when service is not configured', async () => {
  const previous = process.env.TASO_LOCAL_VOICE_URL;
  delete process.env.TASO_LOCAL_VOICE_URL;
  const app = buildLocalVoiceServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/local/synthesize',
      payload: { text: 'Buradayım.' },
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /not configured/i);
  } finally {
    if (previous === undefined) delete process.env.TASO_LOCAL_VOICE_URL;
    else process.env.TASO_LOCAL_VOICE_URL = previous;
    await app.close();
  }
});
