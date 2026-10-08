import { createId, nowIso } from './domain.js';

export type ProjectKnowledgeKind = 'decision' | 'runbook' | 'note' | 'fact';
export type ProjectKnowledgeSource = 'manual' | 'mission' | 'system';

export interface ProjectKnowledgeRecord {
  id: string;
  projectId: string;
  kind: ProjectKnowledgeKind;
  title: string;
  body: string;
  tags: string[];
  source: ProjectKnowledgeSource;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectKnowledgeInput {
  kind: ProjectKnowledgeKind;
  title: string;
  body: string;
  tags?: string[];
  source?: ProjectKnowledgeSource;
  sourceRef?: string;
}

export interface UpdateProjectKnowledgeInput {
  kind?: ProjectKnowledgeKind;
  title?: string;
  body?: string;
  tags?: string[];
}

function isKind(value: unknown): value is ProjectKnowledgeKind {
  return value === 'decision' || value === 'runbook' || value === 'note' || value === 'fact';
}

function isSource(value: unknown): value is ProjectKnowledgeSource {
  return value === 'manual' || value === 'mission' || value === 'system';
}

function cleanRequired(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const cleaned = value.trim();
  if (cleaned.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters.`);
  return cleaned;
}

function normalizeTags(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('Knowledge tags must be an array.');
  const normalized = [...new Set(input.map((tag) => {
    if (typeof tag !== 'string') throw new Error('Knowledge tags must contain strings only.');
    const cleaned = tag.trim().toLowerCase();
    if (!cleaned) return '';
    if (cleaned.length > 48) throw new Error('Knowledge tags must be at most 48 characters each.');
    return cleaned;
  }).filter(Boolean))];
  if (normalized.length > 12) throw new Error('Knowledge records support at most 12 tags.');
  return normalized;
}

export class ProjectKnowledgeStore {
  private readonly records = new Map<string, ProjectKnowledgeRecord>();

  constructor(
    initialRecords: ProjectKnowledgeRecord[] = [],
    private readonly projectExists: (projectId: string) => boolean = () => true,
    private readonly onChange: () => void = () => {},
  ) {
    for (const record of initialRecords) this.records.set(record.id, structuredClone(record));
  }

  list(projectId: string): ProjectKnowledgeRecord[] {
    if (!this.projectExists(projectId)) throw new Error('Project not found.');
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => structuredClone(record));
  }

  all(): ProjectKnowledgeRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => structuredClone(record));
  }

  create(projectId: string, input: CreateProjectKnowledgeInput): ProjectKnowledgeRecord {
    if (!this.projectExists(projectId)) throw new Error('Project not found.');
    if (!isKind(input?.kind)) throw new Error('Knowledge kind must be decision, runbook, note or fact.');
    const source = input.source ?? 'manual';
    if (!isSource(source)) throw new Error('Knowledge source must be manual, mission or system.');
    const timestamp = nowIso();
    const record: ProjectKnowledgeRecord = {
      id: createId('knowledge'),
      projectId,
      kind: input.kind,
      title: cleanRequired(input.title, 'Knowledge title', 160),
      body: cleanRequired(input.body, 'Knowledge body', 20_000),
      tags: normalizeTags(input.tags),
      source,
      sourceRef: typeof input.sourceRef === 'string' && input.sourceRef.trim() ? input.sourceRef.trim().slice(0, 240) : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.set(record.id, record);
    this.onChange();
    return structuredClone(record);
  }

  update(projectId: string, recordId: string, input: UpdateProjectKnowledgeInput): ProjectKnowledgeRecord {
    if (!this.projectExists(projectId)) throw new Error('Project not found.');
    const record = this.records.get(recordId);
    if (!record || record.projectId !== projectId) throw new Error('Knowledge record not found.');
    if (input.kind !== undefined) {
      if (!isKind(input.kind)) throw new Error('Knowledge kind must be decision, runbook, note or fact.');
      record.kind = input.kind;
    }
    if (input.title !== undefined) record.title = cleanRequired(input.title, 'Knowledge title', 160);
    if (input.body !== undefined) record.body = cleanRequired(input.body, 'Knowledge body', 20_000);
    if (input.tags !== undefined) record.tags = normalizeTags(input.tags);
    record.updatedAt = nowIso();
    this.records.set(record.id, record);
    this.onChange();
    return structuredClone(record);
  }
}
