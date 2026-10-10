import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission, MissionStep } from '../src/domain.js';
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

function baseProject() {
  const projects = new ProjectRegistry();
  const project = projects.create({
    slug: 'durable-resume',
    name: 'Durable Resume',
    repository: 'example/durable-resume',
    isExisting: true,
  });
  return { projects, project };
}

function step(id: string, status: MissionStep['status'], path: string, dependsOn: string[] = []): MissionStep {
  return {
    id,
    title: id,
    objective: `Execute ${id}`,
    specialist: id.startsWith('front') ? 'frontend' : 'backend',
    status,
    dependsOn,
    targetPaths: [path],
    progress: status === 'completed' ? 100 : 10,
    attempts: 1,
    maxAttempts: 2,
    outputSummary: status === 'completed' ? `${id} persisted output` : undefined,
  };
}

function interruptedMission(projectId: string): Mission {
  const first = step('frontend-ui', 'completed', 'src/App.tsx');
  const second = step('backend-api', 'running', 'src/api.ts', ['frontend-ui']);
  return {
    id: 'mission_resume_test',
    projectId,
    objective: 'Resume an interrupted multi-agent implementation',
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
      orchestrationSummary: 'Persisted work graph.',
      progressPercent: 47,
      currentAction: 'Backend worker was interrupted.',
      workPlan: [first, second],
      artifacts: [],
      handoffs: [],
      agentRuns: [],
      workspaceCheckpoint: {
        version: 1,
        files: [{
          path: 'src/App.tsx',
          content: '// durable frontend v1',
          producedByStepId: 'frontend-ui',
          updatedAt: '2026-10-10T03:30:00.000Z',
        }],
        completedStepIds: ['frontend-ui'],
        updatedAt: '2026-10-10T03:30:00.000Z',
      },
    },
    createdAt: '2026-10-10T03:20:00.000Z',
    updatedAt: '2026-10-10T03:30:00.000Z',
  };
}

async function waitForMission(tasks: TaskEngine, id: string, terminal: string[] = ['completed', 'failed'], timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mission = tasks.getMission(id);
    if (mission && terminal.includes(mission.status)) return mission;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Mission ${id} did not reach ${terminal.join('/')} before timeout.`);
}

test('Core restart resumes only incomplete steps from the durable checkpoint', async () => {
  const { projects, project } = baseProject();
  const mission = interruptedMission(project.id);
  const tasks = new TaskEngine(projects, new ProviderRouter(providers), undefined, [mission]);
  const recovered = tasks.recoverInterruptedMissions();

  assert.equal(recovered.length, 1);
  assert.equal(tasks.getMission(mission.id)?.status, 'queued');
  assert.equal(tasks.getMission(mission.id)?.execution?.resumeAfterRestart, true);
  assert.equal(tasks.getMission(mission.id)?.execution?.workPlan?.[0]?.status, 'completed');
  assert.equal(tasks.getMission(mission.id)?.execution?.workPlan?.[1]?.status, 'queued');

  const plannerCalls: string[] = [];
  const planner = {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
    chooseFiles: async () => { throw new Error('file selection must not rerun during checkpoint resume'); },
    analyze: async () => { throw new Error('analysis must not run'); },
    planChanges: async () => { throw new Error('legacy planner must not run'); },
    decomposeMission: async () => { throw new Error('mission decomposition must not rerun'); },
    planStepChanges: async (_project: unknown, _mission: Mission, files: Array<{ path: string; content: string }>, currentStep: MissionStep) => {
      plannerCalls.push(currentStep.id);
      assert.equal(currentStep.id, 'backend-api');
      assert.ok(files.some((file) => file.path === 'src/App.tsx' && file.content === '// durable frontend v1'));
      return {
        summary: 'backend resumed successfully',
        commitMessage: 'resume backend',
        files: [{ path: 'src/api.ts', content: '// resumed backend v2' }],
      };
    },
  };

  let publishCount = 0;
  let publishedPaths: string[] = [];
  const github = {
    readiness: () => ({ configured: true }),
    listFiles: async () => ['src/App.tsx', 'src/api.ts'],
    readFiles: async (_repository: string, _branch: string, paths: string[]) => paths.map((path) => ({ path, content: `// repository ${path}` })),
    createPullRequestWithChanges: async (input: { branch: string; changes: Array<{ path: string }> }) => {
      publishCount += 1;
      publishedPaths = input.changes.map((change) => change.path).sort();
      return {
        branch: input.branch,
        commitSha: 'resume123456789',
        number: 72,
        url: 'https://github.com/example/durable-resume/pull/72',
      };
    },
    waitForChecks: async () => 'success' as const,
  };

  new MissionExecutor(tasks, projects, planner as any, github as any, undefined, { planningTimeoutMs: 10_000, stepMaxAttempts: 2 });
  const completed = await waitForMission(tasks, mission.id);

  assert.equal(completed.status, 'completed');
  assert.deepEqual(plannerCalls, ['backend-api']);
  assert.equal(publishCount, 1);
  assert.deepEqual(publishedPaths, ['src/App.tsx', 'src/api.ts']);
  assert.deepEqual(completed.execution?.workspaceCheckpoint?.completedStepIds.sort(), ['backend-api', 'frontend-ui']);
  assert.equal(completed.execution?.workspaceCheckpoint?.files.find((file) => file.path === 'src/App.tsx')?.content, '// durable frontend v1');
  assert.equal(completed.execution?.workspaceCheckpoint?.files.find((file) => file.path === 'src/api.ts')?.content, '// resumed backend v2');
});

