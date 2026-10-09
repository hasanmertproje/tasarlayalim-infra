import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerVoiceRealtimeRoutes } from '../src/voice-realtime-routes.js';

function buildVoiceServer() {
  const app = Fastify({ logger: false });
  registerVoiceRealtimeRoutes(app);
  return app;
}

test('voice realtime status never exposes credentials', async () => {
  const previousGemini = process.env.TASO_GEMINI_API_KEY;
  process.env.TASO_GEMINI_API_KEY = 'test-secret-never-return';
  const app = buildVoiceServer();
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/voice/realtime' });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.realtime.provider, 'gemini-live');
    assert.equal(payload.realtime.transport, 'websocket');
    assert.equal(payload.realtime.fallback, 'local-neural-manual');
    assert.equal(payload.realtime.ephemeralTokens, true);
    assert.equal(payload.realtime.ready, true);
    assert.equal(payload.providers.geminiTts.provider, 'gemini-tts');
    assert.equal(payload.providers.geminiTts.ready, true);
    assert.equal('apiKey' in payload.realtime, false);
    assert.equal(JSON.stringify(payload).includes('test-secret-never-return'), false);
  } finally {
    await app.close();
    if (previousGemini === undefined) delete process.env.TASO_GEMINI_API_KEY;
    else process.env.TASO_GEMINI_API_KEY = previousGemini;
  }
});

test('Gemini TTS stays server-side and returns only generated audio metadata', async () => {
  const previousGemini = process.env.TASO_GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.TASO_GEMINI_API_KEY = 'tts-secret-never-return';
  let observedApiKey = '';
  globalThis.fetch = async (_input, init) => {
    observedApiKey = String((init?.headers as Record<string, string> | undefined)?.['x-goog-api-key'] ?? '');
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ inlineData: { data: 'UklGRgAAAAA=', mimeType: 'audio/wav' } }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const app = buildVoiceServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/gemini/tts',
      payload: { projectId: 'workspace-a', text: 'Merhaba. Ben Taso.' },
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(observedApiKey, 'tts-secret-never-return');
    assert.equal(payload.audio.audioBase64, 'UklGRgAAAAA=');
    assert.equal(payload.tts.provider, 'gemini-tts');
    assert.equal(JSON.stringify(payload).includes('tts-secret-never-return'), false);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (previousGemini === undefined) delete process.env.TASO_GEMINI_API_KEY;
    else process.env.TASO_GEMINI_API_KEY = previousGemini;
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

test('assistant research request stays conversational and creates no mission', async () => {
  const app = buildVoiceServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/classify',
      payload: { projectId: 'workspace-a', text: 'Nvidia içindeki ücretsiz modelleri araştır ve bana karşılaştır.' },
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.decision.intent, 'READ_REQUEST');
    assert.equal(payload.decision.executionRequested, false);
    assert.equal(payload.suggestedMission, undefined);
  } finally {
    await app.close();
  }
});

test('mentioning secrets or permissions in a question never becomes high impact execution', async () => {
  const app = buildVoiceServer();
  try {
    for (const text of ['Secret key nedir?', 'Yetki sistemi nasıl çalışıyor?', 'Production durumu nedir?']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/voice/classify',
        payload: { projectId: 'workspace-a', text },
      });
      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.equal(payload.decision.executionRequested, false, text);
      assert.equal(payload.suggestedMission, undefined, text);
    }
  } finally {
    await app.close();
  }
});

test('runtime status voice question is deterministic and never execution', async () => {
  const app = buildVoiceServer();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice/classify',
      payload: { projectId: 'workspace-a', text: 'Sistem durumu nedir?' },
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.decision.intent, 'STATUS');
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