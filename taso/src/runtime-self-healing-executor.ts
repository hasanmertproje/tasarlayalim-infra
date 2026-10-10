import type { ChangePlan } from './agent-planner.js';
import { CoolifyTools, PreviewRuntimeError, type PreviewRuntimeProbe } from './coolify-tools.js';
import { createId, nowIso, type Mission, type MissionArtifact, type Project } from './domain.js';
import { GitHubTools } from './github-tools.js';
import { MissionExecutor, type MissionExecutorOptions } from './mission-executor.js';
import { MultiProviderPlanner } from './multi-provider-planner.js';
import type { ProjectRegistry } from './project-registry.js';
import { defaultProviders } from './provider-router.js';
import type { TaskEngine } from './task-engine.js';

const MAX_RUNTIME_REPAIR_CONTEXT_FILES = 12;

export type RuntimeSelfHealingExecutorOptions = MissionExecutorOptions & {
  runtimeRepairMaxAttempts?: number;
};

function boundedEnvInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function safeReason(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1200);
}

function assertRuntimeRepairChanges(mission: Mission, paths: string[], allowedPaths: string[], protectedPaths: string[] = []) {
  const allowed = new Set(allowedPaths);
  for (const path of paths) {
    const normalized = path.replace(/\\/g, '/');
    if (!allowed.has(path)) throw new Error(`Runtime repair attempted out-of-scope path: ${path}`);
    if (!normalized || normalized.startsWith('/') || normalized.includes('../')) throw new Error(`Unsafe runtime repair path: ${path}`);
    if (/(^|\/)(\.env(?:\.|$)|id_rsa|id_ed25519|secrets?\.|credentials?\.)/i.test(normalized)) {
      throw new Error(`Runtime repair refuses credential or secret path: ${path}`);
    }
    if (protectedPaths.some((protectedPath) => normalized === protectedPath || normalized.startsWith(`${protectedPath.replace(/\/$/, '')}/`))) {
      throw new Error(`Protected project path cannot be changed by runtime repair: ${path}`);
    }
    if (mission.riskLevel !== 'HIGH_IMPACT' && /(^|\/)(\.github\/workflows|migrations?|infra)(\/|$)|(^|\/)(docker-compose[^/]*\.ya?ml|Dockerfile)$/i.test(normalized)) {
      throw new Error(`Infrastructure path requires HIGH_IMPACT approval: ${path}`);
    }
  }
}

export class RuntimeSelfHealingExecutor extends MissionExecutor {
  private readonly maxRuntimeRepairAttempts: number;

  constructor(
    private readonly runtimeTasks: TaskEngine,
    private readonly runtimeProjects: ProjectRegistry,
    private readonly runtimePlanner = MultiProviderPlanner.fromEnv(defaultProviders().map((provider) => provider.id)),
    private readonly runtimeGithub = GitHubTools.fromEnv(),
    private readonly runtimeCoolify = CoolifyTools.fromEnv(),
    options: RuntimeSelfHealingExecutorOptions = {},
  ) {
    const { runtimeRepairMaxAttempts, ...baseOptions } = options;
    super(runtimeTasks, runtimeProjects, runtimePlanner, runtimeGithub, runtimeCoolify, baseOptions);
    this.maxRuntimeRepairAttempts = runtimeRepairMaxAttempts
      ?? boundedEnvInt('TASO_RUNTIME_REPAIR_ATTEMPTS', 1, 0, 2);
  }

  override readiness() {
    return {
      ...super.readiness(),
      maxRuntimeRepairAttempts: this.maxRuntimeRepairAttempts,
    };
  }

  private patchRuntimeExecution(mission: Mission, patch: NonNullable<Mission['execution']>, note?: string, metadata?: Record<string, unknown>) {
    mission.updatedAt = nowIso();
    mission.execution = { ...(mission.execution ?? {}), ...patch };
    if (note) this.runtimeTasks.noteMission(mission.id, note, metadata);
  }

  private addArtifact(mission: Mission, input: Omit<MissionArtifact, 'id' | 'missionId' | 'createdAt'>) {
    const artifact: MissionArtifact = {
      id: createId('artifact'),
      missionId: mission.id,
      createdAt: nowIso(),
      ...input,
    };
    this.patchRuntimeExecution(mission, {
      ...(mission.execution ?? {}),
      artifacts: [...(mission.execution?.artifacts ?? []), artifact],
    }, `Artifact ready: ${artifact.label}`, {
      artifactId: artifact.id,
      type: artifact.type,
      url: artifact.url,
    });
    return artifact;
  }

