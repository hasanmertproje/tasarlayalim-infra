import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyConversationIntent, ConversationStore } from '../src/conversation.js';

test('casual greeting never requests execution', () => {
  const greetings = ['hey taso nasılsın', 'Hey emo şu anda nasılsın'];
  for (const greeting of greetings) {
    const decision = classifyConversationIntent(greeting);
    assert.equal(decision.intent, 'CHAT');
    assert.equal(decision.executionRequested, false);
    assert.equal(decision.suggestedRisk, undefined);
  }
});

test('question never requests execution', () => {
  const decision = classifyConversationIntent('Taso bugün ne yaptık?');
  assert.equal(decision.executionRequested, false);
});

test('write language creates only an execution proposal decision', () => {
  const decision = classifyConversationIntent('mobil tasarımı düzelt ve daha profesyonel yap');
  assert.equal(decision.intent, 'WRITE_REQUEST');
  assert.equal(decision.executionRequested, true);
  assert.equal(decision.suggestedRisk, 'WRITE');
});

test('production language is high impact', () => {
  const decision = classifyConversationIntent('bunu production canlıya al');
  assert.equal(decision.intent, 'HIGH_IMPACT_REQUEST');
  assert.equal(decision.executionRequested, true);
  assert.equal(decision.suggestedRisk, 'HIGH_IMPACT');
});

test('conversation store isolates messages by workspace', () => {
  const store = new ConversationStore();
  store.append({ projectId: 'project-a', role: 'user', content: 'A', intent: 'CHAT' });
  store.append({ projectId: 'project-b', role: 'user', content: 'B', intent: 'CHAT' });
  assert.deepEqual(store.list('project-a').map((message) => message.content), ['A']);
  assert.deepEqual(store.list('project-b').map((message) => message.content), ['B']);
});
