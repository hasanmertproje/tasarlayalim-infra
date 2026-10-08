import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../src/server.js';

const providerEnv = [
  'TASO_PROVIDER_NVIDIA_BASE_URL', 'TASO_PROVIDER_NVIDIA_API_KEY', 'TASO_PROVIDER_NVIDIA_MODEL',
  'TASO_PROVIDER_GROQ_BASE_URL', 'TASO_PROVIDER_GROQ_API_KEY', 'TASO_PROVIDER_GROQ_MODEL',
  'TASO_PROVIDER_OPENAI_BASE_URL', 'TASO_PROVIDER_OPENAI_API_KEY', 'TASO_PROVIDER_OPENAI_MODEL',
  'TASO_GATEWAY_SECRET', 'TASO_STATE_FILE',
];

function withCleanConversationEnv() {
  const previous = new Map<string, string | undefined>();
  for (const key of providerEnv) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('casual conversation does not create a mission', async () => {
  const restore = withCleanConversationEnv();
  const app = buildServer();
  try {
    const projectsResponse = await app.inject({ method: 'GET', url: '/v1/projects' });
    const projectId = projectsResponse.json().projects[0]?.id as string;
    assert.ok(projectId);

    const beforeResponse = await app.inject({ method: 'GET', url: '/v1/missions' });
    const beforeCount = beforeResponse.json().missions.length;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/conversations/messages',
      payload: { projectId, text: 'Hey emo şu anda nasılsın' },
    });
    assert.equal(response.statusCode, 201);
    const payload = response.json();
    assert.equal(payload.decision.intent, 'CHAT');
    assert.equal(payload.decision.executionRequested, false);
    assert.equal(payload.suggestedMission, undefined);

    const afterResponse = await app.inject({ method: 'GET', url: '/v1/missions' });
    assert.equal(afterResponse.json().missions.length, beforeCount);
  } finally {
    await app.close();
    restore();
  }
});

test('system status is answered without AI provider or mission creation', async () => {
  const restore = withCleanConversationEnv();
  const app = buildServer();
  try {
    const projectsResponse = await app.inject({ method: 'GET', url: '/v1/projects' });
    const projectId = projectsResponse.json().projects[0]?.id as string;
    assert.ok(projectId);

    const beforeResponse = await app.inject({ method: 'GET', url: '/v1/missions' });
    const beforeCount = beforeResponse.json().missions.length;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/conversations/messages',
      payload: { projectId, text: 'sistem durumu nedir' },
    });
    assert.equal(response.statusCode, 201);
    const payload = response.json();
    assert.equal(payload.decision.intent, 'STATUS');
    assert.equal(payload.decision.executionRequested, false);
    assert.equal(payload.suggestedMission, undefined);
    assert.match(payload.assistantMessage.content, /Core çevrimiçi/i);
    assert.doesNotMatch(payload.assistantMessage.content, /mission başlatmam/i);

    const afterResponse = await app.inject({ method: 'GET', url: '/v1/missions' });
    assert.equal(afterResponse.json().missions.length, beforeCount);
  } finally {
    await app.close();
    restore();
  }
});

test('execution language returns a proposal without creating a mission', async () => {
  const restore = withCleanConversationEnv();
  const app = buildServer();
  try {
    const projectsResponse = await app.inject({ method: 'GET', url: '/v1/projects' });
    const projectId = projectsResponse.json().projects[0]?.id as string;
    assert.ok(projectId);

    const beforeResponse = await app.inject({ method: 'GET', url: '/v1/missions' });
    const beforeCount = beforeResponse.json().missions.length;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/conversations/messages',
      payload: { projectId, text: 'mobil tasarımı düzelt' },
    });
    assert.equal(response.statusCode, 201);
    const payload = response.json();
    assert.equal(payload.decision.intent, 'WRITE_REQUEST');
    assert.equal(payload.decision.executionRequested, true);
    assert.equal(payload.suggestedMission.riskLevel, 'WRITE');

    const afterResponse = await app.inject({ method: 'GET', url: '/v1/missions' });
    assert.equal(afterResponse.json().missions.length, beforeCount);
  } finally {
    await app.close();
    restore();
  }
});
