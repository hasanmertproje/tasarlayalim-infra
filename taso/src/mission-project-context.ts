import { deriveMissionIntentProfile } from './mission-intelligence.js';
import type { ProjectKnowledgeStore } from './project-knowledge.js';
import type { ProjectRegistry } from './project-registry.js';
import type { RuntimeSelfHealingExecutor } from './runtime-self-healing-executor.js';
import type { TaskEngine } from './task-engine.js';

export function bindMissionProjectContext(
  executor: RuntimeSelfHealingExecutor,
  tasks: TaskEngine,
  projects: ProjectRegistry,
  knowledge: ProjectKnowledgeStore,
) {
  const originalExecute = executor.execute.bind(executor);

  executor.execute = async (missionId: string) => {
    const mission = tasks.getMission(missionId);
    if (mission) {
      const project = projects.get(mission.projectId);
      if (project) {
        const profile = deriveMissionIntentProfile(project, mission.objective, {
          manifest: projects.getManifest(project.id),
          knowledge: knowledge.list(project.id),
        });
        mission.execution = {
          ...(mission.execution ?? {}),
          intentProfile: profile,
        };
        tasks.noteMission(mission.id, 'Grounded project context attached before autonomous execution.', {
          contextSources: profile.contextSources,
          projectContextItems: profile.projectContext?.length ?? 0,
          requiredSpecialists: profile.requiredSpecialists,
          skillHints: profile.skillHints,
        });
      }
    }

    return originalExecute(missionId);
  };

  return executor;
}
