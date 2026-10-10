import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewRuntimeError } from '../src/coolify-tools.js';
import type { Mission } from '../src/domain.js';
import type { ProviderDescriptor } from '../src/provider-router.js';
import { ProviderRouter } from '../src/provider-router.js';
import { ProjectRegistry } from '../src/project-registry.js';
import { RuntimeSelfHealingExecutor } from '../src/runtime-self-healing-executor.js';
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

function setupMission() {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'runtime-heal',
    name: 'Runtime Heal',
    repository: 'example/runtime-heal',
    isExisting: true,
  });
  const mission: Mission = {
    id: 'mission_runtime_heal',
    projectId: project.id,
    objective: 'Ship a working preview',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
    status: 'queued',
    providerChain: ['private-test'],
    autonomous: {
      enabled: true,
      maxRetries: 5,
      previewRequired: true,
      production: 'ask',
      destructive: 'deny',
      paidAi: false,
      notifications: 'important_only',
    },
    approvalRequired: false,
    execution: {
      branch: 'taso/runtime-heal/mission-1',
      commitSha: 'runtimebroken001',
      pullRequestNumber: 99,
      pullRequestUrl: 'https://github.com/example/runtime-heal/pull/99',
      workPlan: [{
        id: 'backend-web',
        title: 'Build runtime',
        objective: 'Serve the application',
        specialist: 'backend',
        status: 'completed',
        dependsOn: [],
        targetPaths: ['src/server.ts'],
        progress: 100,
        attempts: 1,
        maxAttempts: 2,
        outputSummary: 'Runtime implemented',
      }],
      workspaceCheckpoint: {
        version: 1,
        files: [{
          path: 'src/server.ts',
          content: '// runtime broken',
          producedByStepId: 'backend-web',
          updatedAt: '2026-10-10T04:20:00.000Z',
        }],
        completedStepIds: ['backend-web'],
        updatedAt: '2026-10-10T04:20:00.000Z',
      },
      artifacts: [],
      agentRuns: [],
    },
    createdAt: '2026-10-10T04:10:00.000Z',
    updatedAt: '2026-10-10T04:20:00.000Z',
  };
  const tasks = new TaskEngine(projects, new ProviderRouter(providers), undefined, [mission]);
  return { projects, project, tasks, mission };
}

function runtimeFailure() {
  return new PreviewRuntimeError({
    deploymentUuid: 'deploy-broken',
    deploymentAttempts: 2,
    probe: {
      healthy: false,
      url: 'https://preview.example.test',
      status: 500,
      latencyMs: 42,
      summary: 'Preview returned unhealthy HTTP 500.',
      bodyPreview: 'Internal Server Error in src/server.ts',
    },
  });
}

test('runtime failure is repaired on the same PR, rechecked by CI, and redeployed until healthy', async () => {
  const { projects, tasks, mission } = setupMission();
  const checked: string[] = [];
  const commits: Array<{ branch: string; paths: string[] }> = [];
  let deployCount = 0;
  const github = {
    readiness: () => ({ configured: true }),
    waitForChecks: async (_repository: string, sha: string) => {
      checked.push(sha);
      return 'success' as const;
    },
    readFiles: async (_repository: string, branch: string, paths: string[]) => {
      assert.equal(branch, mission.execution?.branch);
      assert.deepEqual(paths, ['src/server.ts']);
      return [{ path: 'src/server.ts', content: '// runtime broken' }];
    },
    commitChanges: async (_repository: string, branch: string, changes: Array<{ path: string; content: string }>) => {
      commits.push({ branch, paths: changes.map((change) => change.path) });
      return 'runtimefixed001';
    },
  };
  const planner = {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
    planRuntimeRepair: async (_project: unknown, _mission: Mission, files: Array<{ path: string; content: string }>, diagnostics: { status?: number; bodyPreview?: string }, allowedPaths: string[]) => {
      assert.equal(diagnostics.status, 500);
      assert.match(diagnostics.bodyPreview ?? '', /src\/server\.ts/);
      assert.deepEqual(allowedPaths, ['src/server.ts']);
      assert.equal(files[0]?.content, '// runtime broken');
      return {
        summary: 'Fix runtime boot failure',
        commitMessage: 'fix: repair preview runtime',
        files: [{ path: 'src/server.ts', content: '// runtime fixed' }],
      };
    },
  };
  const coolify = {
    readiness: () => ({ configured: true }),
    hasProject: () => true,
    deploy: async () => {
      deployCount += 1;
      if (deployCount === 1) throw runtimeFailure();
      return {
        deploymentUuid: 'deploy-healthy',
        status: 'completed',
        url: 'https://preview.example.test',
        runtimeProbe: {
          healthy: true,
          url: 'https://preview.example.test',
          status: 200,
          latencyMs: 20,
          summary: 'Preview responded with HTTP 200.',
        },
      };
    },
  };

  const executor = new RuntimeSelfHealingExecutor(
    tasks,
    projects,
    planner as any,
    github as any,
    coolify as any,
    { runtimeRepairMaxAttempts: 1, ciRepairMaxAttempts: 0 },
  );
  const completed = await executor.execute(mission.id);

  assert.equal(completed.status, 'preview_ready');
  assert.deepEqual(checked, ['runtimebroken001', 'runtimefixed001']);
  assert.equal(deployCount, 2);
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.branch, mission.execution?.branch);
  assert.deepEqual(commits[0]?.paths, ['src/server.ts']);
  assert.equal(completed.execution?.commitSha, 'runtimefixed001');
  assert.equal(completed.execution?.runtimeRepairAttempts, 1);
  assert.equal(completed.execution?.maxRuntimeRepairAttempts, 1);
  assert.equal(completed.execution?.workspaceCheckpoint?.files[0]?.content, '// runtime fixed');
  assert.equal(completed.execution?.previewDeploymentUuid, 'deploy-healthy');
  assert.ok((completed.execution?.artifacts ?? []).some((artifact) => artifact.type === 'runtime-diagnostic'));
  assert.ok((completed.execution?.artifacts ?? []).some((artifact) => artifact.type === 'runtime-repair-commit'));
});

test('runtime self-heal fails closed without changing code when repair budget is zero', async () => {
  const { projects, tasks, mission } = setupMission();
  let commitCount = 0;
  const github = {
    readiness: () => ({ configured: true }),
    waitForChecks: async () => 'success' as const,
    commitChanges: async () => {
      commitCount += 1;
      return 'must-not-commit';
    },
  };
  const planner = { readiness: () => ({ configured: true, providers: [], legacy: false }) };
  const coolify = {
    readiness: () => ({ configured: true }),
    hasProject: () => true,
    deploy: async () => { throw runtimeFailure(); },
  };
  const executor = new RuntimeSelfHealingExecutor(
    tasks,
    projects,
    planner as any,
    github as any,
    coolify as any,
    { runtimeRepairMaxAttempts: 0, ciRepairMaxAttempts: 0 },
  );

  const failed = await executor.execute(mission.id);

  assert.equal(failed.status, 'failed');
  assert.equal(commitCount, 0);
  assert.equal(failed.execution?.runtimeRepairAttempts, 0);
  assert.match(failed.execution?.blockedReason ?? '', /after 0 automatic runtime repair attempt/i);
  assert.ok((failed.execution?.artifacts ?? []).some((artifact) => artifact.type === 'runtime-diagnostic'));
});
