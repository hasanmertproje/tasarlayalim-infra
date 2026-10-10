import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission, Project } from '../src/domain.js';
import { bindMissionProjectContext } from '../src/mission-project-context.js';
import type { ProjectKnowledgeStore } from '../src/project-knowledge.js';
import type { ProjectRegistry } from '../src/project-registry.js';
import type { RuntimeSelfHealingExecutor } from '../src/runtime-self-healing-executor.js';
import type { TaskEngine } from '../src/task-engine.js';

function project(): Project {
  return {
    id: 'project_demo',
    slug: 'demo',
    name: 'Demo',
    repository: 'owner/demo',
    isExisting: true,
    defaultBranch: 'main',
    technology: { stackMode: 'preserve', architecture: 'preserve_existing' },
    createdAt: new Date(0).toISOString(),
  };
}

function mission(): Mission {
  return {
    id: 'mission_demo',
    projectId: 'project_demo',
    objective: 'Dashboard mobil responsive hatasını düzelt',
    riskLevel: 'WRITE',
    dataClass: 'private_code',
    status: 'queued',
    providerChain: [],
    autonomous: {
      enabled: true,
      maxRetries: 2,
      previewRequired: true,
      production: 'ask',
      destructive: 'deny',
      paidAi: false,
      notifications: 'important_only',
    },
    approvalRequired: false,
    execution: { progressPercent: 0, agentRuns: [] },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test('execution binder attaches bounded manifest and relevant knowledge before original executor runs', async () => {
  const currentMission = mission();
  const currentProject = project();
  let originalSawProfile = false;
  const notes: Array<Record<string, unknown> | undefined> = [];

  const executor = {
    execute: async () => {
      originalSawProfile = Boolean(currentMission.execution?.intentProfile);
      return currentMission;
    },
  } as unknown as RuntimeSelfHealingExecutor;
  const tasks = {
    getMission: (id: string) => id === currentMission.id ? currentMission : undefined,
    noteMission: (_id: string, _message: string, metadata?: Record<string, unknown>) => { notes.push(metadata); },
  } as unknown as TaskEngine;
  const projects = {
    get: (id: string) => id === currentProject.id ? currentProject : undefined,
    getManifest: () => ({
      projectId: currentProject.id,
      source: 'manual' as const,
      appType: 'web-app',
      languages: ['TypeScript'],
      frameworks: ['React'],
      packageManagers: ['npm'],
      databases: [],
      commands: { build: 'npm run build' },
      deployment: {},
      protectedPaths: ['infra/'],
      constraints: ['Preserve current API contracts'],
      confidence: 1,
      discoveredAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
  } as unknown as ProjectRegistry;
  const knowledge = {
    list: () => [
      {
        id: 'knowledge_ui',
        projectId: currentProject.id,
        kind: 'decision' as const,
        title: 'Dashboard responsive rule',
        body: 'Mobil navigation bottom sheet kullanır. api_key=very-secret-value',
        tags: ['dashboard', 'mobil'],
        source: 'manual' as const,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 'knowledge_irrelevant',
        projectId: currentProject.id,
        kind: 'note' as const,
        title: 'Unrelated accounting note',
        body: 'Muhasebe notu.',
        tags: ['accounting'],
        source: 'manual' as const,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
  } as unknown as ProjectKnowledgeStore;

  bindMissionProjectContext(executor, tasks, projects, knowledge);
  await executor.execute(currentMission.id);

  assert.equal(originalSawProfile, true);
  const profile = currentMission.execution?.intentProfile;
  assert.ok(profile);
  assert.equal(profile.contextSources?.manifest, true);
  assert.equal(profile.contextSources?.knowledgeRecords, 1);
  assert.ok(profile.projectContext?.some((line) => line.includes('Project stack: TypeScript, React')));
  assert.ok(profile.projectContext?.some((line) => line.includes('[redacted]')));
  assert.equal(profile.projectContext?.some((line) => line.includes('very-secret-value')), false);
  assert.equal(notes.length, 1);
});
