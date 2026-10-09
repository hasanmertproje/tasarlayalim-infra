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

test('questions stay ordinary assistant conversation', () => {
  for (const text of [
    'Taso bugün ne yaptık?',
    'Gemini Live nasıl çalışıyor?',
    'Production ortamı nedir?',
    'Secret key neden tarayıcıya konmamalı?',
  ]) {
    const decision = classifyConversationIntent(text);
    assert.equal(decision.executionRequested, false);
  }
});

test('research and analysis requests do not create missions', () => {
  for (const text of [
    'Gemini ile Grok voice seçeneklerini araştır',
    'Bu iki yaklaşımı karşılaştır',
    'Şu logu analiz et',
    'Bunu özetle',
  ]) {
    const decision = classifyConversationIntent(text);
    assert.equal(decision.intent, 'READ_REQUEST');
    assert.equal(decision.executionRequested, false);
    assert.equal(decision.suggestedRisk, 'READ');
  }
});

test('system status questions are STATUS and never request a mission', () => {
  for (const text of ['sistem durumu nedir', 'core ne durumda', 'agent durumu ne', 'son durum ne']) {
    const decision = classifyConversationIntent(text);
    assert.equal(decision.intent, 'STATUS');
    assert.equal(decision.executionRequested, false);
    assert.equal(decision.suggestedRisk, undefined);
  }
});

test('write language creates only an execution proposal decision', () => {
  for (const text of [
    'mobil tasarımı düzelt ve daha profesyonel yap',
    'müşteri bulma saas ürününü geliştirmeye başla',
    'sosyal medya için yeni tasarımlar üret',
  ]) {
    const decision = classifyConversationIntent(text);
    assert.equal(decision.intent, 'WRITE_REQUEST');
    assert.equal(decision.executionRequested, true);
    assert.equal(decision.suggestedRisk, 'WRITE');
  }
});

test('production action language is high impact but production questions are not', () => {
  const action = classifyConversationIntent('bunu production canlıya al');
  assert.equal(action.intent, 'HIGH_IMPACT_REQUEST');
  assert.equal(action.executionRequested, true);
  assert.equal(action.suggestedRisk, 'HIGH_IMPACT');

  const question = classifyConversationIntent('production deploy neden riskli?');
  assert.equal(question.executionRequested, false);
});

test('conversation store isolates messages by workspace', () => {
  const store = new ConversationStore();
  store.append({ projectId: 'project-a', role: 'user', content: 'A', intent: 'CHAT' });
  store.append({ projectId: 'project-b', role: 'user', content: 'B', intent: 'CHAT' });
  assert.deepEqual(store.list('project-a').map((message) => message.content), ['A']);
  assert.deepEqual(store.list('project-b').map((message) => message.content), ['B']);
});
