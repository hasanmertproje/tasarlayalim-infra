import {
  createId,
  nowIso,
  type AgentHandoff,
  type AgentRole,
  type Mission,
  type MissionArtifact,
  type MissionExecution,
  type MissionStep,
  type Project,
  type SpecialistRole,
} from './domain.js';
import type { ChangePlan, RepositoryFile } from './agent-planner.js';
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

function boundedEnvInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function safeErrorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1200);
}

function specialistLabel(role: SpecialistRole) {
  const labels: Record<SpecialistRole, string> = {
    frontend: 'Frontend Engineer',
    backend: 'Backend Engineer',
    database: 'Database Engineer',
    security: 'Security Engineer',
    qa: 'QA Engineer',
    devops: 'DevOps Engineer',
    generalist: 'Generalist Engineer',
  };
  return labels[role];
}

function dependsTransitively(stepId: string, ancestorId: string, steps: MissionStep[], seen = new Set<string>()): boolean {
  if (stepId === ancestorId) return true;
  if (seen.has(stepId)) return false;
  seen.add(stepId);
  const step = steps.find((item) => item.id === stepId);
  if (!step) return false;
  return step.dependsOn.some((dependency) => dependency === ancestorId || dependsTransitively(dependency, ancestorId, steps, seen));
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
  stepMaxAttempts?: number;
};

export class MissionExecutor {
  private readonly active = new Set<string>();
  private readonly planningControllers = new Map<string, AbortController>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private watchdogTimer?: ReturnType<typeof setInterval>;
  private readonly planningTimeoutMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly watchdogGraceMs: number;
  private readonly stepMaxAttempts: number;

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
    this.stepMaxAttempts = options.stepMaxAttempts
      ?? boundedEnvInt('TASO_STEP_MAX_ATTEMPTS', 2, 1, 3);
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
      stepMaxAttempts: this.stepMaxAttempts,
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

  private patchExecution(mission: Mission, patch: Partial<MissionExecution>, note?: string, metadata?: Record<string, unknown>) {
    mission.updatedAt = nowIso();
    mission.execution = { ...(mission.execution ?? {}), ...patch };
    if (note) this.tasks.noteMission(mission.id, note, metadata);
    return mission;
  }

  private updateStep(mission: Mission, stepId: string, patch: Partial<MissionStep>, note?: string) {
    const workPlan = (mission.execution?.workPlan ?? []).map((step) => step.id === stepId ? { ...step, ...patch } : step);
    this.patchExecution(mission, { workPlan }, note, { stepId, ...patch });
    return workPlan.find((step) => step.id === stepId);
  }

  private addArtifact(
    mission: Mission,
    input: Omit<MissionArtifact, 'id' | 'missionId' | 'createdAt'>,
  ): MissionArtifact {
    const artifact: MissionArtifact = {
      id: createId('artifact'),
      missionId: mission.id,
      createdAt: nowIso(),
      ...input,
    };
    this.patchExecution(
      mission,
      { artifacts: [...(mission.execution?.artifacts ?? []), artifact] },
      `Artifact ready: ${artifact.label}`,
      { artifactId: artifact.id, type: artifact.type, stepId: artifact.stepId, path: artifact.path, url: artifact.url },
    );
    return artifact;
  }

  private addHandoff(mission: Mission, fromStepId: string, toStepId: string, summary: string) {
    const artifactIds = (mission.execution?.artifacts ?? []).filter((artifact) => artifact.stepId === fromStepId).map((artifact) => artifact.id);
    const handoff: AgentHandoff = {
      id: createId('handoff'),
      missionId: mission.id,
      fromStepId,
      toStepId,
      summary,
      artifactIds,
      createdAt: nowIso(),
    };
    this.patchExecution(
      mission,
      { handoffs: [...(mission.execution?.handoffs ?? []), handoff] },
      `Agent handoff: ${fromStepId} → ${toStepId}`,
      { handoffId: handoff.id, fromStepId, toStepId, artifactIds },
    );
    return handoff;
  }

