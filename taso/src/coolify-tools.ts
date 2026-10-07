import type { Project } from './domain.js';

interface CoolifyConfig {
  baseUrl: string;
  token: string;
  resourceMap: Record<string, string>;
}

export interface CoolifyDeploymentResult {
  deploymentUuid: string;
  status: string;
  url?: string;
}

export class CoolifyTools {
  constructor(private readonly config: CoolifyConfig) {}

  static fromEnv(): CoolifyTools | undefined {
    const rawBase = process.env.TASO_COOLIFY_BASE_URL?.trim();
    const token = process.env.TASO_COOLIFY_TOKEN?.trim();
    const rawMap = process.env.TASO_COOLIFY_RESOURCES_JSON?.trim();
    if (!rawBase || !token || !rawMap) return undefined;
    let resourceMap: Record<string, string>;
    try {
      resourceMap = JSON.parse(rawMap) as Record<string, string>;
    } catch {
      throw new Error('TASO_COOLIFY_RESOURCES_JSON must be valid JSON.');
    }
    const root = rawBase.replace(/\/$/, '');
    return new CoolifyTools({
      baseUrl: root.endsWith('/api/v1') ? root : `${root}/api/v1`,
      token,
      resourceMap,
    });
  }

  readiness() {
    return { configured: true, projects: Object.keys(this.config.resourceMap) };
  }

  hasProject(project: Project) {
    return Boolean(this.config.resourceMap[project.slug]);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Coolify ${response.status}: ${(await response.text()).slice(0, 700)}`);
    return response.json() as Promise<T>;
  }

  async deploy(project: Project, pullRequestId?: number): Promise<CoolifyDeploymentResult> {
    const uuid = this.config.resourceMap[project.slug];
    if (!uuid) throw new Error(`Coolify resource is not configured for ${project.slug}.`);
    const response = await this.request<{ deployments?: Array<{ deployment_uuid?: string }> }>('/deploy', {
      method: 'POST',
      body: JSON.stringify({ uuid, force: false, ...(pullRequestId ? { pr: pullRequestId } : {}) }),
    });
    const deploymentUuid = response.deployments?.[0]?.deployment_uuid;
    if (!deploymentUuid) throw new Error('Coolify did not return a deployment UUID.');
    return this.waitForDeployment(deploymentUuid);
  }

  async waitForDeployment(deploymentUuid: string): Promise<CoolifyDeploymentResult> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const deployment = await this.request<{ status?: string; deployment_url?: string }>(`/deployments/${encodeURIComponent(deploymentUuid)}`);
      const status = deployment.status ?? 'unknown';
      if (/success|finished|completed/i.test(status)) return { deploymentUuid, status, url: deployment.deployment_url };
      if (/fail|error|cancel/i.test(status)) throw new Error(`Coolify deployment failed with status ${status}.`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    throw new Error('Coolify deployment verification timed out.');
  }
}