  private runtimeScope(mission: Mission, diagnostics: PreviewRuntimeProbe) {
    const checkpointPaths = [...new Set((mission.execution?.workspaceCheckpoint?.files ?? []).map((file) => file.path))];
    const evidence = `${diagnostics.summary}\n${diagnostics.bodyPreview ?? ''}`.toLowerCase();
    return checkpointPaths
      .sort((a, b) => Number(evidence.includes(b.toLowerCase())) - Number(evidence.includes(a.toLowerCase())))
      .slice(0, MAX_RUNTIME_REPAIR_CONTEXT_FILES);
  }

  private refreshCheckpoint(mission: Mission, plan: ChangePlan) {
    const checkpoint = mission.execution?.workspaceCheckpoint;
    if (!checkpoint) return;
    const replacements = new Map(plan.files.map((file) => [file.path, file.content]));
    const updatedAt = nowIso();
    this.patchRuntimeExecution(mission, {
      ...(mission.execution ?? {}),
      workspaceCheckpoint: {
        ...checkpoint,
        files: checkpoint.files.map((file) => replacements.has(file.path)
          ? { ...file, content: replacements.get(file.path)!, updatedAt }
          : file),
        updatedAt,
      },
    });
  }

  private async runRuntimeAgent<T>(
    mission: Mission,
    label: string,
    action: string,
    progress: number,
    work: (runId: string) => Promise<T>,
  ): Promise<T> {
    const run = this.runtimeTasks.startAgent(mission.id, 'builder', action, progress);
    run.label = label;
    run.specialist = label === 'Runtime Repair Engineer' ? 'qa' : 'repository-publisher';
    this.runtimeTasks.noteMission(mission.id, `${label} assigned.`, { agentRunId: run.id, specialist: run.specialist });
    try {
      const result = await work(run.id);
      this.runtimeTasks.completeAgent(mission.id, run.id, `${label} completed.`, Math.min(99, progress + 4));
      return result;
    } catch (error) {
      this.runtimeTasks.failAgent(mission.id, run.id, safeReason(error));
      throw error;
    }
  }

  private failRuntimeRepair(mission: Mission, reason: string, diagnostics: PreviewRuntimeProbe) {
    return this.runtimeTasks.transitionMission(mission.id, 'failed', reason, {
      runtimeFailure: diagnostics.summary,
      runtimeRepairAttempts: mission.execution?.runtimeRepairAttempts ?? 0,
    }, {
      blockedReason: reason,
      lastFailure: reason,
      lastRuntimeFailureSummary: diagnostics.summary,
      maxRuntimeRepairAttempts: this.maxRuntimeRepairAttempts,
    });
  }