  private async runAgent<T>(
    mission: Mission,
    role: AgentRole,
    action: string,
    startProgress: number,
    completedProgress: number,
    work: (runId: string) => Promise<T>,
    completedAction?: string,
    meta?: { label?: string; specialist?: SpecialistRole | 'repository-publisher'; stepId?: string },
  ): Promise<T> {
    const run = this.tasks.startAgent(mission.id, role, action, startProgress);
    if (meta?.label) run.label = meta.label;
    if (meta?.specialist) run.specialist = meta.specialist;
    if (meta?.stepId) run.stepId = meta.stepId;
    if (meta) this.tasks.noteMission(mission.id, `${run.label} assigned.`, { agentRunId: run.id, specialist: run.specialist, stepId: run.stepId });
    try {
      const result = await work(run.id);
      this.tasks.completeAgent(mission.id, run.id, completedAction ?? `${action} completed.`, completedProgress);
      return result;
    } catch (error) {
      this.tasks.failAgent(mission.id, run.id, safeErrorMessage(error));
      throw error;
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

  private mergeWorkerPlans(mission: Mission, plans: Array<{ step: MissionStep; plan: ChangePlan }>): ChangePlan {
    const files = new Map<string, string>();
    const producerByPath = new Map<string, string>();
    const summaries: string[] = [];
    const allSteps = mission.execution?.workPlan ?? plans.map(({ step }) => step);
    for (const { step, plan } of plans) {
      summaries.push(`${specialistLabel(step.specialist)} — ${plan.summary}`);
      for (const file of plan.files) {
        const existing = files.get(file.path);
        const producer = producerByPath.get(file.path);
        if (existing !== undefined && existing !== file.content && producer && !dependsTransitively(step.id, producer, allSteps)) {
          throw new Error(`Independent specialist worker conflict on ${file.path}. Taso stopped instead of silently overwriting another agent's output.`);
        }
        files.set(file.path, file.content);
        producerByPath.set(file.path, step.id);
      }
    }
    return {
      summary: summaries.join('\n'),
      commitMessage: `Taso: ${mission.objective}`.slice(0, 120),
      files: [...files.entries()].map(([path, content]) => ({ path, content })),
    };
  }

  private effectiveTargetPaths(step: MissionStep, steps: MissionStep[]): string[] {
    if (step.targetPaths.length) return step.targetPaths;
    if (!step.dependsOn.length) return [];
    return [...new Set(step.dependsOn.flatMap((dependency) => steps.find((item) => item.id === dependency)?.targetPaths ?? []))];
  }

  private async executeWorkGraph(
    project: Project,
    mission: Mission,
    files: RepositoryFile[],
    withinDeadline: <T>(operation: string, work: (signal: AbortSignal) => Promise<T>) => Promise<T>,
  ): Promise<ChangePlan> {
    const steps = mission.execution?.workPlan ?? [];
    if (!steps.length) throw new Error('Mission work graph is empty.');
    const pending = new Set(steps.map((step) => step.id));
    const completed = new Set<string>();
    const plans: Array<{ step: MissionStep; plan: ChangePlan }> = [];
    const workingFiles = new Map(files.map((file) => [file.path, file.content]));
    const total = steps.length;

    while (pending.size) {
      const currentPlan = mission.execution?.workPlan ?? [];
      const ready = currentPlan.filter((step) => pending.has(step.id) && step.dependsOn.every((dependency) => completed.has(dependency)));
      if (!ready.length) throw new Error('Mission work graph contains an unresolved dependency cycle.');

      const batch = await Promise.all(ready.map(async (step) => {
        for (const dependency of step.dependsOn) {
          const source = (mission.execution?.workPlan ?? []).find((item) => item.id === dependency);
          this.addHandoff(mission, dependency, step.id, source?.outputSummary ?? `Artifacts from ${dependency} are available to ${step.id}.`);
        }

        const effectivePaths = this.effectiveTargetPaths(step, currentPlan);
        if (effectivePaths.length && effectivePaths.some((path) => !step.targetPaths.includes(path))) {
          this.updateStep(mission, step.id, { targetPaths: effectivePaths }, `Inherited ${effectivePaths.length} dependency path(s) for ${step.title}.`);
        }
        const effectiveStep: MissionStep = { ...step, targetPaths: effectivePaths };
        const ordinal = Math.max(0, steps.findIndex((item) => item.id === step.id));
        const startProgress = 34 + Math.trunc((ordinal / Math.max(1, total)) * 24);
        const endProgress = Math.min(60, startProgress + Math.max(4, Math.trunc(24 / Math.max(1, total))));
        const contextFiles = effectivePaths.length
          ? effectivePaths.flatMap((path) => workingFiles.has(path) ? [{ path, content: workingFiles.get(path)! }] : [])
          : [...workingFiles.entries()].map(([path, content]) => ({ path, content }));
        const handoffContext = (mission.execution?.handoffs ?? [])
          .filter((handoff) => handoff.toStepId === step.id)
          .map((handoff) => handoff.summary);

        let lastError: unknown;
        for (let attempt = 1; attempt <= this.stepMaxAttempts; attempt += 1) {
          const startedAt = attempt === 1 ? nowIso() : (mission.execution?.workPlan?.find((item) => item.id === step.id)?.startedAt ?? nowIso());
          const lastAttemptAt = nowIso();
          this.updateStep(
            mission,
            step.id,
            { status: 'running', startedAt, lastAttemptAt, attempts: attempt, maxAttempts: this.stepMaxAttempts, progress: 10, error: undefined },
            `${specialistLabel(step.specialist)} started ${step.title}${attempt > 1 ? ` retry ${attempt}/${this.stepMaxAttempts}` : ''}.`,
          );
          try {
            const plan = await this.runAgent(
              mission,
              'builder',
              `${step.title}: ${step.objective}`,
              startProgress,
              endProgress,
              (runId) => withinDeadline(`specialist ${step.id} attempt ${attempt}`, async (signal) => {
                const nextPlan = await this.planner!.planStepChanges(project, mission, contextFiles.length ? contextFiles : files, effectiveStep, handoffContext, signal);
                this.tasks.updateAgent(mission.id, runId, `${step.title}: specialist output produced ${nextPlan.files.length} file change(s).`, endProgress - 1, nextPlan.summary);
                return nextPlan;
              }),
              `${step.title} completed.`,
              { label: `${specialistLabel(step.specialist)} Worker`, specialist: step.specialist, stepId: step.id },
            );
            const manifest = this.projects.getManifest(project.id);
            assertSafeChanges(mission, plan.files.map((file) => file.path), manifest?.protectedPaths ?? []);
            for (const file of plan.files) {
              this.addArtifact(mission, { stepId: step.id, type: 'file-change', label: file.path, path: file.path, summary: plan.summary });
            }
            this.updateStep(
              mission,
              step.id,
              { status: 'completed', completedAt: nowIso(), progress: 100, attempts: attempt, maxAttempts: this.stepMaxAttempts, outputSummary: plan.summary, error: undefined },
              `${specialistLabel(step.specialist)} completed ${step.title}.`,
            );
            return { step: { ...effectiveStep, attempts: attempt, maxAttempts: this.stepMaxAttempts }, plan };
          } catch (error) {
            lastError = error;
            const reason = safeErrorMessage(error);
            if (attempt < this.stepMaxAttempts) {
              this.updateStep(
                mission,
                step.id,
                { status: 'queued', attempts: attempt, maxAttempts: this.stepMaxAttempts, error: reason, progress: 10 },
                `${specialistLabel(step.specialist)} will retry ${step.title} after attempt ${attempt}/${this.stepMaxAttempts}.`,
              );
              continue;
            }
            this.updateStep(
              mission,
              step.id,
              { status: 'failed', completedAt: nowIso(), attempts: attempt, maxAttempts: this.stepMaxAttempts, error: reason },
              `${specialistLabel(step.specialist)} failed ${step.title} after ${attempt} attempt(s).`,
            );
          }
        }
        throw lastError ?? new Error(`${step.title} failed without an error detail.`);
      }));

      for (const result of batch) {
        plans.push(result);
        for (const file of result.plan.files) workingFiles.set(file.path, file.content);
        pending.delete(result.step.id);
        completed.add(result.step.id);
      }
    }

    return this.mergeWorkerPlans(mission, plans);
  }

  private async executeRepositoryMission(project: Project, mission: Mission): Promise<Mission> {
    if (!this.planner) throw new Error('AI planner is not configured.');
    if (!this.github) throw new Error('GitHub tool broker is not configured.');
    assertRepository(project.repository);

    this.tasks.transitionMission(mission.id, 'planning', 'Taso agent team is inspecting the repository.', undefined, {
      progressPercent: 2,
      currentAction: 'Starting repository reconnaissance.',
      workPlan: [],
      artifacts: [],
      handoffs: [],
    });
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

    this.tasks.noteMission(mission.id, 'Autonomous execution deadline started.', {
      timeoutMs: this.planningTimeoutMs,
      retryCount: mission.execution?.retryCount ?? 0,
      maxRetries: mission.autonomous.maxRetries,
      stepMaxAttempts: this.stepMaxAttempts,
    });

    try {
      const reconnaissance = await this.runAgent(mission, 'scout', 'Scanning repository and locating relevant source files.', 5, 22, async (runId) => {
        const paths = await withinDeadline('repository listing', () => this.github!.listFiles(project.repository, project.defaultBranch));
        if (!paths.length) throw new Error('Repository has no readable source files.');
        this.tasks.updateAgent(mission.id, runId, `Repository indexed: ${paths.length} paths. Selecting mission-relevant files.`, 10);
        const selected = await withinDeadline('file selection', (signal) => this.planner!.chooseFiles(project, mission, paths, signal));
        const fallback = ['README.md', 'package.json', 'composer.json'].filter((path) => paths.includes(path));
        const selectedPaths = selected.length ? selected : fallback;
        this.tasks.updateAgent(mission.id, runId, `Reading ${selectedPaths.length} selected files.`, 16, selectedPaths.slice(0, 12).join(', '));
        const selectedFiles = await withinDeadline('file reading', () => this.github!.readFiles(project.repository, project.defaultBranch, selectedPaths));
        return { files: selectedFiles, selectedPaths };
      }, 'Repository context collected.');

      this.addArtifact(mission, {
        type: 'context',
        label: 'Repository context',
        summary: `${reconnaissance.selectedPaths.length} mission-relevant files loaded: ${reconnaissance.selectedPaths.join(', ')}`,
      });

      if (mission.riskLevel === 'READ') {
        const readStep: MissionStep = {
          id: 'analysis-1',
          title: 'Grounded repository analysis',
          objective: mission.objective,
          specialist: 'generalist',
          status: 'running',
          dependsOn: [],
          targetPaths: reconnaissance.selectedPaths,
          progress: 10,
          attempts: 1,
          maxAttempts: 1,
          lastAttemptAt: nowIso(),
          startedAt: nowIso(),
        };
        this.patchExecution(mission, { orchestrationSummary: 'Read-only mission routed to one grounded analysis worker.', workPlan: [readStep] }, 'Read-only work graph created.');
        const summary = await this.runAgent(
          mission,
          'architect',
          'Analyzing repository context and producing a grounded answer.',
          30,
          100,
          () => withinDeadline('read-only analysis', (signal) => this.planner!.analyze(project, mission, reconnaissance.files, signal)),
          'Read-only analysis completed.',
          { label: 'Repository Analyst', specialist: 'generalist', stepId: readStep.id },
        );
        this.updateStep(mission, readStep.id, { status: 'completed', progress: 100, completedAt: nowIso(), outputSummary: summary });
        this.addArtifact(mission, { stepId: readStep.id, type: 'analysis', label: 'Grounded analysis', summary });
        return this.tasks.transitionMission(mission.id, 'completed', 'Read-only mission completed.', undefined, { summary, checkState: 'success', progressPercent: 100 });
      }

      const orchestration = await this.runAgent(
        mission,
        'architect',
        'Decomposing the mission into specialist work items and dependencies.',
        24,
        32,
        (runId) => withinDeadline('mission decomposition', async (signal) => {
          const plan = await this.planner!.decomposeMission(project, mission, reconnaissance.files, signal);
          this.tasks.updateAgent(mission.id, runId, `Work graph ready: ${plan.steps.length} specialist step(s).`, 31, plan.summary);
          return plan;
        }),
        'Mission work graph created.',
      );
      const normalizedSteps = orchestration.steps.map((step) => ({ ...step, attempts: 0, maxAttempts: this.stepMaxAttempts }));
      this.patchExecution(
        mission,
        { orchestrationSummary: orchestration.summary, workPlan: normalizedSteps, artifacts: mission.execution?.artifacts ?? [], handoffs: [] },
        `Mission decomposed into ${normalizedSteps.length} specialist work item(s).`,
        { steps: normalizedSteps.map((step) => ({ id: step.id, specialist: step.specialist, dependsOn: step.dependsOn, targetPaths: step.targetPaths, maxAttempts: step.maxAttempts })) },
      );

      this.tasks.transitionMission(mission.id, 'running', 'Specialist workers are executing the mission work graph.', undefined, { progressPercent: 34 });
      const plan = await this.executeWorkGraph(project, mission, reconnaissance.files, withinDeadline);
      if (!plan.files.length) throw new Error('Specialist workers completed without producing any repository changes.');
      const manifest = this.projects.getManifest(project.id);
      assertSafeChanges(mission, plan.files.map((file) => file.path), manifest?.protectedPaths ?? []);

      const branch = safeBranch(project, mission);
      this.patchExecution(mission, { summary: plan.summary, branch, progressPercent: 61, currentAction: 'Repository Publisher is preparing the unified change set.' }, 'Specialist outputs merged into one dependency-aware change set.');
      const result = await this.runAgent(
        mission,
        'builder',
        `Publishing ${plan.files.length} dependency-aware file changes and opening a pull request.`,
        62,
        70,
        () => this.github!.createPullRequestWithChanges({
          repository: project.repository,
          base: project.defaultBranch,
          branch,
          changes: plan.files,
          commitMessage: plan.commitMessage,
          title: `Taso: ${mission.objective}`.slice(0, 120),
          body: [
            '## Taso mission',
            '',
            orchestration.summary,
            '',
            plan.summary,
            '',
            `Mission: \`${mission.id}\``,
            `Risk: \`${mission.riskLevel}\``,
            `Specialist workers: \`${orchestration.steps.map((step) => step.specialist).join(', ')}\``,
            '',
            'Generated by Taso Mission Orchestrator V3 with incremental handoff context and step-scoped recovery. CI and preview gates must pass before merge.',
          ].join('\n'),
        }),
        'Unified changes committed and pull request opened.',
        { label: 'Repository Publisher', specialist: 'repository-publisher' },
      );
      this.addArtifact(mission, { type: 'pull-request', label: `PR #${result.number}`, url: result.url, summary: plan.summary });

      this.tasks.transitionMission(mission.id, 'testing', 'Verification Agent is checking the generated change.', { pullRequest: result.url }, {
        branch: result.branch,
        commitSha: result.commitSha,
        pullRequestNumber: result.number,
        pullRequestUrl: result.url,
        progressPercent: 72,
      });

      const checkState = await this.runAgent(
        mission,
        'verifier',
        'Waiting for repository checks and verifying the generated commit.',
        74,
        86,
        () => this.github!.waitForChecks(project.repository, result.commitSha),
        'Repository checks finished.',
      );
      this.addArtifact(mission, { type: 'ci', label: `CI ${checkState}`, url: result.url, summary: `Checks for ${result.commitSha.slice(0, 8)} finished with state ${checkState}.` });
      if (checkState !== 'success') {
        const reason = checkState === 'failed' ? 'CI checks failed.' : checkState === 'missing' ? 'No CI checks were detected for the generated commit.' : 'CI checks did not complete before timeout.';
        return this.tasks.transitionMission(mission.id, 'failed', reason, { checkState }, { checkState, blockedReason: reason, lastFailure: reason });
      }

      if (mission.autonomous.previewRequired) {
        if (!this.coolify || !this.coolify.hasProject(project)) {
          const reason = 'CI passed, but a Coolify resource is not configured for this project, so preview could not be verified.';
          return this.tasks.transitionMission(mission.id, 'failed', reason, { checkState }, { checkState, blockedReason: reason, lastFailure: reason });
        }
        const preview = await this.runAgent(
          mission,
          'release',
          'Creating and verifying the isolated preview deployment.',
          88,
          100,
          () => this.coolify!.deploy(project, result.number),
          'Preview deployment completed and verified.',
        );
        this.addArtifact(mission, { type: 'preview', label: 'Verified preview', url: preview.url, summary: `Coolify deployment ${preview.deploymentUuid}` });
        return this.tasks.transitionMission(mission.id, 'preview_ready', 'CI passed and Coolify preview deployment completed.', { deploymentUuid: preview.deploymentUuid }, {
          checkState,
          previewDeploymentUuid: preview.deploymentUuid,
          previewUrl: preview.url,
          progressPercent: 100,
        });
      }

      return this.tasks.transitionMission(mission.id, 'completed', 'CI passed. Mission completed without a preview requirement.', undefined, { checkState, progressPercent: 100 });
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
    this.tasks.transitionMission(mission.id, 'running', 'Release Agent is starting the approved production deployment.', undefined, { progressPercent: 70 });
    const deployment = await this.runAgent(mission, 'release', 'Sending the approved production release to Coolify and waiting for verification.', 72, 100, () =>
      this.coolify!.deploy(project),
      'Production deployment completed and verified.');
    this.addArtifact(mission, { type: 'deployment', label: 'Production deployment', url: deployment.url, summary: `Coolify deployment ${deployment.deploymentUuid}` });
    return this.tasks.transitionMission(mission.id, 'completed', 'Production deployment completed and was verified through Coolify.', { deploymentUuid: deployment.deploymentUuid }, {
      productionDeploymentUuid: deployment.deploymentUuid,
      productionUrl: deployment.url,
      progressPercent: 100,
    });
  }
}
