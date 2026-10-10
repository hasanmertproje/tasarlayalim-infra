import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission } from '../src/domain.js';
import type { ProviderDescriptor } from '../src/provider-router.js';
import { ProviderRouter } from '../src/provider-router.js';
import { ProjectRegistry } from '../src/project-registry.js';
import { TaskEngine } from '../src/task-engine.js';

const providers: ProviderDescriptor[] = [{
  id: 'private-test',
  displayName: 'Private Test',
  enabled: true,
  costClass: 'free',
  strength: 100,
  latency: 10,
  allowedDataClasses: ['private_code'],
}];

test('mission-level automatic retry preserves completed checkpoint work and resets only incomplete step attempts', () => {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'retry-budget',
    name: 'Retry Budget',
    repository: 'example/retry-budget',
    isExisting: true,
  });

  const mission: Mission = {
    id: 'mission_retry_checkpoint',
    projectId: project.id,
    objective: 'Resume checkpoint after specialist budget exhaustion',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
    status: 'running',
    providerChain: ['private-test'],
    autonomous: {
      enabled: true,
      maxRetries: 5,
      previewRequired: false,
      production: 'ask',
      destructive: 'deny',
      paidAi: false,
      notifications: 'important_only',
    },
    approvalRequired: false,
    execution: {
      retryCount: 0,
      workPlan: [
        {
          id: 'frontend-ui',
          title: 'Frontend',
          objective: 'Build frontend',
          specialist: 'frontend',
          status: 'completed',
          dependsOn: [],
          targetPaths: ['src/App.tsx'],
          progress: 100,
          attempts: 1,
          maxAttempts: 2,
          outputSummary: 'frontend complete',
        },
        {
          id: 'backend-api',
          title: 'Backend',
          objective: 'Build backend',
          specialist: 'backend',
          status: 'failed',
          dependsOn: ['frontend-ui'],
          targetPaths: ['src/api.ts'],
          progress: 10,
          attempts: 2,
          maxAttempts: 2,
          lastAttemptAt: '2026-10-10T03:40:00.000Z',
          error: 'provider timeout',
        },
      ],
      workspaceCheckpoint: {
        version: 1,
        files: [{
          path: 'src/App.tsx',
          content: '// checkpointed frontend',
          producedByStepId: 'frontend-ui',
          updatedAt: '2026-10-10T03:39:00.000Z',
        }],
        completedStepIds: ['frontend-ui'],
        updatedAt: '2026-10-10T03:39:00.000Z',
      },
    },
    createdAt: '2026-10-10T03:30:00.000Z',
    updatedAt: '2026-10-10T03:40:00.000Z',
  };

  const tasks = new TaskEngine(projects, new ProviderRouter(providers), undefined, [mission]);
  const result = tasks.scheduleAutomaticRetry(mission.id, 'specialist attempt budget exhausted', 1000);
  const queued = result.mission;
  const frontend = queued.execution?.workPlan?.find((step) => step.id === 'frontend-ui');
  const backend = queued.execution?.workPlan?.find((step) => step.id === 'backend-api');

  assert.equal(result.scheduled, true);
  assert.equal(queued.status, 'queued');
  assert.equal(frontend?.status, 'completed');
  assert.equal(frontend?.attempts, 1);
  assert.equal(frontend?.outputSummary, 'frontend complete');
  assert.equal(backend?.status, 'queued');
  assert.equal(backend?.attempts, 0);
  assert.equal(backend?.lastAttemptAt, undefined);
  assert.equal(backend?.error, undefined);
  assert.equal(queued.execution?.workspaceCheckpoint?.files[0]?.content, '// checkpointed frontend');
  assert.deepEqual(queued.execution?.workspaceCheckpoint?.completedStepIds, ['frontend-ui']);
});
