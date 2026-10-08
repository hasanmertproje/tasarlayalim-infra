import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission, Project } from '../src/domain.js';
import type { MissionEvent } from '../src/mission-events.js';
import { buildOperationsSnapshot } from '../src/operations-snapshot.js';

const project: Project = {
  id: 'project_1',
  slug: 'taso',
  name: 'Taso',
  repository: 'example/taso',
  isExisting: true,
  defaultBranch: 'main',
  technology: { stackMode: 'preserve', architecture: 'preserve_existing' },
  createdAt: '2026-10-08T10:00:00.000Z',
};

function mission(id: string, status: Mission['status'], objective = 'Normal task'): Mission {
  return {
    id,
    projectId: project.id,
    objective,
    riskLevel: 'WRITE',
    dataClass: 'private_code',
    status,
    providerChain: ['private-test'],
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
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:05:00.000Z',
  };
}

const events: MissionEvent[] = [
  {
    id: 'event_old',
    missionId: 'mission_done',
    type: 'mission.created',
    message: 'Mission created.',
    createdAt: '2026-10-08T10:00:00.000Z',
  },
  {
    id: 'event_new',
    missionId: 'mission_active',
    type: 'mission.status_changed',
    message: 'Planning started.',
    createdAt: '2026-10-08T10:06:00.000Z',
  },
];

test('operations snapshot exposes real project mission completion and newest activity first', () => {
  const missions = [mission('mission_done', 'completed'), mission('mission_active', 'planning')];
  const snapshot = buildOperationsSnapshot({
    projects: [project],
    missions,
    events,
    readiness: {
      readyForRead: true,
      readyForWrite: true,
      ai: { configured: true },
      github: { configured: true },
      coolify: { configured: false },
      activeMissionIds: ['mission_active'],
      planningTimeoutMs: 180_000,
    },
    watchdogRunning: true,
  });

  assert.equal(snapshot.projects[0]?.totalMissions, 2);
  assert.equal(snapshot.projects[0]?.deliveredMissions, 1);
  assert.equal(snapshot.projects[0]?.activeMissions, 1);
  assert.equal(snapshot.projects[0]?.missionCompletionPercent, 50);
  assert.equal(snapshot.activity[0]?.id, 'event_new');
  assert.equal(snapshot.activity[0]?.projectName, 'Taso');
  assert.equal(snapshot.agents.find((agent) => agent.id === 'planner')?.status, 'busy');
  assert.equal(snapshot.agents.find((agent) => agent.id === 'coolify')?.status, 'unconfigured');
});

test('self-improvement list is deterministic and does not classify unrelated missions', () => {
  const missions = [
    mission('mission_self', 'failed', 'Taso Self-Improvement FINAL IMPLEMENTATION'),
    mission('mission_other', 'completed', 'Customer checkout refactor'),
  ];
  missions[0]!.execution = { blockedReason: 'Planner timeout' };

  const snapshot = buildOperationsSnapshot({
    projects: [project],
    missions,
    events: [],
    readiness: {},
    watchdogRunning: false,
  });

  assert.equal(snapshot.selfImprovement.detection, 'objective-keywords');
  assert.deepEqual(snapshot.selfImprovement.missions.map((item) => item.missionId), ['mission_self']);
  assert.equal(snapshot.selfImprovement.missions[0]?.blockedReason, 'Planner timeout');
  assert.equal(snapshot.agents.find((agent) => agent.id === 'watchdog')?.status, 'degraded');
});
