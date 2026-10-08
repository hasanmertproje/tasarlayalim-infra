import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceRealtimeRuntime } from '../src/voice-realtime.js';

const keys = [
  'TASO_VOICE_REALTIME_ENABLED',
  'TASO_VOICE_REALTIME_PAID_ALLOWED',
  'TASO_VOICE_REALTIME_API_KEY',
  'OPENAI_API_KEY',
  'TASO_VOICE_REALTIME_MODEL',
  'TASO_VOICE_REALTIME_VOICE',
  'TASO_VOICE_REALTIME_BASE_URL',
  'TASO_VOICE_SAFETY_SALT',
] as const;

function withEnv(values: Partial<Record<(typeof keys)[number], string | undefined>>, run: () => void | Promise<void>) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;
  for (const key of keys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const finish = () => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const result = run();
    if (result instanceof Promise) return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

test('realtime voice stays disabled and free by default', () => withEnv({}, () => {
  const status = new VoiceRealtimeRuntime().status();
  assert.equal(status.enabled, false);
  assert.equal(status.paidAllowed, false);
  assert.equal(status.configured, false);
  assert.equal(status.ready, false);
  assert.equal(status.fallback, 'browser-stt-tts');
}));

test('realtime voice requires both explicit gates and a server key', () => withEnv({
  TASO_VOICE_REALTIME_ENABLED: 'true',
  TASO_VOICE_REALTIME_PAID_ALLOWED: 'false',
  TASO_VOICE_REALTIME_API_KEY: 'test-key',
}, () => {
  let status = new VoiceRealtimeRuntime().status();
  assert.equal(status.enabled, true);
  assert.equal(status.paidAllowed, false);
  assert.equal(status.configured, true);
  assert.equal(status.ready, false);

  process.env.TASO_VOICE_REALTIME_PAID_ALLOWED = 'true';
  status = new VoiceRealtimeRuntime().status();
  assert.equal(status.ready, true);
  assert.equal(status.model, 'gpt-realtime-2.1-mini');
}));

test('disabled realtime voice rejects session creation before network access', async () => withEnv({}, async () => {
  const runtime = new VoiceRealtimeRuntime();
  await assert.rejects(
    () => runtime.createSession({ projectId: 'workspace-a', workspaceName: 'Workspace A' }, 'v=0\r\n'),
    /disabled/i,
  );
}));
