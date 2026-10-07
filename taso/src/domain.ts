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
  createdAt: string;
  updatedAt: string;
}

export const defaultAutonomousPolicy: AutonomousPolicy = {
  enabled: true,
  maxRetries: 5,
  previewRequired: true,
  production: 'ask',
  destructive: 'deny',
  paidAi: false,
  notifications: 'important_only',
};

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
