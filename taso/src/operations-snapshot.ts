import type { AgentRun, Mission, Project } from './domain.js';
import type { MissionEvent } from './mission-events.js';
import { summarizeMilestones, type ProjectMilestone, type ProjectMilestoneProgress } from './project-milestones.js';

const activeStatuses = new Set(['queued', 'planning', 'running', 'testing']);
const deliveredStatuses = new Set(['completed', 'preview_ready']);
const terminalStatuses = new Set(['completed', 'preview_ready', 'failed', 'cancelled']);

export type RuntimeReadiness = {
  readyForRead?: boolean;
  readyForWrite?: boolean;
  readyForDeploy?: boolean;
  ai?: { configured?: boolean };
  github?: { configured?: boolean };
  coolify?: { configured?: boolean };
  activeMissionIds?: string[];
  planningTimeoutMs?: number;
};

export type ProjectOperationsSummary = {
  projectId: string;
  slug: string;
  name: string;
  totalMissions: number;
  activeMissions: number;
  deliveredMissions: number;
  failedMissions: number;
  cancelledMissions: number;
  waitingApproval: number;
  retryingMissions: number;
  missionCompletionPercent: number;
  terminalSuccessPercent: number | null;
  milestoneProgress: ProjectMilestoneProgress;
  milestones: ProjectMilestone[];
  lastActivityAt?: string;
};