  private async repairRuntimeFailure(project: Project, mission: Mission, failure: PreviewRuntimeError): Promise<Mission> {
    const diagnostics = failure.probe;
    const attempts = Math.max(0, mission.execution?.runtimeRepairAttempts ?? 0);
    this.patchRuntimeExecution(mission, {
      ...(mission.execution ?? {}),
      previewDeploymentUuid: failure.deploymentUuid,
      previewUrl: diagnostics.url,
      runtimeRepairAttempts: attempts,
      maxRuntimeRepairAttempts: this.maxRuntimeRepairAttempts,
      lastRuntimeFailureSummary: diagnostics.summary,
      currentAction: `Preview runtime failed. Diagnosing bounded repair scope (${attempts}/${this.maxRuntimeRepairAttempts}).`,
    }, 'Preview runtime diagnostics collected for bounded self-healing.', {
      deploymentUuid: failure.deploymentUuid,
      url: diagnostics.url,
      status: diagnostics.status,
      latencyMs: diagnostics.latencyMs,
      summary: diagnostics.summary,
    });
    this.addArtifact(mission, {
      type: 'runtime-diagnostic',
      label: `Runtime diagnostic · ${diagnostics.status ?? 'network'}`,
      url: diagnostics.url,
      summary: diagnostics.summary,
    });

    if (attempts >= this.maxRuntimeRepairAttempts) {
      return this.failRuntimeRepair(
        mission,
        `Preview remained unhealthy after ${attempts} automatic runtime repair attempt(s): ${diagnostics.summary}`,
        diagnostics,
      );
    }
    if (!this.runtimePlanner || !this.runtimeGithub) {
      return this.failRuntimeRepair(mission, `Preview is unhealthy, but runtime repair tools are not configured: ${diagnostics.summary}`, diagnostics);
    }
    const branch = mission.execution?.branch;
    if (!branch) return this.failRuntimeRepair(mission, 'Runtime self-heal requires the existing pull request branch.', diagnostics);

    const allowedPaths = this.runtimeScope(mission, diagnostics);
    if (!allowedPaths.length) {
      return this.failRuntimeRepair(mission, `Preview is unhealthy, but no durable mission-scoped files are available for safe runtime repair: ${diagnostics.summary}`, diagnostics);
    }
    const files = await this.runtimeGithub.readFiles(project.repository, branch, allowedPaths);
    const readablePaths = files.map((file) => file.path);
    if (!readablePaths.length) {
      return this.failRuntimeRepair(mission, 'Runtime self-heal could not read current mission-scoped files from the pull request branch.', diagnostics);
    }

    const nextAttempt = attempts + 1;
    const plan = await this.runRuntimeAgent(
      mission,
      'Runtime Repair Engineer',
      `Repairing unhealthy preview inside ${readablePaths.length} mission-scoped file(s).`,
      91,
      async (runId) => {
        const next = await this.runtimePlanner!.planRuntimeRepair(project, mission, files, diagnostics, readablePaths);
        const manifest = this.runtimeProjects.getManifest(project.id);
        assertRuntimeRepairChanges(mission, next.files.map((file) => file.path), readablePaths, manifest?.protectedPaths ?? []);
        this.runtimeTasks.updateAgent(mission.id, runId, `Runtime repair ${nextAttempt} prepared ${next.files.length} scoped file change(s).`, 94, next.summary);
        return next;
      },
    );

    const repairedSha = await this.runRuntimeAgent(
      mission,
      'Runtime Repair Publisher',
      `Committing runtime repair ${nextAttempt}/${this.maxRuntimeRepairAttempts} to the existing pull request branch.`,
      95,
      () => this.runtimeGithub!.commitChanges(project.repository, branch, plan.files, plan.commitMessage || `Taso runtime repair ${nextAttempt}`),
    );

    this.refreshCheckpoint(mission, plan);
    this.patchRuntimeExecution(mission, {
      ...(mission.execution ?? {}),
      commitSha: repairedSha,
      checkState: 'pending',
      runtimeRepairAttempts: nextAttempt,
      maxRuntimeRepairAttempts: this.maxRuntimeRepairAttempts,
      lastRuntimeFailureSummary: diagnostics.summary,
      previewDeploymentUuid: undefined,
      previewUrl: undefined,
      currentAction: `Runtime repair ${nextAttempt}/${this.maxRuntimeRepairAttempts} committed. Re-running CI before a fresh preview.`,
    }, `Runtime repair ${nextAttempt} committed to the existing PR branch.`, {
      commitSha: repairedSha,
      repairedPaths: plan.files.map((file) => file.path),
    });
    this.addArtifact(mission, {
      type: 'runtime-repair-commit',
      label: `Runtime repair #${nextAttempt} · ${repairedSha.slice(0, 8)}`,
      url: mission.execution?.pullRequestUrl,
      summary: plan.summary,
    });

    this.runtimeTasks.transitionMission(mission.id, 'failed', 'Runtime repair committed; preparing durable verification retry.', {
      commitSha: repairedSha,
      runtimeRepairAttempts: nextAttempt,
    }, {
      blockedReason: 'Runtime repair staged for verification retry.',
      lastFailure: diagnostics.summary,
    });
    const queued = this.runtimeTasks.retryMission(mission.id);
    return queued;
  }

  override async execute(id: string): Promise<Mission> {
    while (true) {
      try {
        return await super.execute(id);
      } catch (error) {
        if (!(error instanceof PreviewRuntimeError)) throw error;
        const mission = this.runtimeTasks.getMission(id);
        if (!mission) throw error;
        const project = this.runtimeProjects.get(mission.projectId);
        if (!project) throw error;
        const repaired = await this.repairRuntimeFailure(project, mission, error);
        if (repaired.status !== 'queued') return repaired;
      }
    }
  }
}
