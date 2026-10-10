import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderDescriptor } from '../src/provider-router.js';
import { ProviderRouter, defaultProviders } from '../src/provider-router.js';
import { ProjectRegistry } from '../src/project-registry.js';
import { TaskEngine } from '../src/task-engine.js';

const providers: ProviderDescriptor[] = [
  {
    id: 'free-public',
    displayName: 'Free Public',
    enabled: true,
    costClass: 'free',
    strength: 80,
    latency: 80,
    allowedDataClasses: ['public'],
  },
  {
    id: 'credit-private',
    displayName: 'Credit Private',
    enabled: true,
    costClass: 'credit',
    strength: 90,
    latency: 60,
    allowedDataClasses: ['private_code'],
  },
  {
    id: 'paid-sensitive',
    displayName: 'Paid Sensitive',
    enabled: true,
    costClass: 'paid',
    strength: 100,
    latency: 70,
    allowedDataClasses: ['sensitive'],
  },
];

test('router prefers free providers for public data', () => {
  const router = new ProviderRouter(providers);
  const route = router.route({ dataClass: 'public', paidAi: false, preferFree: true });
  assert.equal(route[0]?.id, 'free-public');
  assert.equal(route.some((provider) => provider.id === 'paid-sensitive'), false);
});

test('router will not leak private code to public-only provider', () => {
  const router = new ProviderRouter(providers);
  const route = router.route({ dataClass: 'private_code', paidAi: false, preferFree: true });
  assert.deepEqual(route.map((provider) => provider.id), ['credit-private']);
});

test('existing projects preserve their architecture by default', () => {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'maria-cicek',
    name: 'Maria Çiçek',
    repository: 'example/maria-cicek',
    isExisting: true,
  });

  assert.equal(project.technology.stackMode, 'preserve');
  assert.equal(project.technology.architecture, 'preserve_existing');
});

test('project manifest stores discovered technology for later missions', () => {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'reksa-reklam',
    name: 'Reksa Reklam',
    repository: 'example/reksa-reklam',
    isExisting: true,
  });

  const manifest = projects.upsertManifest(project.id, {
    source: 'discovered',
    languages: ['PHP', 'JavaScript'],
    frameworks: ['Custom MVC'],
    architecture: 'mvc',
    packageManagers: ['composer'],
    databases: ['mysql'],
    commands: { test: 'php vendor/bin/phpunit' },
    confidence: 0.9,
  });

  assert.equal(manifest.projectId, project.id);
  assert.equal(manifest.architecture, 'mvc');
  assert.deepEqual(projects.getManifest(project.id)?.languages, ['PHP', 'JavaScript']);
});

test('high impact mission waits for approval and records timeline events', () => {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'reksa',
    name: 'Reksa Reklam',
    repository: 'example/reksa',
    isExisting: true,
  });
  const engine = new TaskEngine(projects, new ProviderRouter(providers));

  const mission = engine.createMission({
    projectId: project.id,
    objective: 'Deploy to production',
    riskLevel: 'HIGH_IMPACT',
    dataClass: 'private_code',
  });

  assert.equal(mission.status, 'waiting_approval');
  assert.equal(mission.autonomous.paidAi, false);
  assert.deepEqual(mission.providerChain, ['credit-private']);
  assert.deepEqual(
    engine.listEvents(mission.id).map((event) => event.type),
    ['mission.created', 'mission.approval_required'],
  );

  const approved = engine.approveMission(mission.id);
  assert.equal(approved.status, 'queued');
  assert.ok(approved.approvedAt);
  assert.equal(engine.listEvents(mission.id).at(-1)?.type, 'mission.approved');
});

test('executor state records artifacts and failed missions can retry safely', () => {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'executor-test',
    name: 'Executor Test',
    repository: 'example/executor-test',
    isExisting: true,
  });
  const engine = new TaskEngine(projects, new ProviderRouter(providers));
  const mission = engine.createMission({
    projectId: project.id,
    objective: 'Improve the hero section',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
  });

  engine.transitionMission(mission.id, 'running', 'Branch created.', undefined, {
    branch: 'taso/executor-test/12345678',
    pullRequestUrl: 'https://github.com/example/executor-test/pull/1',
  });
  const failed = engine.transitionMission(mission.id, 'failed', 'CI failed.', { checkState: 'failed' }, {
    checkState: 'failed',
    blockedReason: 'CI failed.',
  });
  assert.equal(failed.execution?.checkState, 'failed');
  assert.equal(failed.execution?.blockedReason, 'CI failed.');

  const retried = engine.retryMission(mission.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.execution?.blockedReason, undefined);
  assert.equal(engine.listEvents(mission.id).at(-1)?.type, 'mission.status_changed');
});

test('mission agent lifecycle records real progress and current action', () => {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'agent-runtime',
    name: 'Agent Runtime',
    repository: 'example/agent-runtime',
    isExisting: true,
  });
  const engine = new TaskEngine(projects, new ProviderRouter(providers));
  const mission = engine.createMission({
    projectId: project.id,
    objective: 'Implement a feature',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
  });

  const run = engine.startAgent(mission.id, 'builder', 'Applying repository changes.', 45);
  assert.equal(engine.getMission(mission.id)?.execution?.activeAgentRole, 'builder');
  assert.equal(engine.getMission(mission.id)?.execution?.progressPercent, 45);
  assert.equal(engine.getMission(mission.id)?.execution?.agentRuns?.[0]?.status, 'running');

  engine.updateAgent(mission.id, run.id, 'Opening pull request.', 60, '3 files changed');
  assert.equal(engine.getMission(mission.id)?.execution?.currentAction, 'Opening pull request.');
  assert.equal(engine.getMission(mission.id)?.execution?.progressPercent, 60);

  engine.completeAgent(mission.id, run.id, 'Pull request opened.', 66);
  assert.equal(engine.getMission(mission.id)?.execution?.activeAgentRole, undefined);
  assert.equal(engine.getMission(mission.id)?.execution?.agentRuns?.[0]?.status, 'completed');
  assert.deepEqual(
    engine.listEvents(mission.id).slice(-3).map((event) => event.type),
    ['agent.started', 'agent.progress', 'agent.completed'],
  );
});

test('scoped provider credentials enable routing without legacy provider keys', () => {
  const previousKey = process.env.TASO_PROVIDER_NVIDIA_API_KEY;
  const previousData = process.env.TASO_PROVIDER_NVIDIA_DATA;
  const previousLegacy = process.env.NVIDIA_API_KEY;
  try {
    delete process.env.NVIDIA_API_KEY;
    process.env.TASO_PROVIDER_NVIDIA_API_KEY = 'test-only';
    process.env.TASO_PROVIDER_NVIDIA_DATA = 'public,private_code';
    const nvidia = defaultProviders().find((provider) => provider.id === 'nvidia');
    assert.equal(nvidia?.enabled, true);
    assert.deepEqual(nvidia?.allowedDataClasses, ['public', 'private_code']);
  } finally {
    if (previousKey === undefined) delete process.env.TASO_PROVIDER_NVIDIA_API_KEY;
    else process.env.TASO_PROVIDER_NVIDIA_API_KEY = previousKey;
    if (previousData === undefined) delete process.env.TASO_PROVIDER_NVIDIA_DATA;
    else process.env.TASO_PROVIDER_NVIDIA_DATA = previousData;
    if (previousLegacy === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousLegacy;
  }
});
