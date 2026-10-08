import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission } from '../src/domain.js';
import { MissionExecutor } from '../src/mission-executor.js';
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupMission(maxRetries: number) {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'planning-test',
    name: 'Planning Test',
    repository: 'example/planning-test',
    isExisting: true,
  });
  const tasks = new TaskEngine(projects, new ProviderRouter(providers));
  const mission = tasks.createMission({
    projectId: project.id,
    objective: 'Analyze the repository safely',
    riskLevel: 'READ',
    dataClass: 'private_code',
    autonomous: { maxRetries, previewRequired: false },
  });
  return { projects, tasks, mission };
}

function abortingPlanner(attempts: { value: number }) {
  return {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
    chooseFiles: async (_project: unknown, _mission: Mission, _paths: string[], signal?: AbortSignal) => {
      attempts.value += 1;
      return await new Promise<string[]>((resolve, reject) => {
        if (!signal) return resolve(['README.md']);
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    analyze: async () => 'unused',
    planChanges: async () => ({ summary: 'unused', commitMessage: 'unused', files: [] }),
  };
}

const github = {
  readiness: () => ({ configured: true }),
  listFiles: async () => ['README.md'],
  readFiles: async () => [{ path: 'README.md', content: '# test' }],
};

test('planning timeout retries only up to the mission retry budget', async () => {
  const { projects, tasks, mission } = setupMission(1);
  const attempts = { value: 0 };
  const executor = new MissionExecutor(
    tasks,
    projects,
    abortingPlanner(attempts) as any,
    github as any,
    undefined,
    { planningTimeoutMs: 20, retryBaseDelayMs: 1, watchdogGraceMs: 0 },
  );

  executor.executeSoon(mission.id);
  await wait(120);

  const failed = tasks.getMission(mission.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.execution?.retryCount, 1);
  assert.match(failed?.execution?.blockedReason ?? '', /Planning file selection failed/i);
  assert.equal(attempts.value, 2);
  assert.equal(tasks.listEvents(mission.id).filter((event) => event.type === 'mission.retry_scheduled').length, 1);
});

test('zero retry budget fails the timed-out mission without looping', async () => {
  const { projects, tasks, mission } = setupMission(0);
  const attempts = { value: 0 };
  const executor = new MissionExecutor(
    tasks,
    projects,
    abortingPlanner(attempts) as any,
    github as any,
    undefined,
    { planningTimeoutMs: 15, retryBaseDelayMs: 1, watchdogGraceMs: 0 },
  );

  executor.executeSoon(mission.id);
  await wait(70);

  assert.equal(tasks.getMission(mission.id)?.status, 'failed');
  assert.equal(tasks.getMission(mission.id)?.execution?.retryCount, 0);
  assert.equal(attempts.value, 1);
  assert.equal(tasks.listEvents(mission.id).some((event) => event.type === 'mission.retry_scheduled'), false);
});

test('watchdog marks an orphaned stale planning mission for bounded retry', async () => {
  const { projects, tasks, mission } = setupMission(0);
  tasks.transitionMission(mission.id, 'planning', 'Simulated orphaned planning state.', undefined, {
    planningStartedAt: new Date(Date.now() - 10_000).toISOString(),
  });

  const executor = new MissionExecutor(
    tasks,
    projects,
    abortingPlanner({ value: 0 }) as any,
    github as any,
    undefined,
    { planningTimeoutMs: 10, retryBaseDelayMs: 1, watchdogGraceMs: 0 },
  );

  executor.sweepStuckPlanning(Date.now());
  await wait(10);

  const failed = tasks.getMission(mission.id);
  assert.equal(failed?.status, 'failed');
  assert.match(failed?.execution?.blockedReason ?? '', /watchdog/i);
});
