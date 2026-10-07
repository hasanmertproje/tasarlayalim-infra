import {
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

export class TaskEngine {
  private readonly missions = new Map<string, Mission>();

  constructor(
    private readonly projects: ProjectRegistry,
    private readonly router: ProviderRouter,
    private readonly events = new MissionEventStore(),
  ) {}

  createMission(input: MissionInput): Mission {
    const project = this.projects.get(input.projectId);
    if (!project) throw new Error('Project not found.');
    if (!input.objective.trim()) throw new Error('Mission objective is required.');

    const autonomous: AutonomousPolicy = { ...defaultAutonomousPolicy, ...input.autonomous };
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
    });
    if (mission.approvalRequired) this.events.append(mission.id, 'mission.approval_required', decision.reason);
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
    return mission;
  }

  cancelMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    mission.status = 'cancelled';
    mission.updatedAt = nowIso();
    this.missions.set(id, mission);
    this.events.append(id, 'mission.cancelled', 'Mission cancelled.');
    return mission;
  }

  retryMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    if (mission.status !== 'failed') throw new Error(`Mission cannot be retried from status ${mission.status}.`);
    mission.status = mission.approvalRequired && !mission.approvedAt ? 'waiting_approval' : 'queued';
    mission.updatedAt = nowIso();
    mission.execution = mission.execution ? { ...mission.execution, blockedReason: undefined } : undefined;
    this.missions.set(id, mission);
    this.events.append(id, 'mission.status_changed', 'Mission queued for retry.', { status: mission.status });
    return mission;
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
    mission.status = status;
    mission.updatedAt = nowIso();
    if (execution) mission.execution = { ...(mission.execution ?? {}), ...execution };
    this.missions.set(id, mission);
    this.events.append(id, 'mission.status_changed', message, { status, ...(metadata ?? {}) });
    return mission;
  }

  noteMission(id: string, message: string, metadata?: Record<string, unknown>): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    this.events.append(id, 'mission.note', message, metadata);
    return mission;
  }
}
