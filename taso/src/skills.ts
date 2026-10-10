import type { SpecialistRole } from './domain.js';

export interface TasoSkill {
  id: string;
  name: string;
  specialists: SpecialistRole[];
  rules: string[];
  avoid: string[];
  acceptance: string[];
}

const skills: TasoSkill[] = [
  {
    id: 'design-system',
    name: 'Design System',
    specialists: ['frontend'],
    rules: ['Use consistent tokens for typography, spacing, surfaces, states and responsive behavior.', 'Prefer reusable primitives over page-specific styling.'],
    avoid: ['Generic card-grid repetition.', 'Uncontrolled gradients, glow or decorative motion.'],
    acceptance: ['Visual hierarchy is consistent.', 'Components use shared tokens instead of ad-hoc values.'],
  },
  {
    id: 'design-intelligence',
    name: 'Design Intelligence',
    specialists: ['frontend', 'qa'],
    rules: ['Derive visual direction from project purpose, audience and content hierarchy.', 'Keep the result original rather than cloning a reference product.'],
    avoid: ['Template-first composition.', 'AI-looking generic hero and repeated dashboard cards.'],
    acceptance: ['Layout supports the product purpose.', 'Information density and hierarchy fit the target workflow.'],
  },
  {
    id: 'frontend-patterns',
    name: 'Frontend Patterns',
    specialists: ['frontend'],
    rules: ['Preserve project framework conventions and component boundaries.', 'Keep state and rendering behavior explicit and testable.'],
    avoid: ['Unnecessary rewrites.', 'Duplicated view logic.'],
    acceptance: ['UI builds successfully.', 'Changed flows remain deterministic and maintainable.'],
  },
  {
    id: 'responsive-a11y',
    name: 'Responsive & Accessibility',
    specialists: ['frontend', 'qa'],
    rules: ['Treat desktop and mobile as first-class layouts.', 'Preserve keyboard, focus, semantic and reduced-motion behavior.'],
    avoid: ['Desktop merely scaled down for mobile.', 'Mobile layout simply stacked without prioritization.'],
    acceptance: ['Desktop and mobile are usable.', 'Focus, contrast and touch targets remain acceptable.'],
  },
  {
    id: 'motion-system',
    name: 'Motion System',
    specialists: ['frontend', 'qa'],
    rules: ['Use motion to communicate state changes and hierarchy.', 'Respect reduced-motion preferences.'],
    avoid: ['Decorative animation that obscures state.', 'Continuous expensive effects.'],
    acceptance: ['Motion has a state purpose.', 'Reduced-motion mode remains usable.'],
  },
  {
    id: 'seo-core',
    name: 'SEO Core',
    specialists: ['frontend', 'qa'],
    rules: ['Preserve indexable content, semantic structure and required metadata.', 'Use canonical structured information from the project.'],
    avoid: ['Invented business facts.', 'Metadata that disagrees with rendered content.'],
    acceptance: ['Required metadata is present.', 'Indexable content remains semantically valid.'],
  },
  {
    id: 'backend-architecture',
    name: 'Backend Architecture',
    specialists: ['backend'],
    rules: ['Preserve API contracts unless change is explicitly required.', 'Keep authoritative decisions deterministic and validated server-side.'],
    avoid: ['LLM-authoritative business state.', 'Hidden side effects.'],
    acceptance: ['Changed behavior is covered by tests or integration checks.', 'Contracts and errors are explicit.'],
  },
  {
    id: 'database-safety',
    name: 'Database Safety',
    specialists: ['database', 'backend'],
    rules: ['Protect data integrity and backwards compatibility.', 'Treat destructive schema work as high impact.'],
    avoid: ['Unreviewed destructive migration.', 'Embedding secrets in schema or seed data.'],
    acceptance: ['Schema changes are deterministic.', 'Rollback or compatibility risk is understood.'],
  },
  {
    id: 'security-review',
    name: 'Security Review',
    specialists: ['security', 'backend'],
    rules: ['Keep authentication, authorization and secret boundaries explicit.', 'Fail closed on uncertain high-impact actions.'],
    avoid: ['Client-side trust for authoritative permissions.', 'Logging credentials or tokens.'],
    acceptance: ['No security boundary is weakened.', 'Sensitive operations remain policy-controlled.'],
  },
  {
    id: 'deployment-safety',
    name: 'Deployment Safety',
    specialists: ['devops', 'qa'],
    rules: ['Use CI, runtime health and preview verification before readiness.', 'Keep production stricter than preview.'],
    avoid: ['Silent production self-heal.', 'Deploying unverified commits.'],
    acceptance: ['Published commit is verified.', 'Runtime health gates pass before readiness.'],
  },
  {
    id: 'qa-verification',
    name: 'QA Verification',
    specialists: ['qa'],
    rules: ['Verify observable behavior instead of trusting model claims.', 'Prefer deterministic evidence from tests, CI, runtime and tools.'],
    avoid: ['Marking work complete from prose alone.', 'Weakening tests merely to obtain green CI.'],
    acceptance: ['Required checks are evidenced.', 'Failures remain visible and fail closed where appropriate.'],
  },
];

const registry = new Map(skills.map((skill) => [skill.id, skill]));

export function getSkill(id: string): TasoSkill | undefined {
  return registry.get(id);
}

export function resolveSkills(ids: string[]): TasoSkill[] {
  return [...new Set(ids)].flatMap((id) => {
    const skill = registry.get(id);
    return skill ? [skill] : [];
  });
}

export function renderSkillGuidance(ids: string[]): string[] {
  return resolveSkills(ids).map((skill) => [
    `${skill.name}:`,
    ...skill.rules.map((rule) => `rule=${rule}`),
    ...skill.avoid.map((item) => `avoid=${item}`),
    ...skill.acceptance.map((item) => `accept=${item}`),
  ].join(' '));
}

export function listSkills(): TasoSkill[] {
  return skills.map((skill) => ({ ...skill, specialists: [...skill.specialists], rules: [...skill.rules], avoid: [...skill.avoid], acceptance: [...skill.acceptance] }));
}