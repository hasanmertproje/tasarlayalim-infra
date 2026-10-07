import type { CreateProjectInput } from './project-registry.js';

/**
 * Initial workspace catalog for the private Tasarlayalım Taso instance.
 * These are real isolated workspaces, not UI-only demo cards.
 * Repository values are logical identifiers for now and can be replaced
 * with exact GitHub repo slugs from the Projects screen in a later milestone.
 */
export const bootstrapProjects: CreateProjectInput[] = [
  {
    slug: 'reksa-reklam',
    name: 'Reksa Reklam',
    repository: 'reksareklam',
    isExisting: true,
  },
  {
    slug: 'maria-cicek',
    name: 'Maria Çiçek',
    repository: 'mariacicek',
    isExisting: true,
  },
  {
    slug: 'growth-os',
    name: 'Growth OS',
    repository: 'growth-os',
    isExisting: true,
  },
  {
    slug: 'yoncali-dogan-apart',
    name: 'Yoncalı Doğan Apart',
    repository: 'dogan-apart',
    isExisting: true,
  },
];
