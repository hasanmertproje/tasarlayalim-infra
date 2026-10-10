import type { Project } from './domain.js';

interface CoolifyConfig {
  baseUrl: string;
  token: string;
  resourceMap: Record<string, string>;
}

export interface PreviewRuntimeProbe {
  healthy: boolean;
  url: string;
  status?: number;
  latencyMs: number;
  summary: string;
  bodyPreview?: string;
}

export interface CoolifyDeploymentResult {
  deploymentUuid: string;
  status: string;
  url?: string;
  runtimeProbe?: PreviewRuntimeProbe;
  runtimeRedeploys?: number;
}

function boundedEnvInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 800);
}

function looksLikeRuntimeFailure(body: string) {
  const sample = body.toLowerCase();
  return [
    'internal server error',
    'application error',
    'fatal error',
    'uncaught exception',
    '502 bad gateway',
    '503 service unavailable',
    '504 gateway timeout',
  ].some((needle) => sample.includes(needle));
}

export class CoolifyTools {
  private readonly previewProbeTimeoutMs = boundedEnvInt('TASO_PREVIEW_PROBE_TIMEOUT_MS', 12_000, 2_000, 30_000);
  private readonly previewProbeAttempts = boundedEnvInt('TASO_PREVIEW_PROBE_ATTEMPTS', 5, 1, 10);
  private readonly previewRedeployAttempts = boundedEnvInt('TASO_PREVIEW_REDEPLOY_ATTEMPTS', 1, 0, 2);

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
    return {
      configured: true,
      projects: Object.keys(this.config.resourceMap),
      previewProbeTimeoutMs: this.previewProbeTimeoutMs,
      previewProbeAttempts: this.previewProbeAttempts,
      previewRedeployAttempts: this.previewRedeployAttempts,
    };
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

  private async startDeployment(project: Project, pullRequestId?: number): Promise<string> {
    const uuid = this.config.resourceMap[project.slug];
    if (!uuid) throw new Error(`Coolify resource is not configured for ${project.slug}.`);
    const response = await this.request<{ deployments?: Array<{ deployment_uuid?: string }> }>('/deploy', {
      method: 'POST',
      body: JSON.stringify({ uuid, force: false, ...(pullRequestId ? { pr: pullRequestId } : {}) }),
    });
    const deploymentUuid = response.deployments?.[0]?.deployment_uuid;
    if (!deploymentUuid) throw new Error('Coolify did not return a deployment UUID.');
    return deploymentUuid;
  }

  async probeRuntime(url: string): Promise<PreviewRuntimeProbe> {
    let last: PreviewRuntimeProbe | undefined;
    for (let attempt = 1; attempt <= this.previewProbeAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
            'user-agent': 'Taso-Preview-Verifier/1.0',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(this.previewProbeTimeoutMs),
        });
        const body = compactText(await response.text());
        const healthyStatus = response.status >= 200 && response.status < 400;
        const runtimeFailureBody = looksLikeRuntimeFailure(body);
        const healthy = healthyStatus && !runtimeFailureBody;
        last = {
          healthy,
          url: response.url || url,
          status: response.status,
          latencyMs: Date.now() - startedAt,
          summary: healthy
            ? `Preview responded with HTTP ${response.status}.`
            : runtimeFailureBody
              ? `Preview returned HTTP ${response.status}, but the response body contains a runtime failure signature.`
              : `Preview returned unhealthy HTTP ${response.status}.`,
          bodyPreview: healthy ? undefined : body,
        };
        if (healthy) return last;
      } catch (error) {
        last = {
          healthy: false,
          url,
          latencyMs: Date.now() - startedAt,
          summary: `Preview probe failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 800),
        };
      }
      if (attempt < this.previewProbeAttempts) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return last ?? { healthy: false, url, latencyMs: 0, summary: 'Preview probe produced no result.' };
  }

  async deploy(project: Project, pullRequestId?: number): Promise<CoolifyDeploymentResult> {
    let runtimeRedeploys = 0;
    while (true) {
      const deploymentUuid = await this.startDeployment(project, pullRequestId);
      const deployment = await this.waitForDeployment(deploymentUuid);
      if (!pullRequestId) return deployment;
      if (!deployment.url) throw new Error(`Coolify preview deployment ${deploymentUuid} completed without a preview URL.`);

      const runtimeProbe = await this.probeRuntime(deployment.url);
      if (runtimeProbe.healthy) return { ...deployment, runtimeProbe, runtimeRedeploys };
      if (runtimeRedeploys >= this.previewRedeployAttempts) {
        throw new Error(`Preview runtime verification failed after ${runtimeRedeploys + 1} deployment attempt(s): ${runtimeProbe.summary}`);
      }
      runtimeRedeploys += 1;
    }
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
