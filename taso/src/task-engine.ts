import {
  clampRetries,
  createId,
  defaultAutonomousPolicy,
  nowIso,
  type AgentRole,
  type AgentRun,
  type AutonomousPolicy,
  type Mission,
  type MissionExecution,
  type MissionInput,
  type MissionStatus,
  type MissionStep,
} from './domain.js';
import { MissionEventStore } from './mission-events.js';
import { evaluateMissionPolicy } from './policy.js';
import type { ProjectRegistry } from './project-registry.js';
import type { ProviderRouter } from './provider-router.js';

export type AutomaticRetryResult = {
  mission: Mission;
  scheduled: boolean;
  retryCount: number;
  maxRetries: number;
};

const agentLabels: Record<AgentRole, string> = {
  scout: 'Repository Scout',
  architect: 'Solution Architect',
  builder: 'Implementation Agent',
  verifier: 'Verification Agent',
  release: 'Release Agent',
};

function boundedProgress(value: number) {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function resumableWorkPlan(workPlan: MissionStep[] | undefined, resetAttempts: boolean): MissionStep[] | undefined {
  if (!workPlan?.length) return workPlan;
  return workPlan.map((step) => {
    if (step.status === 'completed') return step;
    return {
      ...step,
      status: 'queued',
      progress: 0,
      ...(resetAttempts ? { attempts: 0, lastAttemptAt: undefined } : {}),
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    };
  });
}

function checkpointProgress(mission: Mission) {
  const plan = mission.execution?.workPlan ?? [];
  if (!plan.length) return 0;
  const completed = plan.filter((step) => step.status === 'completed').length;
  return Math.min(60, 34 + Math.trunc((completed / plan.length) * 26));
}

export class TaskEngine {
  private readonly missions = new Map<string, Mission>();

  constructor(
    private readonly projects: ProjectRegistry,
    private readonly router: ProviderRouter,
    private readonly events = new MissionEventStore(),
    initialMissions: Mission[] = [],
    private readonly onChange: () => void = () => {},
  ) {
    for (const mission of initialMissions) this.missions.set(mission.id, structuredClone(mission));
  }

  createMission(input: MissionInput): Mission {
    const project = this.projects.get(input.projectId);
    if (!project) throw new Error('Project not found.');
    if (!input.objective.trim()) throw new Error('Mission objective is required.');

    const autonomous: AutonomousPolicy = {
      ...defaultAutonomousPolicy,
      ...input.autonomous,
      maxRetries: clampRetries(input.autonomous?.maxRetries ?? defaultAutonomousPolicy.maxRetries),
    };
    const decision = evaluateMissionPolicy(project, input);
    if (!decision.allowed) throw new Error(decision.reason);

    const providerChain = this.router
      .route({ dataClass: input.dataClass, paidAi: autonomous.paidAi, preferFree: true })
      .map((provider) => provider.id);

    const timestamp = nowIso();
    const mission: Mission = {
      id: createId('mission'),
      projectId: input.projectId,
      objective: input.objective.trim(),
      riskLevel: input.riskLevel,
      dataClass: input.dataClass,
      status: decision.approvalRequired ? 'waiting_approval' : 'queued',
      providerChain,
      autonomous,
      approvalRequired: decision.approvalRequired,
      execution: { progressPercent: 0, currentAction: decision.approvalRequired ? 'Waiting for human approval.' : 'Queued for autonomous execution.', agentRuns: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.missions.set(mission.id, mission);
    this.events.append(mission.id, 'mission.created', 'Mission created.', {
      projectId: mission.projectId,
      riskLevel: mission.riskLevel,
      dataClass: mission.dataClass,
      providerChain: mission.providerChain,
      maxRetries: mission.autonomous.maxRetries,
    });
    if (mission.approvalRequired) this.events.append(mission.id, 'mission.approval_required', decision.reason);
    this.onChange();
    return mission;
  }

  getMission(id: string): Mission | undefined { return this.missions.get(id); }

  listMissions(): Mission[] {
    return [...this.missions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listEvents(id: string) {
    if (!this.missions.has(id)) throw new Error('Mission not found.');
    return this.events.list(id);
  }

  allEvents() { return this.events.all(); }

  approveMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    if (!mission.approvalRequired) return mission;
    if (mission.status !== 'waiting_approval') throw new Error(`Mission cannot be approved from status ${mission.status}.`);
    mission.approvedAt = nowIso();
    mission.status = 'queued';
    mission.updatedAt = mission.approvedAt;
    mission.execution = { ...(mission.execution ?? {}), currentAction: 'Approval received. Queued for autonomous execution.', resumeAfterRestart: false };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.approved', 'Mission approved by user.');
    this.onChange();
    return mission;
  }

  cancelMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    mission.status = 'cancelled';
    mission.updatedAt = nowIso();
    const runs = (mission.execution?.agentRuns ?? []).map((run) => run.status === 'running' ? { ...run, status: 'cancelled' as const, updatedAt: mission.updatedAt, completedAt: mission.updatedAt } : run);
    mission.execution = { ...(mission.execution ?? {}), nextRetryAt: undefined, currentAction: 'Mission cancelled.', activeAgentRole: undefined, agentRuns: runs, resumeAfterRestart: false };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.cancelled', 'Mission cancelled.');
    this.onChange();
    return mission;
  }

  retryMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    if (mission.status !== 'failed') throw new Error(`Mission cannot be retried from status ${mission.status}.`);

    const project = this.projects.get(mission.projectId);
    const requiresFreshApproval = project?.slug === 'taso-self-improvement' && mission.approvalRequired;
    if (requiresFreshApproval) mission.approvedAt = undefined;

    const preservedCheckpoint = mission.execution?.workspaceCheckpoint;
    const preservedPlan = resumableWorkPlan(mission.execution?.workPlan, true);
    const hasCheckpoint = Boolean(preservedCheckpoint?.files.length || preservedCheckpoint?.completedStepIds.length);
    mission.status = mission.approvalRequired && !mission.approvedAt ? 'waiting_approval' : 'queued';
    mission.updatedAt = nowIso();
    mission.execution = {
      ...(mission.execution ?? {}),
      blockedReason: undefined,
      planningStartedAt: undefined,
      retryCount: 0,
      lastFailure: undefined,
      nextRetryAt: undefined,
      progressPercent: hasCheckpoint ? checkpointProgress(mission) : 0,
      currentAction: requiresFreshApproval
        ? 'Waiting for fresh approval.'
        : hasCheckpoint
          ? 'Durable checkpoint retained. Queued to resume incomplete work.'
          : 'Queued for retry.',
      activeAgentRole: undefined,
      workPlan: preservedPlan,
      workspaceCheckpoint: preservedCheckpoint,
      resumeAfterRestart: false,
    };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.status_changed', requiresFreshApproval
      ? 'Self-improvement retry returned to explicit approval.'
      : hasCheckpoint
        ? 'Mission queued for explicit retry from durable checkpoint.'
        : 'Mission queued for explicit retry.', {
      status: mission.status,
      retryCount: 0,
      resumedFromCheckpoint: hasCheckpoint,
      completedStepIds: preservedCheckpoint?.completedStepIds ?? [],
    });
    if (requiresFreshApproval) {
      this.events.append(id, 'mission.approval_required', 'Taso self-improvement retries require fresh operator approval.');
    }
    this.onChange();
    return mission;
  }

  scheduleAutomaticRetry(id: string, reason: string, delayMs: number): AutomaticRetryResult {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    if (mission.status === 'cancelled') throw new Error('Cancelled mission cannot retry.');
    if (['failed', 'completed', 'preview_ready'].includes(mission.status)) throw new Error(`Terminal mission cannot retry from ${mission.status}.`);

    const maxRetries = clampRetries(mission.autonomous.maxRetries);
    const retryCount = Math.max(0, mission.execution?.retryCount ?? 0);
    const safeReason = reason.trim() || 'Planning failed for an unknown reason.';

    if (retryCount >= maxRetries) {
      mission.status = 'failed';
      mission.updatedAt = nowIso();
      mission.execution = {
        ...(mission.execution ?? {}),
        retryCount,
        lastFailure: safeReason,
        blockedReason: safeReason,
        nextRetryAt: undefined,
        currentAction: 'Automatic retry budget exhausted.',
        activeAgentRole: undefined,
        resumeAfterRestart: false,
      };
      this.missions.set(id, mission);
      this.events.append(id, 'mission.status_changed', `Planning failed and the automatic retry budget is exhausted: ${safeReason}`, {
        status: 'failed',
        retryCount,
        maxRetries,
        blockedReason: safeReason,
      });
      this.onChange();
      return { mission, scheduled: false, retryCount, maxRetries };
    }

    const nextRetryCount = retryCount + 1;
    const boundedDelayMs = Math.max(0, Math.min(60_000, Math.trunc(delayMs)));
    const nextRetryAt = new Date(Date.now() + boundedDelayMs).toISOString();
    const preservedPlan = resumableWorkPlan(mission.execution?.workPlan, false);
    mission.status = 'queued';
    mission.updatedAt = nowIso();
    mission.execution = {
      ...(mission.execution ?? {}),
      planningStartedAt: undefined,
      retryCount: nextRetryCount,
      lastFailure: safeReason,
      blockedReason: undefined,
      nextRetryAt,
      currentAction: `Automatic retry ${nextRetryCount}/${maxRetries} scheduled${mission.execution?.workspaceCheckpoint ? ' from checkpoint' : ''}.`,
      activeAgentRole: undefined,
      workPlan: preservedPlan,
      resumeAfterRestart: false,
    };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.retry_scheduled', `Planning failed: ${safeReason} Automatic retry ${nextRetryCount}/${maxRetries} scheduled.`, {
      status: 'queued',
      retryCount: nextRetryCount,
      maxRetries,
      delayMs: boundedDelayMs,
      nextRetryAt,
      reason: safeReason,
      resumedFromCheckpoint: Boolean(mission.execution?.workspaceCheckpoint),
    });
    this.onChange();
    return { mission, scheduled: true, retryCount: nextRetryCount, maxRetries };
  }

  recoverInterruptedMissions(): Mission[] {
    const recovered: Mission[] = [];
    for (const mission of this.missions.values()) {
      if (!['planning', 'running', 'testing'].includes(mission.status)) continue;
      const reason = 'Taso Core restarted while this mission was executing.';
      const timestamp = nowIso();
      const runs = (mission.execution?.agentRuns ?? []).map((run) => run.status === 'running'
        ? { ...run, status: 'failed' as const, updatedAt: timestamp, completedAt: timestamp, error: reason }
        : run);
      const workPlan = (mission.execution?.workPlan ?? []).map((step) => {
        if (step.status === 'completed') return step;
        if (step.status === 'running') return { ...step, status: 'queued' as const, progress: 0, startedAt: undefined, completedAt: undefined, error: undefined };
        return step;
      });
      const safeAutoResume = mission.riskLevel !== 'HIGH_IMPACT' && mission.autonomous.enabled;
      mission.status = safeAutoResume ? 'queued' : 'failed';
      mission.updatedAt = timestamp;
      mission.execution = {
        ...(mission.execution ?? {}),
        blockedReason: safeAutoResume ? undefined : `${reason} High-impact work requires operator review before retry.`,
        lastFailure: reason,
        nextRetryAt: undefined,
        currentAction: safeAutoResume
          ? 'Core restart detected. Durable execution state retained; resuming incomplete work.'
          : 'Core restart interrupted high-impact execution; operator review required.',
        activeAgentRole: undefined,
        agentRuns: runs,
        workPlan,
        resumeAfterRestart: safeAutoResume,
      };
      this.events.append(mission.id, 'mission.status_changed', safeAutoResume
        ? 'Interrupted mission recovered from durable state and queued for automatic resume.'
        : 'Interrupted high-impact mission marked failed for explicit review.', {
        status: mission.status,
        blockedReason: mission.execution.blockedReason,
        resumeAfterRestart: safeAutoResume,
        completedStepIds: mission.execution.workspaceCheckpoint?.completedStepIds ?? [],
        pullRequestNumber: mission.execution.pullRequestNumber,
      });
      recovered.push(mission);
    }
    if (recovered.length) this.onChange();
    return recovered;
  }

  transitionMission(
    id: string,
    status: MissionStatus,
    message: string,
    metadata?: Record<string, unknown>,
    execution?: Partial<MissionExecution>,
  ): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    if (mission.status === 'cancelled') throw new Error('Cancelled mission cannot transition.');
    if (['failed', 'completed', 'preview_ready'].includes(mission.status)) throw new Error(`Terminal mission cannot transition from ${mission.status}.`);

    const timestamp = nowIso();
    mission.status = status;
    mission.updatedAt = timestamp;
    const lifecycleExecution: Partial<MissionExecution> = status === 'planning'
      ? { planningStartedAt: timestamp, nextRetryAt: undefined, blockedReason: undefined, resumeAfterRestart: false }
      : status === 'failed' || status === 'completed' || status === 'preview_ready'
        ? { nextRetryAt: undefined, activeAgentRole: undefined, currentAction: message, progressPercent: status === 'failed' ? mission.execution?.progressPercent : 100, resumeAfterRestart: false }
        : { currentAction: message };
    if (execution || Object.keys(lifecycleExecution).length) {
      mission.execution = { ...(mission.execution ?? {}), ...lifecycleExecution, ...(execution ?? {}) };
    }
    this.missions.set(id, mission);
    this.events.append(id, 'mission.status_changed', message, {
      status,
      ...(metadata ?? {}),
      ...(execution?.blockedReason ? { blockedReason: execution.blockedReason } : {}),
      ...(mission.execution?.retryCount !== undefined ? { retryCount: mission.execution.retryCount } : {}),
      ...(mission.execution?.progressPercent !== undefined ? { progressPercent: mission.execution.progressPercent } : {}),
    });
    this.onChange();
    return mission;
  }

  noteMission(id: string, message: string, metadata?: Record<string, unknown>): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    this.events.append(id, 'mission.note', message, metadata);
    this.onChange();
    return mission;
  }

  startAgent(id: string, role: AgentRole, action: string, progress: number): AgentRun {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    const timestamp = nowIso();
    const run: AgentRun = {
      id: createId('agent'),
      missionId: id,
      role,
      label: agentLabels[role],
      status: 'running',
      action,
      progress: boundedProgress(progress),
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    mission.updatedAt = timestamp;
    mission.execution = {
      ...(mission.execution ?? {}),
      progressPercent: run.progress,
      currentAction: action,
      activeAgentRole: role,
      agentRuns: [...(mission.execution?.agentRuns ?? []), run],
    };
    this.missions.set(id, mission);
    this.events.append(id, 'agent.started', `${run.label}: ${action}`, { agentRunId: run.id, role, progressPercent: run.progress });
    this.onChange();
    return run;
  }

  updateAgent(id: string, runId: string, action: string, progress: number, detail?: string): AgentRun {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    const runs = [...(mission.execution?.agentRuns ?? [])];
    const index = runs.findIndex((run) => run.id === runId);
    const current = index >= 0 ? runs[index] : undefined;
    if (!current) throw new Error('Agent run not found.');
    const timestamp = nowIso();
    const run: AgentRun = { ...current, action, progress: boundedProgress(progress), detail, updatedAt: timestamp };
    runs[index] = run;
    mission.updatedAt = timestamp;
    mission.execution = { ...(mission.execution ?? {}), progressPercent: run.progress, currentAction: action, activeAgentRole: run.role, agentRuns: runs };
    this.missions.set(id, mission);
    this.events.append(id, 'agent.progress', `${run.label}: ${action}`, { agentRunId: run.id, role: run.role, progressPercent: run.progress, ...(detail ? { detail } : {}) });
    this.onChange();
    return run;
  }

  completeAgent(id: string, runId: string, action: string, progress: number, detail?: string): AgentRun {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    const runs = [...(mission.execution?.agentRuns ?? [])];
    const index = runs.findIndex((run) => run.id === runId);
    const current = index >= 0 ? runs[index] : undefined;
    if (!current) throw new Error('Agent run not found.');
    const timestamp = nowIso();
    const run: AgentRun = { ...current, status: 'completed', action, progress: boundedProgress(progress), detail, updatedAt: timestamp, completedAt: timestamp };
    runs[index] = run;
    mission.updatedAt = timestamp;
    mission.execution = { ...(mission.execution ?? {}), progressPercent: run.progress, currentAction: action, activeAgentRole: undefined, agentRuns: runs };
    this.missions.set(id, mission);
    this.events.append(id, 'agent.completed', `${run.label}: ${action}`, { agentRunId: run.id, role: run.role, progressPercent: run.progress, ...(detail ? { detail } : {}) });
    this.onChange();
    return run;
  }

  failAgent(id: string, runId: string, error: string): AgentRun {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    const runs = [...(mission.execution?.agentRuns ?? [])];
    const index = runs.findIndex((run) => run.id === runId);
    const current = index >= 0 ? runs[index] : undefined;
    if (!current) throw new Error('Agent run not found.');
    const timestamp = nowIso();
    const run: AgentRun = { ...current, status: 'failed', updatedAt: timestamp, completedAt: timestamp, error };
    runs[index] = run;
    mission.updatedAt = timestamp;
    mission.execution = { ...(mission.execution ?? {}), currentAction: `${run.label} failed.`, activeAgentRole: undefined, agentRuns: runs };
    this.missions.set(id, mission);
    this.events.append(id, 'agent.failed', `${run.label} failed: ${error}`, { agentRunId: run.id, role: run.role, progressPercent: run.progress });
    this.onChange();
    return run;
  }
}
