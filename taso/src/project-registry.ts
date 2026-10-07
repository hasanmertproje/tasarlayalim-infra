import { createId, nowIso, type Project, type TechnologyPolicy } from './domain.js';
import {
  createManifest,
  type ProjectManifest,
  type UpsertProjectManifestInput,
} from './project-manifest.js';

export interface CreateProjectInput {
  slug: string;
  name: string;
  repository: string;
  isExisting: boolean;
  defaultBranch?: string;
  technology?: Partial<TechnologyPolicy>;
}

function defaultTechnologyPolicy(isExisting: boolean): TechnologyPolicy {
  return {
    stackMode: isExisting ? 'preserve' : 'auto',
    architecture: isExisting ? 'preserve_existing' : 'professional_best_fit',
  };
}

export class ProjectRegistry {
  private readonly projects = new Map<string, Project>();
  private readonly manifests = new Map<string, ProjectManifest>();

  constructor(
    initialProjects: Project[] = [],
    initialManifests: ProjectManifest[] = [],
    private readonly onChange: () => void = () => {},
  ) {
    for (const project of initialProjects) this.projects.set(project.id, structuredClone(project));
    for (const manifest of initialManifests) this.manifests.set(manifest.projectId, structuredClone(manifest));
  }

  create(input: CreateProjectInput): Project {
    const slug = input.slug.trim().toLowerCase();
    if (!slug) throw new Error('Project slug is required.');
    if ([...this.projects.values()].some((project) => project.slug === slug)) {
      throw new Error(`Project slug already exists: ${slug}`);
    }

    const defaults = defaultTechnologyPolicy(input.isExisting);
    const project: Project = {
      id: createId('project'),
      slug,
      name: input.name.trim(),
      repository: input.repository.trim(),
      isExisting: input.isExisting,
      defaultBranch: input.defaultBranch?.trim() || 'main',
      technology: { ...defaults, ...input.technology },
      createdAt: nowIso(),
    };

    this.projects.set(project.id, project);
    this.onChange();
    return project;
  }

  list(): Project[] { return [...this.projects.values()]; }
  get(id: string): Project | undefined { return this.projects.get(id); }
  findBySlug(slug: string): Project | undefined { return [...this.projects.values()].find((project) => project.slug === slug); }

  upsertManifest(projectId: string, input: UpsertProjectManifestInput): ProjectManifest {
    if (!this.projects.has(projectId)) throw new Error('Project not found.');
    const manifest = createManifest(projectId, input, this.manifests.get(projectId));
    this.manifests.set(projectId, manifest);
    this.onChange();
    return manifest;
  }

  getManifest(projectId: string): ProjectManifest | undefined { return this.manifests.get(projectId); }
  listManifests(): ProjectManifest[] { return [...this.manifests.values()]; }
}
