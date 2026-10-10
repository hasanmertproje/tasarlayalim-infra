import { nowIso, type MissionIntentProfile, type Project, type SpecialistRole } from './domain.js';

function normalize(value: string) {
  return value.toLocaleLowerCase('tr-TR');
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function deriveMissionIntentProfile(project: Project, objective: string): MissionIntentProfile {
  const value = normalize(objective);
  const specialists: SpecialistRole[] = [];
  const skillHints: string[] = [];
  const acceptanceHints: string[] = [];
  const constraints: string[] = [];

  const website = includesAny(value, [
    'website', 'web site', 'websitesi', 'sitesi', 'landing page', 'anasayfa', 'homepage',
    'dashboard', 'arayüz', 'arayuz', 'ui', 'responsive', 'mobil', 'masaüstü', 'masaustu',
  ]);
  const backend = includesAny(value, [
    'backend', 'api', 'endpoint', 'sunucu', 'server', 'service', 'servis', 'webhook', 'queue', 'worker',
  ]);
  const database = includesAny(value, [
    'database', 'veritaban', 'sql', 'postgres', 'mysql', 'mariadb', 'schema', 'migration', 'tablo',
  ]);
  const security = includesAny(value, [
    'security', 'güvenlik', 'guvenlik', 'güvenli', 'guvenli', 'güvenliğ', 'guvenlig',
    'auth', 'login', 'oturum', 'permission', 'yetki', 'token', 'secret', 'kvkk',
  ]);
  const infrastructure = includesAny(value, [
    'deploy', 'deployment', 'docker', 'coolify', 'ci', 'pipeline', 'infrastructure', 'infra', 'vps', 'production', 'canlıya', 'canliya',
  ]);
  const design = includesAny(value, ['tasarım', 'tasarim', 'design', 'premium', 'jarvis', 'animasyon', 'motion', 'ux']);
  const seo = includesAny(value, ['seo', 'arama motor', 'schema.org', 'structured data']);
  const accessibility = includesAny(value, ['erişilebilir', 'erisilebilir', 'accessibility', 'a11y', 'screen reader', 'klavye']);
  const testing = includesAny(value, ['test', 'qa', 'doğrula', 'dogrula', 'verification', 'kontrol et', 'smoke']);

  if (website || design || seo || accessibility) specialists.push('frontend');
  if (backend) specialists.push('backend');
  if (database) specialists.push('database');
  if (security) specialists.push('security');
  if (infrastructure) specialists.push('devops');
  if (testing || website || backend || database || security || infrastructure) specialists.push('qa');
  if (!specialists.length) specialists.push('generalist', 'qa');

  if (website) {
    skillHints.push('frontend-patterns', 'responsive-a11y');
    acceptanceHints.push('Desktop and mobile layouts must both be usable and responsive.');
    acceptanceHints.push('Primary user flows and required routes must work on the preview.');
  }
  if (design) {
    skillHints.push('design-system', 'design-intelligence', 'motion-system');
    acceptanceHints.push('Visual hierarchy and component behavior must remain consistent with the project design system.');
  }
  if (seo) {
    skillHints.push('seo-core');
    acceptanceHints.push('Required metadata and indexable content must remain valid.');
  }
  if (accessibility) {
    skillHints.push('responsive-a11y');
    acceptanceHints.push('Keyboard, focus, contrast and semantic structure must remain usable.');
  }
  if (backend) {
    skillHints.push('backend-architecture');
    acceptanceHints.push('Changed API behavior must be covered by deterministic tests or integration checks.');
  }
  if (database) {
    skillHints.push('database-safety');
    acceptanceHints.push('Schema or data changes must preserve data safety and backwards compatibility where required.');
  }
  if (security) {
    skillHints.push('security-review');
    acceptanceHints.push('Authentication, authorization and secret boundaries must not be weakened.');
  }
  if (infrastructure) {
    skillHints.push('deployment-safety');
    acceptanceHints.push('Deployment changes must pass CI and runtime health gates before readiness.');
  }
  if (testing) skillHints.push('qa-verification');

  constraints.push(project.isExisting
    ? 'Preserve the existing project architecture and contracts unless the mission explicitly requires a safe change.'
    : 'Use the project technology policy and professional best-fit architecture.');
  constraints.push('Do not invent repository files, runtime state, test results or deployment outcomes; verify them with tools.');
  constraints.push('Do not widen mission scope during retry, repair or agent handoff.');
  constraints.push('High-impact actions remain subject to deterministic policy and human approval.');

  if (!acceptanceHints.length) {
    acceptanceHints.push('The requested behavior must be implemented and verified by repository checks.');
    acceptanceHints.push('Existing behavior outside the mission scope must remain intact.');
  }

  let mode: MissionIntentProfile['mode'] = 'general';
  if (infrastructure && !website && !backend && !database) mode = 'infrastructure';
  else if (website && (backend || database)) mode = 'fullstack';
  else if (website) mode = 'website';
  else if (backend || database) mode = 'backend';

  return {
    version: 1,
    goal: objective.trim().slice(0, 1200),
    mode,
    requiredSpecialists: unique(specialists),
    skillHints: unique(skillHints),
    acceptanceHints: unique(acceptanceHints).slice(0, 10),
    constraints: unique(constraints).slice(0, 10),
    derivedAt: nowIso(),
  };
}