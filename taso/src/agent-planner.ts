import type { DataClass, Mission, Project } from './domain.js';

export interface RepositoryFile {
  path: string;
  content: string;
}

export interface PlannedFileChange {
  path: string;
  content: string;
}

export interface ChangePlan {
  summary: string;
  commitMessage: string;
  files: PlannedFileChange[];
}

interface PlannerConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  allowPrivateCode: boolean;
  allowSensitive: boolean;
}

function parseJson<T>(value: string): T {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

export class OpenAiCompatiblePlanner {
  constructor(private readonly config: PlannerConfig) {}

  static fromEnv(): OpenAiCompatiblePlanner | undefined {
    const baseUrl = process.env.TASO_AI_BASE_URL?.trim();
    const apiKey = process.env.TASO_AI_API_KEY?.trim();
    const model = process.env.TASO_AI_MODEL?.trim();
    if (!baseUrl || !apiKey || !model) return undefined;
    return new OpenAiCompatiblePlanner({
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey,
      model,
      allowPrivateCode: process.env.TASO_AI_ALLOW_PRIVATE_CODE === 'true',
      allowSensitive: process.env.TASO_AI_ALLOW_SENSITIVE === 'true',
    });
  }

  readiness() {
    return { configured: true, model: this.config.model, privateCode: this.config.allowPrivateCode, sensitive: this.config.allowSensitive };
  }

  assertDataClass(dataClass: DataClass) {
    if (dataClass === 'private_code' && !this.config.allowPrivateCode) throw new Error('AI provider is not approved for private code.');
    if (dataClass === 'sensitive' && !this.config.allowSensitive) throw new Error('AI provider is not approved for sensitive data.');
  }

  private async complete(system: string, user: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, temperature: 0.15, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`AI provider ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('AI provider returned an empty response.');
    return content;
  }

  async chooseFiles(project: Project, mission: Mission, availablePaths: string[]): Promise<string[]> {
    this.assertDataClass(mission.dataClass);
    const result = parseJson<{ files?: string[] }>(await this.complete(
      'You are Taso file selector. Return only JSON: {"files":["path"]}. Select at most 12 existing files needed to understand the task. Never invent paths.',
      JSON.stringify({ project: { name: project.name, repository: project.repository, technology: project.technology }, objective: mission.objective, paths: availablePaths.slice(0, 2500) }),
    ));
    const allowed = new Set(availablePaths);
    return [...new Set((result.files ?? []).filter((path) => allowed.has(path)))].slice(0, 12);
  }

  async analyze(project: Project, mission: Mission, files: RepositoryFile[]): Promise<string> {
    this.assertDataClass(mission.dataClass);
    return (await this.complete(
      'You are Taso, a senior software engineer. Analyze the requested task without changing code. Be concise, concrete, and mention risks/tests. Plain text only.',
      JSON.stringify({ project: { name: project.name, technology: project.technology }, objective: mission.objective, files }),
    )).trim();
  }

  async planChanges(project: Project, mission: Mission, files: RepositoryFile[]): Promise<ChangePlan> {
    this.assertDataClass(mission.dataClass);
    const result = parseJson<ChangePlan>(await this.complete(
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
