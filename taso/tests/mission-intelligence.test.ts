import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../src/domain.js';
import { deriveMissionIntentProfile } from '../src/mission-intelligence.js';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project_demo',
    slug: 'demo',
    name: 'Demo',
    repository: 'owner/repo',
    isExisting: true,
    defaultBranch: 'main',
    technology: { stackMode: 'preserve', architecture: 'preserve_existing' },
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test('website mission gets frontend, QA and UI quality hints without an AI call', () => {
  const profile = deriveMissionIntentProfile(project(), 'Ajans websitesi dashboardunu premium yap, mobil ve masaüstünü düzelt');
  assert.equal(profile.mode, 'website');
  assert.ok(profile.requiredSpecialists.includes('frontend'));
  assert.ok(profile.requiredSpecialists.includes('qa'));
  assert.ok(profile.skillHints.includes('design-system'));
  assert.ok(profile.skillHints.includes('responsive-a11y'));
  assert.ok(profile.acceptanceHints.some((item) => item.includes('Desktop and mobile')));
  assert.ok(profile.constraints.some((item) => item.includes('Preserve the existing project architecture')));
});

test('fullstack mission identifies backend and database specialists', () => {
  const profile = deriveMissionIntentProfile(project(), 'Rezervasyon web arayüzünü geliştir, backend API ve PostgreSQL schema akışını düzelt');
  assert.equal(profile.mode, 'fullstack');
  assert.ok(profile.requiredSpecialists.includes('frontend'));
  assert.ok(profile.requiredSpecialists.includes('backend'));
  assert.ok(profile.requiredSpecialists.includes('database'));
  assert.ok(profile.requiredSpecialists.includes('qa'));
});

test('infrastructure mission stays infrastructure scoped', () => {
  const profile = deriveMissionIntentProfile(project(), 'Coolify production deploy ve Docker pipeline güvenliğini düzelt');
  assert.equal(profile.mode, 'infrastructure');
  assert.ok(profile.requiredSpecialists.includes('devops'));
  assert.ok(profile.requiredSpecialists.includes('security'));
  assert.ok(profile.skillHints.includes('deployment-safety'));
  assert.ok(profile.constraints.some((item) => item.includes('High-impact')));
});

test('unknown mission falls back to generalist plus QA and preserves goal', () => {
  const objective = 'Mevcut davranışı daha güvenilir hale getir';
  const profile = deriveMissionIntentProfile(project(), objective);
  assert.equal(profile.mode, 'general');
  assert.deepEqual(profile.requiredSpecialists, ['generalist', 'qa']);
  assert.equal(profile.goal, objective);
  assert.ok(profile.acceptanceHints.length >= 2);
});

test('project manifest and relevant knowledge become bounded grounded context with secrets redacted', () => {
  const profile = deriveMissionIntentProfile(project(), 'Dashboard tasarımını düzelt ve mobil yapıyı koru', {
    manifest: {
      projectId: 'project_demo',
      source: 'discovered',
      appType: 'React dashboard',
      languages: ['TypeScript'],
      frameworks: ['React', 'Vite'],
      architecture: 'SPA',
      packageManagers: ['npm'],
      databases: [],
      commands: { build: 'npm run build' },
      deployment: {},
      protectedPaths: ['src/auth'],
      constraints: ['Auth akışını değiştirme.'],
      confidence: 0.9,
      discoveredAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    knowledge: [
      {
        id: 'knowledge_1',
        projectId: 'project_demo',
        kind: 'decision',
        title: 'Dashboard kararı',
        body: 'Dashboard mobil öncelikli değil; masaüstü de eşit önemli. api_key=super-secret-value',
        tags: ['dashboard', 'mobil'],
        source: 'manual',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 'knowledge_2',
        projectId: 'project_demo',
        kind: 'note',
        title: 'Alakasız not',
        body: 'Muhasebe raporu hakkında not.',
        tags: ['finance'],
        source: 'manual',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
  });

  assert.equal(profile.contextSources?.manifest, true);
  assert.equal(profile.contextSources?.knowledgeRecords, 1);
  assert.ok(profile.projectContext?.some((item) => item.includes('React, Vite')));
  assert.ok(profile.projectContext?.some((item) => item.includes('Dashboard kararı')));
  assert.ok(profile.constraints.some((item) => item.includes('Auth akışını değiştirme')));
  assert.ok(profile.projectContext?.every((item) => !item.includes('super-secret-value')));
  assert.ok(profile.projectContext?.some((item) => item.includes('[redacted]')));
});
