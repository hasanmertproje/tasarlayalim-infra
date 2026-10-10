import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission } from '../src/domain.js';
import { MissionExecutor } from '../src/mission-executor.js';
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

function setupPublishedMission() {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'ci-self-heal',
    name: 'CI Self Heal',
    repository: 'example/ci-self-heal',
    isExisting: true,
  });
  const mission: Mission = {
    id: 'mission_ci_self_heal',
    projectId: project.id,
    objective: 'Implement feature and keep CI green',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
    status: 'queued',
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
      branch: 'taso/ci-self-heal/mission-1',
      commitSha: 'broken0000001',
      pullRequestNumber: 88,
      pullRequestUrl: 'https://github.com/example/ci-self-heal/pull/88',
      workPlan: [{
        id: 'backend-api',
        title: 'Build API',
        objective: 'Implement API',
        specialist: 'backend',
        status: 'completed',
        dependsOn: [],
        targetPaths: ['src/api.ts'],
        progress: 100,
        attempts: 1,
        maxAttempts: 2,
        outputSummary: 'API implemented',
      }],
      workspaceCheckpoint: {
        version: 1,
        files: [{
          path: 'src/api.ts',
          content: '// broken implementation',
          producedByStepId: 'backend-api',
          updatedAt: '2026-10-10T03:50:00.000Z',
        }],
        completedStepIds: ['backend-api'],
        updatedAt: '2026-10-10T03:50:00.000Z',
      },
      artifacts: [],
      agentRuns: [],
    },
    createdAt: '2026-10-10T03:40:00.000Z',
    updatedAt: '2026-10-10T03:50:00.000Z',
  };
  const tasks = new TaskEngine(projects, new ProviderRouter(providers), undefined, [mission]);
  return { projects, project, tasks, mission };
}

function diagnostics(sha: string) {
  return {
    commitSha: sha,
    summary: 'TypeScript compile failed in src/api.ts',
    failedChecks: [{ name: 'Taso CI', conclusion: 'failure', output: 'TS2322 in src/api.ts' }],
    failedJobs: [{ name: 'validate', conclusion: 'failure', failedSteps: ['Test Taso Core'] }],
    logExcerpt: 'src/api.ts(4,2): error TS2322',
  };
}

test('failed CI is repaired on the same PR branch and rechecked until green', async () => {
  const { projects, tasks, mission } = setupPublishedMission();
  const checks: string[] = [];
  const commits: Array<{ branch: string; paths: string[] }> = [];
  let openedPr = false;
  const github = {
    readiness: () => ({ configured: true }),
    waitForChecks: async (_repository: string, sha: string) => {
      checks.push(sha);
      return checks.length === 1 ? 'failed' as const : 'success' as const;
    },
    getFailureDiagnostics: async (_repository: string, sha: string) => diagnostics(sha),
    readFiles: async (_repository: string, branch: string, paths: string[]) => {
      assert.equal(branch, mission.execution?.branch);
      assert.deepEqual(paths, ['src/api.ts']);
      return [{ path: 'src/api.ts', content: '// broken implementation' }];
    },
    commitChanges: async (_repository: string, branch: string, changes: Array<{ path: string; content: string }>) => {
      commits.push({ branch, paths: changes.map((change) => change.path) });
      return 'repair0000001';
    },
    createPullRequestWithChanges: async () => {
      openedPr = true;
      throw new Error('duplicate PR must never be opened during CI repair');
    },
  };
  const planner = {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
    planCiRepair: async (_project: unknown, _mission: Mission, files: Array<{ path: string; content: string }>, report: ReturnType<typeof diagnostics>, allowedPaths: string[]) => {
      assert.equal(report.summary, 'TypeScript compile failed in src/api.ts');
      assert.deepEqual(allowedPaths, ['src/api.ts']);
      assert.equal(files[0]?.content, '// broken implementation');
      return {
        summary: 'Fix TypeScript assignment',
        commitMessage: 'fix: repair CI compile error',
        files: [{ path: 'src/api.ts', content: '// repaired implementation' }],
      };
    },
  };
  const executor = new MissionExecutor(tasks, projects, planner as any, github as any, undefined, { ciRepairMaxAttempts: 2 });

  const completed = await executor.execute(mission.id);

  assert.equal(completed.status, 'completed');
  assert.deepEqual(checks, ['broken0000001', 'repair0000001']);
  assert.equal(openedPr, false);
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.branch, mission.execution?.branch);
  assert.deepEqual(commits[0]?.paths, ['src/api.ts']);
  assert.equal(completed.execution?.ciRepairAttempts, 1);
  assert.equal(completed.execution?.maxCiRepairAttempts, 2);
  assert.equal(completed.execution?.commitSha, 'repair0000001');
  assert.equal(completed.execution?.workspaceCheckpoint?.files[0]?.content, '// repaired implementation');
  assert.ok((completed.execution?.artifacts ?? []).some((artifact) => artifact.type === 'ci-diagnostic'));
  assert.ok((completed.execution?.artifacts ?? []).some((artifact) => artifact.type === 'repair-commit'));
});

test('CI self-heal stops after the bounded repair budget is exhausted', async () => {
  const { projects, tasks, mission } = setupPublishedMission();
  let checkCount = 0;
  let commitCount = 0;
  const github = {
    readiness: () => ({ configured: true }),
    waitForChecks: async () => {
      checkCount += 1;
      return 'failed' as const;
    },
    getFailureDiagnostics: async (_repository: string, sha: string) => diagnostics(sha),
    readFiles: async () => [{ path: 'src/api.ts', content: `// current ${commitCount}` }],
    commitChanges: async () => {
      commitCount += 1;
      return `repair000000${commitCount}`;
    },
  };
  const planner = {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
    planCiRepair: async () => ({
      summary: 'bounded repair',
      commitMessage: 'fix: bounded repair',
      files: [{ path: 'src/api.ts', content: `// repair ${commitCount + 1}` }],
    }),
  };
  const executor = new MissionExecutor(tasks, projects, planner as any, github as any, undefined, { ciRepairMaxAttempts: 2 });

  const failed = await executor.execute(mission.id);

  assert.equal(failed.status, 'failed');
  assert.equal(commitCount, 2);
  assert.equal(checkCount, 3);
  assert.equal(failed.execution?.ciRepairAttempts, 2);
  assert.match(failed.execution?.blockedReason ?? '', /after 2 automatic repair attempt/i);
  assert.equal(failed.execution?.lastCiFailureSummary, 'TypeScript compile failed in src/api.ts');
});

test('out-of-scope CI repair output is rejected before any repair commit', async () => {
  const { projects, tasks, mission } = setupPublishedMission();
  let commitCount = 0;
  const github = {
    readiness: () => ({ configured: true }),
    waitForChecks: async () => 'failed' as const,
    getFailureDiagnostics: async (_repository: string, sha: string) => diagnostics(sha),
    readFiles: async () => [{ path: 'src/api.ts', content: '// broken implementation' }],
    commitChanges: async () => {
      commitCount += 1;
      return 'should-not-happen';
    },
  };
  const planner = {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
    planCiRepair: async () => ({
      summary: 'attempted scope expansion',
      commitMessage: 'bad repair',
      files: [{ path: '.github/workflows/ci.yml', content: 'name: bypass' }],
    }),
  };
  const executor = new MissionExecutor(tasks, projects, planner as any, github as any, undefined, { ciRepairMaxAttempts: 2 });

  executor.executeSoon(mission.id);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const failed = tasks.getMission(mission.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(commitCount, 0);
  assert.match(failed?.execution?.blockedReason ?? '', /out-of-scope path/i);
});
