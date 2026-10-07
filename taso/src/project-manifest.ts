import { nowIso } from './domain.js';

export interface ProjectManifest {
  projectId: string;
  source: 'discovered' | 'manual' | 'imported';
  appType?: string;
  languages: string[];
  frameworks: string[];
  architecture?: string;
  packageManagers: string[];
  databases: string[];
  commands: {
    install?: string;
    lint?: string;
    typecheck?: string;
    test?: string;
    build?: string;
    migrate?: string;
    start?: string;
  };
  deployment: {
    strategy?: string;
    port?: number;
    healthcheck?: string;
  };
  protectedPaths: string[];
  constraints: string[];
  confidence: number;
  discoveredAt: string;
  updatedAt: string;
}

export interface UpsertProjectManifestInput {
  source?: ProjectManifest['source'];
  appType?: string;
  languages?: string[];
  frameworks?: string[];
  architecture?: string;
  packageManagers?: string[];
  databases?: string[];
  commands?: ProjectManifest['commands'];
  deployment?: ProjectManifest['deployment'];
  protectedPaths?: string[];
  constraints?: string[];
  confidence?: number;
}

export function createManifest(
  projectId: string,
  input: UpsertProjectManifestInput,
  previous?: ProjectManifest,
): ProjectManifest {
  const timestamp = nowIso();
  const confidence = input.confidence ?? previous?.confidence ?? 0;
  if (confidence < 0 || confidence > 1) {
    throw new Error('Manifest confidence must be between 0 and 1.');
  }

  return {
    projectId,
    source: input.source ?? previous?.source ?? 'manual',
    appType: input.appType ?? previous?.appType,
    languages: input.languages ?? previous?.languages ?? [],
    frameworks: input.frameworks ?? previous?.frameworks ?? [],
    architecture: input.architecture ?? previous?.architecture,
    packageManagers: input.packageManagers ?? previous?.packageManagers ?? [],
    databases: input.databases ?? previous?.databases ?? [],
    commands: {
      ...(previous?.commands ?? {}),
      ...(input.commands ?? {}),
    },
    deployment: {
      ...(previous?.deployment ?? {}),
      ...(input.deployment ?? {}),
    },
    protectedPaths: input.protectedPaths ?? previous?.protectedPaths ?? [],
    constraints: input.constraints ?? previous?.constraints ?? [],
    confidence,
    discoveredAt: previous?.discoveredAt ?? timestamp,
    updatedAt: timestamp,
  };
}
