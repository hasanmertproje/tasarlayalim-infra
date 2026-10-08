import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConversationMessage } from './conversation.js';
import type { Mission, Project } from './domain.js';
import type { MissionEvent } from './mission-events.js';
import type { ProjectKnowledgeRecord } from './project-knowledge.js';
import type { ProjectManifest } from './project-manifest.js';
import type { ProjectMilestone } from './project-milestones.js';

export interface TasoStateSnapshot {
  projects: Project[];
  manifests: ProjectManifest[];
  milestones: ProjectMilestone[];
  knowledge: ProjectKnowledgeRecord[];
  missions: Mission[];
  events: MissionEvent[];
  conversations: ConversationMessage[];
}

const emptyState: TasoStateSnapshot = {
  projects: [],
  manifests: [],
  milestones: [],
  knowledge: [],
  missions: [],
  events: [],
  conversations: [],
};

export class JsonStateStore {
  constructor(private readonly filePath?: string) {}

  enabled() {
    return Boolean(this.filePath);
  }

  load(): TasoStateSnapshot {
    if (!this.filePath) return structuredClone(emptyState);
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<TasoStateSnapshot>;
      return {
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        manifests: Array.isArray(parsed.manifests) ? parsed.manifests : [],
        milestones: Array.isArray(parsed.milestones) ? parsed.milestones : [],
        knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge : [],
        missions: Array.isArray(parsed.missions) ? parsed.missions : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return structuredClone(emptyState);
      throw new Error(`Taso state could not be loaded: ${(error as Error).message}`);
    }
  }

  save(snapshot: TasoStateSnapshot) {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.filePath);
  }
}
