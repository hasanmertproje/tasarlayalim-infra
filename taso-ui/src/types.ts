export type RiskLevel = 'READ' | 'WRITE' | 'HIGH_IMPACT';
export type DataClass = 'public' | 'private_code' | 'sensitive';
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

export type Project = {
  id: string;
  slug: string;
  name: string;
  repository: string;
  isExisting: boolean;
  defaultBranch: string;
  technology?: {
    stackMode?: string;
    architecture?: string;
    preferred?: string[];
    forbidden?: string[];
  };
  createdAt?: string;
};

export type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: MissionStatus;
  riskLevel: RiskLevel;
  dataClass: DataClass;
  providerChain?: string[];
  approvalRequired?: boolean;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  autonomous?: {
    enabled?: boolean;
    maxRetries?: number;
    previewRequired?: boolean;
    production?: 'ask' | 'deny' | 'auto';
    destructive?: 'ask' | 'deny';
    paidAi?: boolean;
    notifications?: 'important_only' | 'all';
  };
};

export type MissionEvent = {
  id?: string;
  missionId?: string;
  type: string;
  message: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type Provider = {
  id: string;
  displayName?: string;
  enabled?: boolean;
  costClass?: string;
  allowedDataClasses?: string[];
  strength?: number;
  latency?: number;
};

export type CoreHealth = {
  ok: boolean;
  service: string;
  version: string;
  gateway: 'configured' | 'missing';
};

export type AppNotice = {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};
