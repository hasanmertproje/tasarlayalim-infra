import type { Mission, Project } from './domain.js';
import type { ProjectRegistry } from './project-registry.js';
import type { TaskEngine } from './task-engine.js';
import { MultiProviderPlanner } from './multi-provider-planner.js';
import { defaultProviders } from './provider-router.js';
import { GitHubTools } from './github-tools.js';
import { CoolifyTools } from './coolify-tools.js';

function assertRepository(repository: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Project repository must be an exact GitHub owner/repo slug before execution.');
  }
}

function safeBranch(project: Project, mission: Mission) {
  const suffix = mission.id.replace(/^mission_/, '').slice(0, 8).toLowerCase();
  const attempt = Math.max(0, Date.parse(mission.updatedAt || mission.createdAt)).toString(36);
  return `taso/${project.slug.replace(/[^a-z0-9-]/g, '-')}/${suffix}-${attempt}`.slice(0, 120);
}

function assertSafeChanges(mission: Mission, paths: string[], protectedPaths: string[] = []) {
  for (const path of paths) {
    const normalized = path.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('../')) throw new Error(`Unsafe generated path: ${path}`);
    if (/(^|\/)(\.env(?:\.|$)|id_rsa|id_ed25519|secrets?\.|credentials?\.)/i.test(normalized)) {
      throw new Error(`Taso refuses to write credential or secret path: ${path}`);
    }
    if (protectedPaths.some((protectedPath) => normalized === protectedPath || normalized.startsWith(`${protectedPath.replace(/\/$/, '')}/`))) {
      throw new Error(`Protected project path cannot be changed: ${path}`);
    }
    if (mission.riskLevel !== 'HIGH_IMPACT' && /(^|\/)(\.github\/workflows|migrations?|infra)(\/|$)|(^|\/)(docker-compose[^/]*\.ya?ml|Dockerfile)$/i.test(normalized)) {
      throw new Error(`Infrastructure path requires HIGH_IMPACT approval: ${path}`);
    }
  }
}

function isProductionDeploy(mission: Mission) {
  return mission.riskLevel === 'HIGH_IMPACT' && /\b(prod(?:uction)?|canlı|yayın|deploy)\b/i.test(mission.objective);
}

function boundedEnvMs(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function safeErrorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1200);
}

class RetryablePlanningError extends Error {
  constructor(readonly operation: string, cause: unknown) {
    super(`Planning ${operation} failed: ${safeErrorMessage(cause)}`);
    this.name = 'RetryablePlanningError';
  }
}

export type MissionExecutorOptions = {
  planningTimeoutMs?: number;
  retryBaseDelayMs?: number;
  watchdogGraceMs?: number;
};

export class MissionExecutor {
  private readonly active = new Set<string>();
  private readonly planningControllers = new Map<string, AbortController>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private watchdogTimer?: ReturnType<typeof setInterval>;
  private readonly planningTimeoutMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly watchdogGraceMs: number;

  constructor(
    private readonly tasks: TaskEngine,
    private readonly projects: ProjectRegistry,
    private readonly planner = MultiProviderPlanner.fromEnv(defaultProviders().map((provider) => provider.id)),
    private readonly github = GitHubTools.fromEnv(),
    private readonly coolify = CoolifyTools.fromEnv(),
    options: MissionExecutorOptions = {},
  ) {
    this.planningTimeoutMs = options.planningTimeoutMs
      ?? boundedEnvMs('TASO_PLANNING_TIMEOUT_MS', 180_000, 30_000, 600_000);
    this.retryBaseDelayMs = options.retryBaseDelayMs
      ?? boundedEnvMs('TASO_PLANNING_RETRY_BASE_MS', 2_000, 250, 30_000);
    this.watchdogGraceMs = options.watchdogGraceMs
      ?? boundedEnvMs('TASO_PLANNING_WATCHDOG_GRACE_MS', 15_000, 0, 120_000);
  }

  readiness() {
    return {
      readyForRead: Boolean(this.planner && this.github),
      readyForWrite: Boolean(this.planner && this.github),
      readyForDeploy: Boolean(this.coolify),
      ai: this.planner?.readiness() ?? { configured: false },
      github: this.github?.readiness() ?? { configured: false },
      coolify: this.coolify?.readiness() ?? { configured: false },
      activeMissionIds: [...this.active],
      planningTimeoutMs: this.planningTimeoutMs,
    };
  }

  executeSoon(id: string) {
    queueMicrotask(() => {
      void this.execute(id).catch((error) => this.handleExecutionFailure(id, error));
    });
  }

