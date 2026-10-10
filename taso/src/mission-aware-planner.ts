import type { ChangePlan, RepositoryFile } from './agent-planner.js';
import type { Mission, MissionStep, Project } from './domain.js';
import { MultiProviderPlanner, type OrchestrationPlan } from './multi-provider-planner.js';
import { renderSkillGuidance } from './skills.js';

function boundedLines(values: string[] | undefined, limit: number) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean).slice(0, limit);
}

function intelligenceContext(mission: Mission) {
  const profile = mission.execution?.intentProfile;
  if (!profile) return '';
  const skillGuidance = renderSkillGuidance(profile.skillHints).slice(0, 8);
  return [
    `Mission goal: ${profile.goal}`,
    `Mission mode: ${profile.mode}`,
    profile.requiredSpecialists.length ? `Expected specialist capabilities: ${profile.requiredSpecialists.join(', ')}` : '',
    ...boundedLines(profile.constraints, 8).map((value) => `Constraint: ${value}`),
    ...boundedLines(profile.acceptanceHints, 8).map((value) => `Acceptance hint: ${value}`),
    ...skillGuidance.map((value) => `Skill guidance: ${value}`),
  ].filter(Boolean).join('\n');
}

function missionForPlanning(mission: Mission): Mission {
  const context = intelligenceContext(mission);
  if (!context) return mission;
  return {
    ...mission,
    objective: [mission.objective, '', 'Taso durable mission intelligence:', context].join('\n'),
  };
}

export class MissionAwarePlanner extends MultiProviderPlanner {
  static fromEnv(providerIds: string[]) {
    const planner = new MissionAwarePlanner(providerIds);
    return planner.readiness().configured ? planner : undefined;
  }

  override async decomposeMission(
    project: Project,
    mission: Mission,
    files: RepositoryFile[],
    signal?: AbortSignal,
  ): Promise<OrchestrationPlan> {
    const result = await super.decomposeMission(project, missionForPlanning(mission), files, signal);
    const profile = mission.execution?.intentProfile;
    if (!profile) return result;

    const plannedSpecialists = new Set(result.steps.map((step) => step.specialist));
    const expected = profile.requiredSpecialists.filter((specialist) => !plannedSpecialists.has(specialist));
    const summarySuffix = expected.length
      ? ` Mission profile also expects ${expected.join(', ')} capability; deterministic verification must cover any capability not represented by a dedicated implementation step.`
      : ' Mission profile specialist coverage is represented by the work graph.';
    return {
      ...result,
      summary: `${result.summary}${summarySuffix}`.slice(0, 1600),
    };
  }

  override async planStepChanges(
    project: Project,
    mission: Mission,
    files: RepositoryFile[],
    step: MissionStep,
    handoffContext: string[],
    signal?: AbortSignal,
  ): Promise<ChangePlan> {
    const context = intelligenceContext(mission);
    const enrichedStep: MissionStep = context
      ? {
          ...step,
          objective: [
            step.objective,
            '',
            'Durable mission alignment (must remain in scope during implementation and retry):',
            context,
          ].join('\n').slice(0, 7000),
        }
      : step;
    return super.planStepChanges(project, mission, files, enrichedStep, handoffContext, signal);
  }
}