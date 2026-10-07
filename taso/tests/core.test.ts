import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderDescriptor } from '../src/provider-router.js';
import { ProviderRouter } from '../src/provider-router.js';
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
