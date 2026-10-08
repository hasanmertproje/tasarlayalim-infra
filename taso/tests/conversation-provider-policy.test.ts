import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAi } from '../src/conversation-ai.js';
import { ProviderRouter, type ProviderDescriptor } from '../src/provider-router.js';

function withNvidiaRuntime() {
  const keys = ['TASO_PROVIDER_NVIDIA_BASE_URL', 'TASO_PROVIDER_NVIDIA_API_KEY', 'TASO_PROVIDER_NVIDIA_MODEL'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.TASO_PROVIDER_NVIDIA_BASE_URL = 'https://example.invalid/v1';
  process.env.TASO_PROVIDER_NVIDIA_API_KEY = 'test-key';
  process.env.TASO_PROVIDER_NVIDIA_MODEL = 'test-model';
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function descriptor(allowedDataClasses: ProviderDescriptor['allowedDataClasses']): ProviderDescriptor {
  return {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    enabled: true,
    costClass: 'free',
    strength: 85,
    latency: 55,
    allowedDataClasses,
  };
}

test('conversation AI refuses provider not approved for private workspace context', () => {
  const restore = withNvidiaRuntime();
  try {
    const ai = new ConversationAi(new ProviderRouter([descriptor(['public'])]));
    assert.equal(ai.status().configured, false);
  } finally {
    restore();
  }
});

test('conversation AI accepts a runtime provider explicitly approved for private code', () => {
  const restore = withNvidiaRuntime();
  try {
    const ai = new ConversationAi(new ProviderRouter([descriptor(['public', 'private_code'])]));
    const status = ai.status();
    assert.equal(status.configured, true);
    assert.equal(status.provider, 'nvidia');
    assert.equal(status.model, 'test-model');
  } finally {
    restore();
  }
});
