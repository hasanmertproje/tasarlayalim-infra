import type { DataClass, Mission, Project } from './domain.js';
import type { ChangePlan, RepositoryFile } from './agent-planner.js';

interface RuntimeProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  allowPrivateCode: boolean;
  allowSensitive: boolean;
}

type ProviderStatus = {
  id: string;
  configured: boolean;
  model?: string;
  privateCode?: boolean;
  sensitive?: boolean;
};

function envPrefix(id: string) {
  return `TASO_PROVIDER_${id.toUpperCase().replace(/-/g, '_')}`;
}

function runtimeProvider(id: string): RuntimeProvider | undefined {
  const prefix = envPrefix(id);
  const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim();
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  const data = new Set((process.env[`${prefix}_DATA`] ?? 'public').split(',').map((value) => value.trim()));
  return {
    id,
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    model,
    allowPrivateCode: data.has('private_code') || data.has('sensitive'),
    allowSensitive: data.has('sensitive'),
  };
}

function legacyProvider(): RuntimeProvider | undefined {
  const baseUrl = process.env.TASO_AI_BASE_URL?.trim();
  const apiKey = process.env.TASO_AI_API_KEY?.trim();
  const model = process.env.TASO_AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return {
    id: 'legacy',
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    model,
    allowPrivateCode: process.env.TASO_AI_ALLOW_PRIVATE_CODE === 'true',
    allowSensitive: process.env.TASO_AI_ALLOW_SENSITIVE === 'true',
  };
}

function assertDataClass(provider: RuntimeProvider, dataClass: DataClass) {
  if (dataClass === 'private_code' && !provider.allowPrivateCode) throw new Error(`${provider.id} is not approved for private code.`);
  if (dataClass === 'sensitive' && !provider.allowSensitive) throw new Error(`${provider.id} is not approved for sensitive data.`);
}

function parseJson<T>(value: string): T {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

/**
 * Executes a mission against its cost-aware providerChain. Each operation starts
 * at the highest-ranked eligible provider and falls back on transport/API/model
 * failure. Secrets remain server-side and are never exposed in readiness data.
 */
export class MultiProviderPlanner {
  private readonly configured = new Map<string, RuntimeProvider>();
  private readonly legacy = legacyProvider();

  constructor(providerIds: string[]) {
    for (const id of providerIds) {
      const provider = runtimeProvider(id);
      if (provider) this.configured.set(id, provider);
    }
  }

  static fromEnv(providerIds: string[]) {
    const planner = new MultiProviderPlanner(providerIds);
    return planner.configured.size || planner.legacy ? planner : undefined;
  }

  readiness(): { configured: boolean; providers: ProviderStatus[]; legacy: boolean } {
    return {
      configured: this.configured.size > 0 || Boolean(this.legacy),
      providers: [...this.configured.values()].map((provider) => ({
        id: provider.id,
        configured: true,
        model: provider.model,
        privateCode: provider.allowPrivateCode,
        sensitive: provider.allowSensitive,
      })),
      legacy: Boolean(this.legacy),
    };
  }

  private candidates(mission: Mission): RuntimeProvider[] {
    const candidates = mission.providerChain
      .map((id) => this.configured.get(id))
      .filter((provider): provider is RuntimeProvider => Boolean(provider));
    if (!candidates.length && this.legacy) candidates.push(this.legacy);
    return candidates;
  }

  private async complete(mission: Mission, system: string, user: string): Promise<string> {
    const candidates = this.candidates(mission);
    if (!candidates.length) throw new Error(`No configured runtime AI provider matches mission chain: ${mission.providerChain.join(', ') || 'empty'}.`);
    const failures: string[] = [];
    for (const provider of candidates) {
      try {
        assertDataClass(provider, mission.dataClass);
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: provider.model,
            temperature: 0.15,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error('empty response');
        return content;
      } catch (error) {
        failures.push(`${provider.id}: ${(error as Error).message}`);
      }
    }
    throw new Error(`All eligible AI providers failed: ${failures.join(' | ')}`);
  }

  async chooseFiles(project: Project, mission: Mission, availablePaths: string[]): Promise<string[]> {
    const result = parseJson<{ files?: string[] }>(await this.complete(
      mission,
      'You are Taso file selector. Return only JSON: {"files":["path"]}. Select at most 12 existing files needed to understand the task. Never invent paths.',
      JSON.stringify({ project: { name: project.name, repository: project.repository, technology: project.technology }, objective: mission.objective, paths: availablePaths.slice(0, 2500) }),
    ));
    const allowed = new Set(availablePaths);
    return [...new Set((result.files ?? []).filter((path) => allowed.has(path)))].slice(0, 12);
  }

  async analyze(project: Project, mission: Mission, files: RepositoryFile[]): Promise<string> {
    return (await this.complete(
      mission,
      'You are Taso, a senior software engineer. Analyze the requested task without changing code. Be concise, concrete, and mention risks/tests. Plain text only.',
      JSON.stringify({ project: { name: project.name, technology: project.technology }, objective: mission.objective, files }),
    )).trim();
  }

  async planChanges(project: Project, mission: Mission, files: RepositoryFile[]): Promise<ChangePlan> {
    const result = parseJson<ChangePlan>(await this.complete(
      mission,
      'You are Taso coding agent. Return only JSON {"summary":"...","commitMessage":"...","files":[{"path":"...","content":"..."}]}. Produce complete replacement file contents, not patches. Preserve existing architecture. Never emit secrets, .env files, credentials, generated/vendor files, lockfile rewrites or destructive database operations. Keep changes minimal and production quality.',
      JSON.stringify({ project: { name: project.name, repository: project.repository, defaultBranch: project.defaultBranch, technology: project.technology }, objective: mission.objective, riskLevel: mission.riskLevel, files }),
    ));
    if (!result.summary?.trim() || !result.commitMessage?.trim() || !Array.isArray(result.files)) throw new Error('AI change plan is invalid.');
    return {
      summary: result.summary.trim(),
      commitMessage: result.commitMessage.trim().slice(0, 120),
      files: result.files.filter((file) => typeof file?.path === 'string' && typeof file?.content === 'string').slice(0, 30),
    };
  }
}
