import {
  clampRetries,
  createId,
  defaultAutonomousPolicy,
  nowIso,
  type AutonomousPolicy,
  type Mission,
  type MissionExecution,
  type MissionInput,
  type MissionStatus,
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
    mission.execution = mission.execution ? { ...mission.execution, nextRetryAt: undefined } : undefined;
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

    mission.status = mission.approvalRequired && !mission.approvedAt ? 'waiting_approval' : 'queued';
    mission.updatedAt = nowIso();
    mission.execution = mission.execution ? {
      ...mission.execution,
      blockedReason: undefined,
      planningStartedAt: undefined,
      retryCount: 0,
      lastFailure: undefined,
      nextRetryAt: undefined,
    } : { retryCount: 0 };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.status_changed', requiresFreshApproval
      ? 'Self-improvement retry returned to explicit approval.'
      : 'Mission queued for explicit retry.', { status: mission.status, retryCount: 0 });
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
    mission.status = 'queued';
    mission.updatedAt = nowIso();
    mission.execution = {
      ...(mission.execution ?? {}),
      planningStartedAt: undefined,
      retryCount: nextRetryCount,
      lastFailure: safeReason,
      blockedReason: undefined,
      nextRetryAt,
    };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.retry_scheduled', `Planning failed: ${safeReason} Automatic retry ${nextRetryCount}/${maxRetries} scheduled.`, {
      status: 'queued',
      retryCount: nextRetryCount,
      maxRetries,
      delayMs: boundedDelayMs,
      nextRetryAt,
      reason: safeReason,
    });
    this.onChange();
    return { mission, scheduled: true, retryCount: nextRetryCount, maxRetries };
  }

  recoverInterruptedMissions(): Mission[] {
    const recovered: Mission[] = [];
    for (const mission of this.missions.values()) {
      if (!['planning', 'running', 'testing'].includes(mission.status)) continue;
      const reason = 'Taso Core restarted while this mission was executing. Review and retry it explicitly.';
      mission.status = 'failed';
      mission.updatedAt = nowIso();
      mission.execution = {
        ...(mission.execution ?? {}),
        blockedReason: reason,
        lastFailure: reason,
        nextRetryAt: undefined,
      };
      this.events.append(mission.id, 'mission.status_changed', 'Interrupted mission marked failed after Taso Core restart.', {
        status: 'failed',
        blockedReason: reason,
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
      ? { planningStartedAt: timestamp, nextRetryAt: undefined, blockedReason: undefined }
      : status === 'failed' || status === 'completed' || status === 'preview_ready'
        ? { nextRetryAt: undefined }
        : {};
    if (execution || Object.keys(lifecycleExecution).length) {
      mission.execution = { ...(mission.execution ?? {}), ...lifecycleExecution, ...(execution ?? {}) };
    }
    this.missions.set(id, mission);
    this.events.append(id, 'mission.status_changed', message, {
      status,
      ...(metadata ?? {}),
      ...(execution?.blockedReason ? { blockedReason: execution.blockedReason } : {}),
      ...(mission.execution?.retryCount !== undefined ? { retryCount: mission.execution.retryCount } : {}),
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
}
