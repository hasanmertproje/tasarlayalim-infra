import { nowIso, type MissionIntentProfile, type Project, type SpecialistRole } from './domain.js';
import type { ProjectKnowledgeRecord } from './project-knowledge.js';
import type { ProjectManifest } from './project-manifest.js';

export interface MissionProjectContext {
  manifest?: ProjectManifest;
  knowledge?: ProjectKnowledgeRecord[];
}

function normalize(value: string) {
  return value.toLocaleLowerCase('tr-TR');
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function redactContext(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s:@]+:[^\s@]+@/gi, 'https://[redacted]@')
    .replace(/\s+/g, ' ')
    .trim();
}

function objectiveTerms(objective: string) {
  return [...new Set(normalize(objective).split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 4))].slice(0, 32);
}

function knowledgeScore(record: ProjectKnowledgeRecord, terms: string[]) {
  const haystack = normalize(`${record.title} ${record.body} ${record.tags.join(' ')}`);
  const termScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 3 : 0), 0);
  const kindScore = record.kind === 'decision' || record.kind === 'runbook' ? 2 : 0;
  return termScore + kindScore;
}

function buildProjectContext(objective: string, context?: MissionProjectContext) {
  if (!context) return { lines: [] as string[], manifest: false, knowledgeRecords: 0, constraints: [] as string[] };
  const lines: string[] = [];
  const constraints: string[] = [];
  const manifest = context.manifest;

  if (manifest) {
    const stack = [...manifest.languages, ...manifest.frameworks].filter(Boolean);
    if (manifest.appType) lines.push(`Project app type: ${redactContext(manifest.appType)}`);
    if (manifest.architecture) lines.push(`Project architecture: ${redactContext(manifest.architecture)}`);
    if (stack.length) lines.push(`Project stack: ${stack.slice(0, 10).map(redactContext).join(', ')}`);
    if (manifest.databases.length) lines.push(`Project databases: ${manifest.databases.slice(0, 6).map(redactContext).join(', ')}`);
    if (manifest.protectedPaths.length) lines.push(`Protected paths: ${manifest.protectedPaths.slice(0, 10).map(redactContext).join(', ')}`);
    constraints.push(...manifest.constraints.slice(0, 6).map((value) => `Project manifest: ${redactContext(value).slice(0, 500)}`));
  }

  const terms = objectiveTerms(objective);
  const rankedKnowledge = [...(context.knowledge ?? [])]
    .map((record) => ({ record, score: knowledgeScore(record, terms) }))
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt));
  const relevant = rankedKnowledge.filter((item) => item.score > 0).slice(0, 6);
  if (!relevant.length) {
    relevant.push(...rankedKnowledge.filter((item) => item.record.kind === 'decision' || item.record.kind === 'runbook').slice(0, 2));
  }

  for (const { record } of relevant) {
    const body = redactContext(record.body).slice(0, 520);
    const title = redactContext(record.title).slice(0, 160);
    lines.push(`Project knowledge [${record.kind}] ${title}: ${body}`);
  }

  return {
    lines: unique(lines).slice(0, 10),
    manifest: Boolean(manifest),
    knowledgeRecords: relevant.length,
    constraints: unique(constraints).filter(Boolean),
  };
}

export function deriveMissionIntentProfile(project: Project, objective: string, context?: MissionProjectContext): MissionIntentProfile {
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

  const groundedContext = buildProjectContext(objective, context);
  constraints.push(...groundedContext.constraints);

  const technologyContext = [
    `Technology policy: stack=${project.technology.stackMode}; architecture=${project.technology.architecture}`,
    project.technology.preferred?.length ? `Preferred technology: ${project.technology.preferred.slice(0, 10).map(redactContext).join(', ')}` : '',
    project.technology.forbidden?.length ? `Forbidden technology: ${project.technology.forbidden.slice(0, 10).map(redactContext).join(', ')}` : '',
  ].filter(Boolean);
  if (project.technology.forbidden?.length) {
    constraints.push(`Do not introduce forbidden project technology: ${project.technology.forbidden.slice(0, 10).map(redactContext).join(', ')}.`);
  }

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
    constraints: unique(constraints).slice(0, 12),
    projectContext: unique([...technologyContext, ...groundedContext.lines]).slice(0, 12),
    contextSources: {
      manifest: groundedContext.manifest,
      knowledgeRecords: groundedContext.knowledgeRecords,
    },
    derivedAt: nowIso(),
  };
}
