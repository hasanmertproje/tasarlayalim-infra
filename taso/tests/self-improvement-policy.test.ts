import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderDescriptor } from '../src/provider-router.js';
import { ProviderRouter } from '../src/provider-router.js';
import { ProjectRegistry } from '../src/project-registry.js';
import { TaskEngine } from '../src/task-engine.js';

const providers: ProviderDescriptor[] = [
  {
    id: 'private-test',
    displayName: 'Private Test',
    enabled: true,
    costClass: 'free',
    strength: 100,
    latency: 10,
    allowedDataClasses: ['private_code'],
  },
];

function setup() {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'taso-self-improvement',
    name: 'Taso Self-Improvement',
    repository: 'hasanmertproje/tasarlayalim-infra',
    defaultBranch: 'main',
    isExisting: true,
  });
  return { project, tasks: new TaskEngine(projects, new ProviderRouter(providers)) };
}

test('self-improvement WRITE missions always wait for explicit approval', () => {
  const { project, tasks } = setup();
  const mission = tasks.createMission({
    projectId: project.id,
    objective: 'Refactor Taso agent orchestration safely',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
  });

  assert.equal(mission.status, 'waiting_approval');
  assert.equal(mission.approvalRequired, true);
  assert.equal(tasks.listEvents(mission.id).at(-1)?.type, 'mission.approval_required');
});

test('self-improvement READ missions remain autonomous for analysis only', () => {
  const { project, tasks } = setup();
  const mission = tasks.createMission({
    projectId: project.id,
    objective: 'Analyze Taso Core for improvement opportunities without changing code',
    riskLevel: 'READ',
    dataClass: 'private_code',
  });

  assert.equal(mission.status, 'queued');
  assert.equal(mission.approvalRequired, false);
});