test('restart after publishing resumes existing CI instead of opening a duplicate PR', async () => {
  const { projects, project } = baseProject();
  const mission = interruptedMission(project.id);
  mission.status = 'testing';
  mission.execution = {
    ...mission.execution,
    branch: 'taso/durable-resume/test',
    commitSha: 'existingcommit123',
    pullRequestNumber: 88,
    pullRequestUrl: 'https://github.com/example/durable-resume/pull/88',
    currentAction: 'CI was in progress.',
  };
  const tasks = new TaskEngine(projects, new ProviderRouter(providers), undefined, [mission]);
  tasks.recoverInterruptedMissions();

  let publishCount = 0;
  let checkCount = 0;
  const github = {
    readiness: () => ({ configured: true }),
    listFiles: async () => { throw new Error('repository planning must not rerun after publishing'); },
    readFiles: async () => [],
    createPullRequestWithChanges: async () => {
      publishCount += 1;
      throw new Error('duplicate PR publish attempted');
    },
    waitForChecks: async (repository: string, sha: string) => {
      checkCount += 1;
      assert.equal(repository, 'example/durable-resume');
      assert.equal(sha, 'existingcommit123');
      return 'success' as const;
    },
  };
  const planner = {
    readiness: () => ({ configured: true, providers: [], legacy: false }),
  };

  new MissionExecutor(tasks, projects, planner as any, github as any, undefined, { planningTimeoutMs: 10_000 });
  const completed = await waitForMission(tasks, mission.id);

  assert.equal(completed.status, 'completed');
  assert.equal(checkCount, 1);
  assert.equal(publishCount, 0);
  assert.equal(completed.execution?.pullRequestNumber, 88);
});

test('HIGH_IMPACT interrupted execution never auto-resumes after restart', () => {
  const { projects, project } = baseProject();
  const mission = interruptedMission(project.id);
  mission.riskLevel = 'HIGH_IMPACT';
  mission.approvalRequired = true;
  mission.approvedAt = '2026-10-10T03:15:00.000Z';
  const tasks = new TaskEngine(projects, new ProviderRouter(providers), undefined, [mission]);

  tasks.recoverInterruptedMissions();
  const recovered = tasks.getMission(mission.id)!;

  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.execution?.resumeAfterRestart, false);
  assert.match(recovered.execution?.blockedReason ?? '', /operator review/i);
});
