import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectMilestoneStore, summarizeMilestones } from '../src/project-milestones.js';

test('milestone progress is weighted and cancelled milestones are excluded', () => {
  const store = new ProjectMilestoneStore([], (projectId) => projectId === 'project_1');
  store.create('project_1', { title: 'Core', weight: 2, status: 'completed' });
  store.create('project_1', { title: 'Dashboard', weight: 1, status: 'in_progress', progress: 50 });
  store.create('project_1', { title: 'Cancelled experiment', weight: 99, status: 'cancelled', progress: 99 });

  const progress = store.progress('project_1');
  assert.equal(progress.configured, true);
  assert.equal(progress.percent, 83);
  assert.equal(progress.total, 3);
  assert.equal(progress.completed, 1);
  assert.equal(progress.active, 1);
  assert.equal(progress.cancelled, 1);
  assert.equal(progress.totalWeight, 3);
});

test('milestone status deterministically controls boundary progress', () => {
  const store = new ProjectMilestoneStore([], () => true);
  const planned = store.create('project_1', { title: 'Plan', status: 'planned', progress: 90 });
  const completed = store.create('project_1', { title: 'Release', status: 'completed', progress: 4 });

  assert.equal(planned.progress, 0);
  assert.equal(completed.progress, 100);

  const updated = store.update('project_1', planned.id, { status: 'in_progress', progress: 42, weight: 999 });
  assert.equal(updated.progress, 42);
  assert.equal(updated.weight, 100);

  const done = store.update('project_1', planned.id, { status: 'completed', progress: 12 });
  assert.equal(done.progress, 100);
  assert.ok(done.completedAt);
});

test('empty milestone plan returns null project percentage instead of a fake zero progress estimate', () => {
  const summary = summarizeMilestones([]);
  assert.equal(summary.configured, false);
  assert.equal(summary.percent, null);
  assert.equal(summary.totalWeight, 0);
});

test('unknown projects and milestones are rejected', () => {
  const store = new ProjectMilestoneStore([], () => false);
  assert.throws(() => store.create('missing', { title: 'Nope' }), /Project not found/);

  const validStore = new ProjectMilestoneStore([], () => true);
  assert.throws(() => validStore.update('project_1', 'missing', { progress: 10 }), /Milestone not found/);
});