  startWatchdog(intervalMs = Math.max(5_000, Math.min(30_000, Math.trunc(this.planningTimeoutMs / 3)))) {
    if (this.watchdogTimer) return () => this.stopWatchdog();
    this.watchdogTimer = setInterval(() => this.sweepStuckPlanning(), Math.max(1_000, intervalMs));
    this.watchdogTimer.unref?.();
    return () => this.stopWatchdog();
  }

  stopWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = undefined;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const controller of this.planningControllers.values()) {
      if (!controller.signal.aborted) controller.abort(new Error('Taso executor is shutting down.'));
    }
  }

  sweepStuckPlanning(now = Date.now()) {
    const staleAfterMs = this.planningTimeoutMs + this.watchdogGraceMs;
    for (const mission of this.tasks.listMissions()) {
      if (mission.status !== 'planning') continue;
      const startedAt = Date.parse(mission.execution?.planningStartedAt ?? mission.updatedAt);
      if (!Number.isFinite(startedAt) || now - startedAt <= staleAfterMs) continue;
      const reason = new Error(`Planning watchdog detected no completion after ${Math.round(staleAfterMs / 1000)}s.`);
      const controller = this.planningControllers.get(mission.id);
      if (controller && !controller.signal.aborted) {
        controller.abort(reason);
      } else if (!this.active.has(mission.id)) {
        this.handleExecutionFailure(mission.id, new RetryablePlanningError('watchdog', reason));
      }
    }
  }

  async execute(id: string): Promise<Mission> {
    if (this.active.has(id)) return this.tasks.getMission(id) ?? Promise.reject(new Error('Mission not found.'));
    const mission = this.tasks.getMission(id);
    if (!mission) throw new Error('Mission not found.');
    if (mission.status !== 'queued') return mission;
    if (!mission.autonomous.enabled) {
      this.tasks.noteMission(id, 'Autonomous execution is disabled for this mission.');
      return mission;
    }
    if (mission.approvalRequired && !mission.approvedAt) throw new Error('High-impact mission is not approved.');

    this.active.add(id);
    try {
      const project = this.projects.get(mission.projectId);
      if (!project) throw new Error('Project not found.');
      if (isProductionDeploy(mission)) return await this.executeProductionDeploy(project, mission);
      return await this.executeRepositoryMission(project, mission);
    } finally {
      this.active.delete(id);
    }
  }

  private handleExecutionFailure(id: string, error: unknown) {
    const mission = this.tasks.getMission(id);
    if (!mission || ['cancelled', 'failed', 'completed', 'preview_ready'].includes(mission.status)) return;
    const reason = safeErrorMessage(error);

    try {
      if (error instanceof RetryablePlanningError) {
        const usedRetries = Math.max(0, mission.execution?.retryCount ?? 0);
        const delayMs = Math.min(30_000, this.retryBaseDelayMs * (2 ** usedRetries));
        const outcome = this.tasks.scheduleAutomaticRetry(id, reason, delayMs);
        if (outcome.scheduled) this.scheduleRetryExecution(id, delayMs);
        return;
      }
      this.tasks.transitionMission(id, 'failed', `Execution failed: ${reason}`, undefined, {
        blockedReason: reason,
        lastFailure: reason,
      });
    } catch {
      // Mission may have been cancelled or completed while the executor was unwinding.
    }
  }

  private scheduleRetryExecution(id: string, delayMs: number) {
    const existing = this.retryTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      this.executeSoon(id);
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  private async executeRepositoryMission(project: Project, mission: Mission): Promise<Mission> {
    if (!this.planner) throw new Error('AI planner is not configured.');
    if (!this.github) throw new Error('GitHub tool broker is not configured.');
    assertRepository(project.repository);

    this.tasks.transitionMission(mission.id, 'planning', 'Taso is inspecting the repository and selecting relevant files.');
    const deadline = Date.now() + this.planningTimeoutMs;
    const controller = new AbortController();
    this.planningControllers.set(mission.id, controller);

    const withinDeadline = async <T>(operation: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new RetryablePlanningError(operation, new Error(`Planning timeout after ${Math.round(this.planningTimeoutMs / 1000)}s.`));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work(controller.signal).catch((error) => {
            throw new RetryablePlanningError(operation, error);
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const timeout = new Error(`Planning timeout after ${Math.round(this.planningTimeoutMs / 1000)}s during ${operation}.`);
              if (!controller.signal.aborted) controller.abort(timeout);
              reject(new RetryablePlanningError(operation, timeout));
            }, remaining);
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    this.tasks.noteMission(mission.id, 'Planning deadline started.', {
      timeoutMs: this.planningTimeoutMs,
      retryCount: mission.execution?.retryCount ?? 0,
      maxRetries: mission.autonomous.maxRetries,
    });

    try {
      const paths = await withinDeadline('repository listing', () => this.github!.listFiles(project.repository, project.defaultBranch));
      if (!paths.length) throw new Error('Repository has no readable source files.');
      const selected = await withinDeadline('file selection', (signal) => this.planner!.chooseFiles(project, mission, paths, signal));
      const fallback = ['README.md', 'package.json', 'composer.json'].filter((path) => paths.includes(path));
      const selectedPaths = selected.length ? selected : fallback;
      const files = await withinDeadline('file reading', () => this.github!.readFiles(project.repository, project.defaultBranch, selectedPaths));

      if (mission.riskLevel === 'READ') {
        const summary = await withinDeadline('read-only analysis', (signal) => this.planner!.analyze(project, mission, files, signal));
        return this.tasks.transitionMission(mission.id, 'completed', 'Read-only analysis completed.', undefined, { summary, checkState: 'success' });
      }

      const plan = await withinDeadline('change planning', (signal) => this.planner!.planChanges(project, mission, files, signal));
      if (!plan.files.length) throw new Error('AI planner produced no file changes.');
      const manifest = this.projects.getManifest(project.id);
      assertSafeChanges(mission, plan.files.map((file) => file.path), manifest?.protectedPaths ?? []);

      const branch = safeBranch(project, mission);
      this.tasks.transitionMission(mission.id, 'running', 'Taso is creating a scoped branch and applying the planned changes.', { files: plan.files.map((file) => file.path) }, { summary: plan.summary, branch });
      const result = await this.github.createPullRequestWithChanges({
        repository: project.repository,
        base: project.defaultBranch,
        branch,
        changes: plan.files,
        commitMessage: plan.commitMessage,
        title: `Taso: ${mission.objective}`.slice(0, 120),
        body: [
          '## Taso mission',
          '',
          plan.summary,
          '',
          `Mission: \`${mission.id}\``,
          `Risk: \`${mission.riskLevel}\``,
          '',
          'This pull request was created by Taso. CI and preview gates must pass before merge.',
        ].join('\n'),
      });

      this.tasks.transitionMission(mission.id, 'testing', 'Pull request created. Taso is waiting for CI checks.', { pullRequest: result.url }, {
        branch: result.branch,
        commitSha: result.commitSha,
        pullRequestNumber: result.number,
        pullRequestUrl: result.url,
      });

      const checkState = await this.github.waitForChecks(project.repository, result.commitSha);
      if (checkState !== 'success') {
        const reason = checkState === 'failed' ? 'CI checks failed.' : checkState === 'missing' ? 'No CI checks were detected for the generated commit.' : 'CI checks did not complete before timeout.';
        return this.tasks.transitionMission(mission.id, 'failed', reason, { checkState }, { checkState, blockedReason: reason, lastFailure: reason });
      }

      if (mission.autonomous.previewRequired) {
        if (!this.coolify || !this.coolify.hasProject(project)) {
          const reason = 'CI passed, but a Coolify resource is not configured for this project, so preview could not be verified.';
          return this.tasks.transitionMission(mission.id, 'failed', reason, { checkState }, { checkState, blockedReason: reason, lastFailure: reason });
        }
        this.tasks.noteMission(mission.id, 'CI passed. Creating isolated Coolify preview.', { pullRequestNumber: result.number });
        const preview = await this.coolify.deploy(project, result.number);
        return this.tasks.transitionMission(mission.id, 'preview_ready', 'CI passed and Coolify preview deployment completed.', { deploymentUuid: preview.deploymentUuid }, {
          checkState,
          previewDeploymentUuid: preview.deploymentUuid,
          previewUrl: preview.url,
        });
      }

      return this.tasks.transitionMission(mission.id, 'completed', 'CI passed. Mission completed without a preview requirement.', undefined, { checkState });
    } finally {
      this.planningControllers.delete(mission.id);
      if (!controller.signal.aborted && this.tasks.getMission(mission.id)?.status !== 'planning') {
        controller.abort(new Error('Planning stage finished.'));
      }
    }
  }

  private async executeProductionDeploy(project: Project, mission: Mission): Promise<Mission> {
    if (!this.coolify || !this.coolify.hasProject(project)) throw new Error('Coolify production deployment is not configured for this project.');
    if (!mission.approvedAt) throw new Error('Production deployment requires explicit human approval.');
    this.tasks.transitionMission(mission.id, 'running', 'Approved production deployment is being sent to Coolify.');
    const deployment = await this.coolify.deploy(project);
    return this.tasks.transitionMission(mission.id, 'completed', 'Production deployment completed and was verified through Coolify.', { deploymentUuid: deployment.deploymentUuid }, {
      productionDeploymentUuid: deployment.deploymentUuid,
      productionUrl: deployment.url,
    });
  }
}
