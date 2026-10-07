import type { MissionInput, Project } from './domain.js';

export interface PolicyDecision {
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
}

const destructiveTerms = [
  'drop database',
  'truncate',
  'delete production',
  'rotate secret',
  'change dns',
  'root access',
  'disable firewall',
];

export function evaluateMissionPolicy(
  project: Project,
  mission: MissionInput,
): PolicyDecision {
  const objective = mission.objective.toLowerCase();

  if (destructiveTerms.some((term) => objective.includes(term))) {
    return {
      allowed: true,
      approvalRequired: true,
      reason: 'Potentially destructive or infrastructure-wide operation detected.',
    };
  }

  if (mission.riskLevel === 'HIGH_IMPACT') {
    return {
      allowed: true,
      approvalRequired: true,
      reason: 'HIGH_IMPACT missions always require explicit approval.',
    };
  }

  if (mission.riskLevel === 'WRITE' && project.technology.stackMode === 'preserve') {
    return {
      allowed: true,
      approvalRequired: false,
      reason: 'Project-scoped write is allowed while preserving the existing architecture.',
    };
  }

  return {
    allowed: true,
    approvalRequired: false,
    reason: 'Mission is within the autonomous low-risk policy.',
  };
}

export const forbiddenAgentCapabilities = [
  'read_raw_provider_keys',
  'read_root_ssh_credentials',
  'mount_docker_socket',
  'read_other_project_workspace',
  'direct_production_database_root',
  'disable_security_gateway',
] as const;
