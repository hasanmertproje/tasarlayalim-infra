import { createId, nowIso } from './domain.js';

export type ProjectMilestoneStatus = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  weight: number;
  progress: number;
  status: ProjectMilestoneStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateProjectMilestoneInput {
  title: string;
  description?: string;
  weight?: number;
  progress?: number;
  status?: ProjectMilestoneStatus;
}

export interface UpdateProjectMilestoneInput {
  title?: string;
  description?: string;
  weight?: number;
  progress?: number;
  status?: ProjectMilestoneStatus;
}

export interface ProjectMilestoneProgress {
  configured: boolean;
  percent: number | null;
  total: number;
  completed: number;
  blocked: number;
  active: number;
  cancelled: number;
  totalWeight: number;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeStatus(value: unknown, fallback: ProjectMilestoneStatus): ProjectMilestoneStatus {
  return value === 'planned' || value === 'in_progress' || value === 'blocked' || value === 'completed' || value === 'cancelled'
    ? value
    : fallback;
}

function normalizeProgress(status: ProjectMilestoneStatus, progress: unknown, fallback = 0) {
  if (status === 'completed') return 100;
  if (status === 'planned') return 0;
  return clampInteger(progress, fallback, 0, 99);
}

export function summarizeMilestones(milestones: ProjectMilestone[]): ProjectMilestoneProgress {
  const included = milestones.filter((milestone) => milestone.status !== 'cancelled');
  const totalWeight = included.reduce((sum, milestone) => sum + milestone.weight, 0);
  const weightedProgress = included.reduce((sum, milestone) => sum + (milestone.weight * milestone.progress), 0);

  return {
    configured: milestones.length > 0,
    percent: totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : null,
    total: milestones.length,
    completed: milestones.filter((milestone) => milestone.status === 'completed').length,
    blocked: milestones.filter((milestone) => milestone.status === 'blocked').length,
    active: milestones.filter((milestone) => milestone.status === 'in_progress').length,
    cancelled: milestones.filter((milestone) => milestone.status === 'cancelled').length,
    totalWeight,
  };
}

export class ProjectMilestoneStore {
  private readonly milestones = new Map<string, ProjectMilestone>();

  constructor(
    initialMilestones: ProjectMilestone[] = [],
    private readonly projectExists: (projectId: string) => boolean = () => true,
    private readonly onChange: () => void = () => {},
  ) {
    for (const milestone of initialMilestones) this.milestones.set(milestone.id, structuredClone(milestone));
  }

  list(projectId?: string): ProjectMilestone[] {
    return [...this.milestones.values()]
      .filter((milestone) => !projectId || milestone.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): ProjectMilestone | undefined {
    return this.milestones.get(id);
  }

  create(projectId: string, input: CreateProjectMilestoneInput): ProjectMilestone {
    if (!this.projectExists(projectId)) throw new Error('Project not found.');
    const title = input.title?.trim();
    if (!title) throw new Error('Milestone title is required.');

    const status = normalizeStatus(input.status, 'planned');
    const timestamp = nowIso();
    const milestone: ProjectMilestone = {
      id: createId('milestone'),
      projectId,
      title,
      description: input.description?.trim() || undefined,
      weight: clampInteger(input.weight, 1, 1, 100),
      progress: normalizeProgress(status, input.progress),
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: status === 'completed' ? timestamp : undefined,
    };

    this.milestones.set(milestone.id, milestone);
    this.onChange();
    return structuredClone(milestone);
  }

  update(projectId: string, milestoneId: string, input: UpdateProjectMilestoneInput): ProjectMilestone {
    const milestone = this.milestones.get(milestoneId);
    if (!milestone || milestone.projectId !== projectId) throw new Error('Milestone not found.');

    const status = normalizeStatus(input.status, milestone.status);
    const title = input.title === undefined ? milestone.title : input.title.trim();
    if (!title) throw new Error('Milestone title is required.');

    milestone.title = title;
    if (input.description !== undefined) milestone.description = input.description.trim() || undefined;
    milestone.weight = input.weight === undefined ? milestone.weight : clampInteger(input.weight, milestone.weight, 1, 100);
    milestone.status = status;
    milestone.progress = normalizeProgress(status, input.progress, input.progress === undefined ? milestone.progress : 0);
    milestone.updatedAt = nowIso();
    milestone.completedAt = status === 'completed' ? (milestone.completedAt ?? milestone.updatedAt) : undefined;

    this.milestones.set(milestone.id, milestone);
    this.onChange();
    return structuredClone(milestone);
  }

  progress(projectId: string): ProjectMilestoneProgress {
    if (!this.projectExists(projectId)) throw new Error('Project not found.');
    return summarizeMilestones(this.list(projectId));
  }
}
