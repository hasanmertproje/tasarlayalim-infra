import type { Mission, Project } from './domain.js';
import type { ProjectRegistry } from './project-registry.js';
import type { TaskEngine } from './task-engine.js';
import { OpenAiCompatiblePlanner } from './agent-planner.js';
import { GitHubTools } from './github-tools.js';
import { CoolifyTools } from './coolify-tools.js';

function assertRepository(repository: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Project repository must be an exact GitHub owner/repo slug before execution.');
  }
}

function safeBranch(project: Project, mission: Mission) {
  const suffix = mission.id.replace(/^mission_/, '').slice(0, 8).toLowerCase();
  return `taso/${project.slug.replace(/[^a-z0-9-]/g, '-')}/${suffix}`.slice(0, 120);
}

function assertSafeChanges(mission: Mission, paths: string[], protectedPaths: string[] = []) {
  for (const path of paths) {
    const normalized = path.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('../')) throw new Error(`Unsafe generated path: ${path}`);
    if (/(^|\/)(\.env(?:\.|$)|id_rsa|id_ed25519|secrets?\.|credentials?\.)/i.test(normalized)) {
      throw new Error(`Taso refuses to write credential or secret path: ${path}`);
    }
    if (protectedPaths.some((protectedPath) => normalized === protectedPath || normalized.startsWith(`${protectedPath.replace(/\/$/, '')}/`))) {
      throw new Error(`Protected project path cannot be changed: ${path}`);
    }
    if (mission.riskLevel !== 'HIGH_IMPACT' && /(^|\/)(\.github\/workflows|migrations?|infra)(\/|$)|(^|\/)(docker-compose[^/]*\.ya?ml|Dockerfile)$/i.test(normalized)) {
      throw new Error(`Infrastructure path requires HIGH_IMPACT approval: ${path}`);
    }
  }
}

function isProductionDeploy(mission: Mission) {
  return mission.riskLevel === 'HIGH_IMPACT' && /\b(prod(?:uction)?|canlı|yayın|deploy)\b/i.test(mission.objective);
}

export class MissionExecutor {
  private readonly active = new Set<string>();

  constructor(
    private readonly tasks: TaskEngine,
    private readonly projects: ProjectRegistry,
    private readonly planner = OpenAiCompatiblePlanner.fromEnv(),
    private readonly github = GitHubTools.fromEnv(),
    private readonly coolify = CoolifyTools.fromEnv(),
  ) {}

  readiness() {
    return {
      readyForRead: Boolean(this.planner && this.github),
      readyForWrite: Boolean(this.planner && this.github),
      readyForDeploy: Boolean(this.coolify),
      ai: this.planner?.readiness() ?? { configured: false },
      github: this.github?.readiness() ?? { configured: false },
      coolify: this.coolify?.readiness() ?? { configured: false },
      activeMissionIds: [...this.active],
    };
  }

  executeSoon(id: string) {
    queueMicrotask(() => {
      void this.execute(id).catch((error) => {
        const mission = this.tasks.getMission(id);
        if (!mission || mission.status === 'cancelled') return;
        try {
          this.tasks.transitionMission(id, 'failed', `Execution failed: ${(error as Error).message}`, undefined, { blockedReason: (error as Error).message });
        } catch {
          // Mission may have been cancelled while the executor was working.
        }
      });
    });
  }

  async execute(id: string): Promise<Mission> {
    if (this.active.has(id)) return this.tasks.getMission(id) ?? Promise.reject(new Error('Mission not found.'));
    const mission = this.tasks.getMission(id);
    if (!mission) throw new Error('Mission not found.');
    if (mission.status !== 'queued') return mission;
    if (!mission.autonomous.enabled) {
      this.tasks.noteMission(id, 'Autonomous execution is disabled for this mission.');
      return mission;
    }
    if (mission.approvalRequired && !mission.approvedAt) throw new Error('High-impact mission is not approved.');

    this.active.add(id);
    try {
      const project = this.projects.get(mission.projectId);
      if (!project) throw new Error('Project not found.');
      if (isProductionDeploy(mission)) return await this.executeProductionDeploy(project, mission);
      return await this.executeRepositoryMission(project, mission);
    } finally {
      this.active.delete(id);
    }
  }

