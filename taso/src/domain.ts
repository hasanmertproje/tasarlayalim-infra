import { randomUUID } from 'node:crypto';

export type RiskLevel = 'READ' | 'WRITE' | 'HIGH_IMPACT';
export type DataClass = 'public' | 'private_code' | 'sensitive';
export type CostClass = 'free' | 'credit' | 'paid';
export type MissionStatus =
  | 'queued'
  | 'waiting_approval'
  | 'planning'
  | 'running'
  | 'testing'
  | 'preview_ready'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentRole = 'scout' | 'architect' | 'builder' | 'verifier' | 'release';
export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SpecialistRole = 'frontend' | 'backend' | 'database' | 'security' | 'qa' | 'devops' | 'generalist';
export type MissionStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type MissionArtifactType = 'context' | 'analysis' | 'file-change' | 'pull-request' | 'ci' | 'ci-diagnostic' | 'repair-commit' | 'runtime-diagnostic' | 'runtime-repair-commit' | 'preview' | 'deployment';

export interface AgentRun {
  id: string;
  missionId: string;
  role: AgentRole;
  label: string;
  specialist?: SpecialistRole | 'repository-publisher';
  stepId?: string;
  status: AgentRunStatus;
  action: string;
  progress: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  detail?: string;
  error?: string;
}

export interface MissionStep {
  id: string;
  title: string;
  objective: string;
  specialist: SpecialistRole;
  status: MissionStepStatus;
  dependsOn: string[];
  targetPaths: string[];
  progress: number;
  attempts?: number;
  maxAttempts?: number;
  lastAttemptAt?: string;
  startedAt?: string;
  completedAt?: string;
  outputSummary?: string;
  error?: string;
}

export interface MissionArtifact {
  id: string;
  missionId: string;
  stepId?: string;
  type: MissionArtifactType;
  label: string;
  path?: string;
  url?: string;
  summary?: string;
  createdAt: string;
}

export interface AgentHandoff {
  id: string;
  missionId: string;
  fromStepId: string;
  toStepId: string;
  summary: string;
  artifactIds: string[];
  createdAt: string;
}

export interface WorkspaceCheckpointFile {
  path: string;
  content: string;
  producedByStepId: string;
  updatedAt: string;
}

export interface MissionWorkspaceCheckpoint {
  version: 1;
  files: WorkspaceCheckpointFile[];
  completedStepIds: string[];
  updatedAt: string;
}

export type StackMode = 'auto' | 'preserve' | 'pinned';
export type ArchitectureMode =
  | 'professional_best_fit'
  | 'mvc'
  | 'modular_monolith'
  | 'api_first'
  | 'microservices'
  | 'preserve_existing';

export interface TechnologyPolicy {
  stackMode: StackMode;
  architecture: ArchitectureMode;
  preferred?: string[];
  forbidden?: string[];
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  repository: string;
  isExisting: boolean;
  defaultBranch: string;
  technology: TechnologyPolicy;
  createdAt: string;
}

export interface AutonomousPolicy {
  enabled: boolean;
  maxRetries: number;
  previewRequired: boolean;
  production: 'ask' | 'deny' | 'auto';
  destructive: 'ask' | 'deny';
  paidAi: boolean;
  notifications: 'important_only' | 'all';
}

export interface MissionInput {
  projectId: string;
  objective: string;
  riskLevel: RiskLevel;
  dataClass: DataClass;
  autonomous?: Partial<AutonomousPolicy>;
}

export interface MissionExecution {
  summary?: string;
  branch?: string;
  commitSha?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  previewDeploymentUuid?: string;
  previewUrl?: string;
  productionDeploymentUuid?: string;
  productionUrl?: string;
  checkState?: 'success' | 'failed' | 'pending' | 'missing';
  blockedReason?: string;
  planningStartedAt?: string;
  retryCount?: number;
  lastFailure?: string;
  nextRetryAt?: string;
  progressPercent?: number;
  currentAction?: string;
  activeAgentRole?: AgentRole;
  agentRuns?: AgentRun[];
  orchestrationSummary?: string;
  workPlan?: MissionStep[];
  artifacts?: MissionArtifact[];
  handoffs?: AgentHandoff[];
  workspaceCheckpoint?: MissionWorkspaceCheckpoint;
  resumeAfterRestart?: boolean;
  ciRepairAttempts?: number;
  maxCiRepairAttempts?: number;
  lastCiFailureSummary?: string;
  runtimeRepairAttempts?: number;
  maxRuntimeRepairAttempts?: number;
  lastRuntimeFailureSummary?: string;
}

export interface Mission {
  id: string;
  projectId: string;
  objective: string;
  riskLevel: RiskLevel;
  dataClass: DataClass;
  status: MissionStatus;
  providerChain: string[];
  autonomous: AutonomousPolicy;
  approvalRequired: boolean;
  approvedAt?: string;
  execution?: MissionExecution;
  createdAt: string;
  updatedAt: string;
}

export const MAX_AUTONOMOUS_RETRIES = 5;

export const defaultAutonomousPolicy: AutonomousPolicy = {
  enabled: true,
  maxRetries: 5,
  previewRequired: true,
  production: 'ask',
  destructive: 'deny',
  paidAi: false,
  notifications: 'important_only',
};

export function clampRetries(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultAutonomousPolicy.maxRetries;
  return Math.min(MAX_AUTONOMOUS_RETRIES, Math.max(0, Math.trunc(value)));
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
