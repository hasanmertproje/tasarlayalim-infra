import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectKnowledgeStore } from '../src/project-knowledge.js';

test('project knowledge is project-scoped and normalizes tags', () => {
  const projects = new Set(['project_a', 'project_b']);
  let changed = 0;
  const store = new ProjectKnowledgeStore([], (projectId) => projects.has(projectId), () => { changed += 1; });

  const record = store.create('project_a', {
    kind: 'decision',
    title: '  Preserve current PHP architecture  ',
    body: 'Do not migrate the existing application to a different framework without explicit approval.',
    tags: [' Architecture ', 'architecture', 'php'],
  });

  assert.equal(record.projectId, 'project_a');
  assert.equal(record.title, 'Preserve current PHP architecture');
  assert.deepEqual(record.tags, ['architecture', 'php']);
  assert.equal(record.source, 'manual');
  assert.equal(store.list('project_a').length, 1);
  assert.equal(store.list('project_b').length, 0);
  assert.equal(changed, 1);
});

test('project knowledge update keeps provenance immutable', () => {
  const store = new ProjectKnowledgeStore([], (projectId) => projectId === 'project_a');
  const created = store.create('project_a', {
    kind: 'runbook',
    title: 'Production release',
    body: 'Run CI, request approval, then deploy through the configured broker.',
    source: 'mission',
    sourceRef: 'mission_123',
  });

  const updated = store.update('project_a', created.id, {
    kind: 'note',
    title: 'Production release checklist',
    tags: ['release', 'guardrail'],
  });

  assert.equal(updated.kind, 'note');
  assert.equal(updated.title, 'Production release checklist');
  assert.equal(updated.source, 'mission');
  assert.equal(updated.sourceRef, 'mission_123');
  assert.deepEqual(updated.tags, ['release', 'guardrail']);
});

test('knowledge validation rejects unknown projects and oversized tag sets', () => {
  const store = new ProjectKnowledgeStore([], (projectId) => projectId === 'project_a');

  assert.throws(() => store.create('missing', {
    kind: 'fact',
    title: 'Missing project',
    body: 'Should not persist.',
  }), /Project not found/);

  assert.throws(() => store.create('project_a', {
    kind: 'fact',
    title: 'Too many tags',
    body: 'Validation example.',
    tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`),
  }), /at most 12 tags/);
});
