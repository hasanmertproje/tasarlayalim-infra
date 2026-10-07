import {
  createId,
  defaultAutonomousPolicy,
  nowIso,
  type AutonomousPolicy,
  type Mission,
  type MissionInput,
} from './domain.js';
import { evaluateMissionPolicy } from './policy.js';
import type { ProjectRegistry } from './project-registry.js';
import type { ProviderRouter } from './provider-router.js';

export class TaskEngine {
  private readonly missions = new Map<string, Mission>();

  constructor(
    private readonly projects: ProjectRegistry,
    private readonly router: ProviderRouter,
  ) {}

  createMission(input: MissionInput): Mission {
    const project = this.projects.get(input.projectId);
    if (!project) throw new Error('Project not found.');
    if (!input.objective.trim()) throw new Error('Mission objective is required.');

    const autonomous: AutonomousPolicy = {
      ...defaultAutonomousPolicy,
      ...input.autonomous,
    };

    const decision = evaluateMissionPolicy(project, input);
    if (!decision.allowed) throw new Error(decision.reason);

    const providerChain = this.router
      .route({
        dataClass: input.dataClass,
        paidAi: autonomous.paidAi,
        preferFree: true,
      })
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
    return mission;
  }

  getMission(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  listMissions(): Mission[] {
    return [...this.missions.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  approveMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    if (!mission.approvalRequired) return mission;
    if (mission.status !== 'waiting_approval') {
      throw new Error(`Mission cannot be approved from status ${mission.status}.`);
    }

    mission.approvedAt = nowIso();
    mission.status = 'queued';
    mission.updatedAt = mission.approvedAt;
    this.missions.set(id, mission);
    return mission;
  }

  cancelMission(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) throw new Error('Mission not found.');
    mission.status = 'cancelled';
    mission.updatedAt = nowIso();
    this.missions.set(id, mission);
    return mission;
  }
}
