import type { CreateProjectInput } from './project-registry.js';

/**
 * Initial workspace catalog for the private Tasarlayalım Taso instance.
 * Existing customer workspaces keep their logical identifiers until their
 * exact owner/repo slug is connected. The infra workspace is intentionally
 * exact so READ missions can verify the autonomous executor safely.
 */
export const bootstrapProjects: CreateProjectInput[] = [
  {
    slug: 'tasarlayalim-infra',
    name: 'Tasarlayalım Infra',
    repository: 'hasanmertproje/tasarlayalim-infra',
    defaultBranch: 'main',
    isExisting: true,
  },
  {
    slug: 'taso-self-improvement',
    name: 'Taso Self-Improvement',
    repository: 'hasanmertproje/tasarlayalim-infra',
    defaultBranch: 'main',
    isExisting: true,
  },
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