  private async executeRepositoryMission(project: Project, mission: Mission): Promise<Mission> {
    if (!this.planner) throw new Error('AI planner is not configured.');
    if (!this.github) throw new Error('GitHub tool broker is not configured.');
    assertRepository(project.repository);
    this.planner.assertDataClass(mission.dataClass);

    this.tasks.transitionMission(mission.id, 'planning', 'Taso is inspecting the repository and selecting relevant files.');
    const paths = await this.github.listFiles(project.repository, project.defaultBranch);
    if (!paths.length) throw new Error('Repository has no readable source files.');
    const selected = await this.planner.chooseFiles(project, mission, paths);
    const fallback = ['README.md', 'package.json', 'composer.json'].filter((path) => paths.includes(path));
    const selectedPaths = selected.length ? selected : fallback;
    const files = await this.github.readFiles(project.repository, project.defaultBranch, selectedPaths);

    if (mission.riskLevel === 'READ') {
      const summary = await this.planner.analyze(project, mission, files);
      return this.tasks.transitionMission(mission.id, 'completed', 'Read-only analysis completed.', undefined, { summary, checkState: 'success' });
    }

    const plan = await this.planner.planChanges(project, mission, files);
    if (!plan.files.length) throw new Error('AI planner produced no file changes.');
    const manifest = this.projects.getManifest(project.id);
    assertSafeChanges(mission, plan.files.map((file) => file.path), manifest?.protectedPaths ?? []);

    const branch = safeBranch(project, mission);
    this.tasks.transitionMission(mission.id, 'running', 'Taso is creating a scoped branch and applying the planned changes.', { files: plan.files.map((file) => file.path) }, { summary: plan.summary, branch });
    const result = await this.github.createPullRequestWithChanges({
      repository: project.repository,
      base: project.defaultBranch,
      branch,
      changes: plan.files,
      commitMessage: plan.commitMessage,
      title: `Taso: ${mission.objective}`.slice(0, 120),
      body: [
        '## Taso mission',
        '',
        plan.summary,
        '',
        `Mission: \`${mission.id}\``,
        `Risk: \`${mission.riskLevel}\``,
        '',
        'This pull request was created by Taso. CI and preview gates must pass before merge.',
      ].join('\n'),
    });

    this.tasks.transitionMission(mission.id, 'testing', 'Pull request created. Taso is waiting for CI checks.', { pullRequest: result.url }, {
      branch: result.branch,
      commitSha: result.commitSha,
      pullRequestNumber: result.number,
      pullRequestUrl: result.url,
    });

    const checkState = await this.github.waitForChecks(project.repository, result.commitSha);
    if (checkState !== 'success') {
      const reason = checkState === 'failed' ? 'CI checks failed.' : checkState === 'missing' ? 'No CI checks were detected for the generated commit.' : 'CI checks did not complete before timeout.';
      return this.tasks.transitionMission(mission.id, 'failed', reason, { checkState }, { checkState, blockedReason: reason });
    }

    if (mission.autonomous.previewRequired) {
      if (!this.coolify || !this.coolify.hasProject(project)) {
        const reason = 'CI passed, but a Coolify resource is not configured for this project, so preview could not be verified.';
        return this.tasks.transitionMission(mission.id, 'failed', reason, { checkState }, { checkState, blockedReason: reason });
      }
      this.tasks.noteMission(mission.id, 'CI passed. Creating isolated Coolify preview.', { pullRequestNumber: result.number });
      const preview = await this.coolify.deploy(project, result.number);
      return this.tasks.transitionMission(mission.id, 'preview_ready', 'CI passed and Coolify preview deployment completed.', { deploymentUuid: preview.deploymentUuid }, {
        checkState,
        previewDeploymentUuid: preview.deploymentUuid,
        previewUrl: preview.url,
      });
    }

    return this.tasks.transitionMission(mission.id, 'completed', 'CI passed. Mission completed without a preview requirement.', undefined, { checkState });
  }

  private async executeProductionDeploy(project: Project, mission: Mission): Promise<Mission> {
    if (!this.coolify || !this.coolify.hasProject(project)) throw new Error('Coolify production deployment is not configured for this project.');
    if (!mission.approvedAt) throw new Error('Production deployment requires explicit human approval.');
    this.tasks.transitionMission(mission.id, 'running', 'Approved production deployment is being sent to Coolify.');
    const deployment = await this.coolify.deploy(project);
    return this.tasks.transitionMission(mission.id, 'completed', 'Production deployment completed and was verified through Coolify.', { deploymentUuid: deployment.deploymentUuid }, {
      productionDeploymentUuid: deployment.deploymentUuid,
      productionUrl: deployment.url,
    });
  }
}
