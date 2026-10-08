import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiLiveRuntime } from '../src/gemini-live.js';

test('Gemini ephemeral token provisioning stays minimal and never exposes the API key', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TASO_GEMINI_API_KEY;
  const originalEnabled = process.env.TASO_GEMINI_LIVE_ENABLED;
  let requestUrl = '';
  let requestHeaders: Record<string, string> = {};
  let requestBody: Record<string, unknown> = {};

  process.env.TASO_GEMINI_API_KEY = 'server-only-test-key';
  process.env.TASO_GEMINI_LIVE_ENABLED = 'true';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({ name: 'auth-token/test-ephemeral' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const runtime = new GeminiLiveRuntime();
    const session = await runtime.createEphemeralToken({ projectId: 'workspace-a', workspaceName: 'Workspace A' });

    assert.match(requestUrl, /\/v1beta\/auth_tokens$/);
    assert.equal(requestHeaders['x-goog-api-key'], 'server-only-test-key');
    assert.equal(requestBody.uses, 1);
    assert.equal(typeof requestBody.expireTime, 'string');
    assert.equal(typeof requestBody.newSessionExpireTime, 'string');
    assert.equal('liveConnectConstraints' in requestBody, false);
    assert.equal('apiKey' in session, false);
    assert.equal(session.token, 'auth-token/test-ephemeral');
    assert.equal(session.model.length > 0, true);
    assert.equal(session.voice.length > 0, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TASO_GEMINI_API_KEY;
    else process.env.TASO_GEMINI_API_KEY = originalKey;
    if (originalEnabled === undefined) delete process.env.TASO_GEMINI_LIVE_ENABLED;
    else process.env.TASO_GEMINI_LIVE_ENABLED = originalEnabled;
  }
});