export type OperationsActivityItem = {
  id: string;
  missionId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  objective: string;
  missionStatus: string;
  type: MissionEvent['type'];
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type AgentOperationsItem = {
  id: string;
  label: string;
  status: 'ready' | 'busy' | 'degraded' | 'unconfigured';
  detail: string;
  activeMissions?: number;
  missionId?: string;
  projectId?: string;
  role?: AgentRun['role'];
  progress?: number;
  startedAt?: string;
};

export type SelfImprovementItem = {
  missionId: string;
  projectId: string;
  projectName: string;
  objective: string;
  status: string;
  updatedAt: string;
  blockedReason?: string;
};

export type OperationsSnapshot = {
  generatedAt: string;
  agents: AgentOperationsItem[];
  projects: ProjectOperationsSummary[];
  activity: OperationsActivityItem[];
  selfImprovement: {
    detection: 'objective-keywords';
    missions: SelfImprovementItem[];
  };
};

function isSelfImprovementMission(mission: Mission) {
  const objective = mission.objective.toLowerCase();
  const mentionsTaso = /\btaso\b/.test(objective);
  const improvement = /self[-\s]?improv|self[-\s]?upgrade|iyileştir|iyilestir|geliştir|gelistir|refactor|öz[-\s]?gelişim|oz[-\s]?gelisim/.test(objective);
  return mentionsTaso && improvement;
}

function latestTimestamp(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}

function summarizeProject(project: Project, missions: Mission[], milestones: ProjectMilestone[]): ProjectOperationsSummary {
  const scoped = missions.filter((mission) => mission.projectId === project.id);
  const scopedMilestones = milestones.filter((milestone) => milestone.projectId === project.id);
  const deliveredMissions = scoped.filter((mission) => deliveredStatuses.has(mission.status)).length;
  const terminal = scoped.filter((mission) => terminalStatuses.has(mission.status));
  const successfulTerminal = terminal.filter((mission) => deliveredStatuses.has(mission.status)).length;

  return {
    projectId: project.id,
    slug: project.slug,
    name: project.name,
    totalMissions: scoped.length,
    activeMissions: scoped.filter((mission) => activeStatuses.has(mission.status)).length,
    deliveredMissions,
    failedMissions: scoped.filter((mission) => mission.status === 'failed').length,
    cancelledMissions: scoped.filter((mission) => mission.status === 'cancelled').length,
    waitingApproval: scoped.filter((mission) => mission.status === 'waiting_approval').length,
    retryingMissions: scoped.filter((mission) => mission.status === 'queued' && Boolean(mission.execution?.nextRetryAt)).length,
    missionCompletionPercent: scoped.length ? Math.round((deliveredMissions / scoped.length) * 100) : 0,
    terminalSuccessPercent: terminal.length ? Math.round((successfulTerminal / terminal.length) * 100) : null,
    milestoneProgress: summarizeMilestones(scopedMilestones),
    milestones: scopedMilestones,
    lastActivityAt: latestTimestamp([
      ...scoped.map((mission) => mission.updatedAt),
      ...scopedMilestones.map((milestone) => milestone.updatedAt),
    ]),
  };
}

function liveWorkerAgents(missions: Mission[], projects: Project[]): AgentOperationsItem[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return missions.flatMap((mission) => {
    const runs = mission.execution?.agentRuns ?? [];
    const activeRuns = runs.filter((run) => run.status === 'running');
    return activeRuns.map((run) => ({
      id: `worker:${run.id}`,
      label: run.label,
      status: 'busy' as const,
      detail: `${projectById.get(mission.projectId)?.name ?? mission.projectId} · ${run.action}`,
      activeMissions: 1,
      missionId: mission.id,
      projectId: mission.projectId,
      role: run.role,
      progress: run.progress,
      startedAt: run.startedAt,
    }));
  });
}

export function buildOperationsSnapshot(input: {
  projects: Project[];
  milestones: ProjectMilestone[];
  missions: Mission[];
  events: MissionEvent[];
  readiness: RuntimeReadiness;
  watchdogRunning: boolean;
  limit?: number;
}): OperationsSnapshot {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 30)));
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const missionById = new Map(input.missions.map((mission) => [mission.id, mission]));
  const activeMissionIds = input.readiness.activeMissionIds ?? [];
  const planningCount = input.missions.filter((mission) => mission.status === 'planning').length;

  const activity = [...input.events]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((event): OperationsActivityItem[] => {
      const mission = missionById.get(event.missionId);
      if (!mission) return [];
      const project = projectById.get(mission.projectId);
      if (!project) return [];
      return [{
        id: event.id,
        missionId: mission.id,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        objective: mission.objective,
        missionStatus: mission.status,
        type: event.type,
        message: event.message,
        metadata: event.metadata,
        createdAt: event.createdAt,
      }];
    })
    .slice(0, limit);

  const selfImprovement = input.missions
    .filter(isSelfImprovementMission)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((mission): SelfImprovementItem => ({
      missionId: mission.id,
      projectId: mission.projectId,
      projectName: projectById.get(mission.projectId)?.name ?? mission.projectId,
      objective: mission.objective,
      status: mission.status,
      updatedAt: mission.updatedAt,
      blockedReason: mission.execution?.blockedReason,
    }));

  const aiReady = Boolean(input.readiness.ai?.configured);
  const githubReady = Boolean(input.readiness.github?.configured);
  const coolifyReady = Boolean(input.readiness.coolify?.configured);
  const executorReady = Boolean(input.readiness.readyForRead && input.readiness.readyForWrite);
  const workers = liveWorkerAgents(input.missions, input.projects);

  return {
    generatedAt: new Date().toISOString(),
    agents: [
      ...workers,
      {
        id: 'planner',
        label: 'AI Planner',
        status: !aiReady ? 'unconfigured' : planningCount > 0 ? 'busy' : 'ready',
        detail: !aiReady ? 'AI provider runtime is not configured.' : planningCount > 0 ? `${planningCount} mission planning.` : 'Provider router ready.',
        activeMissions: planningCount,
      },
      {
        id: 'executor',
        label: 'Mission Executor',
        status: !executorReady ? 'degraded' : activeMissionIds.length > 0 ? 'busy' : 'ready',
        detail: !executorReady ? 'Read/write execution dependencies are incomplete.' : activeMissionIds.length > 0 ? `${activeMissionIds.length} mission executing.` : 'Read/write execution ready.',
        activeMissions: activeMissionIds.length,
      },
      {
        id: 'watchdog',
        label: 'Planning Watchdog',
        status: input.watchdogRunning ? 'ready' : 'degraded',
        detail: input.watchdogRunning
          ? `Planning stall protection active${input.readiness.planningTimeoutMs ? ` • ${Math.round(input.readiness.planningTimeoutMs / 1000)}s deadline` : ''}.`
          : 'Planning watchdog is not running.',
      },
      {
        id: 'github',
        label: 'GitHub Broker',
        status: githubReady ? 'ready' : 'unconfigured',
        detail: githubReady ? 'Repository read/write broker configured.' : 'GitHub runtime is not configured.',
      },
      {
        id: 'coolify',
        label: 'Coolify Broker',
        status: coolifyReady ? 'ready' : 'unconfigured',
        detail: coolifyReady ? 'Deployment broker configured.' : 'Production/preview deploy broker is not configured.',
      },
    ],
    projects: input.projects.map((project) => summarizeProject(project, input.missions, input.milestones)),
    activity,
    selfImprovement: {
      detection: 'objective-keywords',
      missions: selfImprovement,
    },
  };
}
