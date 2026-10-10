import { Buffer } from 'node:buffer';
import type { PlannedFileChange, RepositoryFile } from './agent-planner.js';

interface GitHubConfig {
  token: string;
  apiBase: string;
}

interface TreeResponse {
  tree?: Array<{ path?: string; type?: string; size?: number }>;
  truncated?: boolean;
}

interface ContentsResponse {
  sha?: string;
  content?: string;
  encoding?: string;
  size?: number;
}

type CheckRun = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  details_url?: string;
  output?: { title?: string | null; summary?: string | null; text?: string | null };
};

type WorkflowRun = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  created_at?: string;
};

type WorkflowJob = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  steps?: Array<{ name?: string; status?: string; conclusion?: string | null; number?: number }>;
};

export interface PullRequestResult {
  number: number;
  url: string;
  branch: string;
  commitSha: string;
}

export type CheckResult = 'success' | 'failed' | 'pending' | 'missing';

export interface CiFailureDiagnostics {
  commitSha: string;
  summary: string;
  failedChecks: Array<{ name: string; conclusion: string; detailsUrl?: string; output?: string }>;
  failedJobs: Array<{ name: string; conclusion: string; failedSteps: string[]; url?: string }>;
  logExcerpt?: string;
}

const MAX_DIAGNOSTIC_LOG_CHARS = 12_000;

function encodeRepoPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function isUsefulPath(path: string) {
  if (!path || /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|storage\/logs)(\/|$)/i.test(path)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|mp4|mp3|woff2?|ttf|eot|lock)$/i.test(path)) return false;
  return true;
}

function sanitizeDiagnostic(value: string, token: string) {
  const withoutAnsi = value.replace(/\x1b\[[0-9;]*m/g, '');
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return withoutAnsi
    .replace(new RegExp(escapedToken, 'g'), '[redacted]')
    .replace(/Bearer\s+[^\s'"`]+/gi, 'Bearer [redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted-github-token]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-api-key]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[redacted-api-key]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*)\s*=\s*[^\s]+/gi, '$1=[redacted]');
}

function boundedDiagnostic(value: string, token: string) {
  const safe = sanitizeDiagnostic(value, token).trim();
  if (safe.length <= MAX_DIAGNOSTIC_LOG_CHARS) return safe;
  return `…[diagnostic truncated]\n${safe.slice(-MAX_DIAGNOSTIC_LOG_CHARS)}`;
}

export class GitHubTools {
  constructor(private readonly config: GitHubConfig) {}

  static fromEnv(): GitHubTools | undefined {
    const token = process.env.TASO_GITHUB_TOKEN?.trim();
    if (!token) return undefined;
    return new GitHubTools({ token, apiBase: (process.env.TASO_GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/$/, '') });
  }

  readiness() {
    return { configured: true, apiBase: this.config.apiBase };
  }

  private async request<T>(path: string, init?: RequestInit, allow404 = false): Promise<T | undefined> {
    const response = await fetch(`${this.config.apiBase}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'x-github-api-version': '2022-11-28',
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(45_000),
    });
    if (allow404 && response.status === 404) return undefined;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub ${response.status}: ${body.slice(0, 700)}`);
    }
    if (response.status === 204) return undefined;
    return response.json() as Promise<T>;
  }

  private async requestText(path: string, allow404 = false): Promise<string | undefined> {
    const response = await fetch(`${this.config.apiBase}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    if (allow404 && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 700)}`);
    return response.text();
  }

  async listFiles(repository: string, ref: string): Promise<string[]> {
    const tree = await this.request<TreeResponse>(`/repos/${repository}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (!tree?.tree) throw new Error('GitHub repository tree is unavailable.');
    return tree.tree
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string' && (entry.size ?? 0) <= 250_000 && isUsefulPath(entry.path!))
      .map((entry) => entry.path!)
      .slice(0, 2500);
  }

  async readFiles(repository: string, ref: string, paths: string[]): Promise<RepositoryFile[]> {
    const files: RepositoryFile[] = [];
    let totalBytes = 0;
    for (const path of paths.slice(0, 12)) {
      const result = await this.request<ContentsResponse>(`/repos/${repository}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`);
      if (!result?.content || result.encoding !== 'base64') continue;
      const content = Buffer.from(result.content.replace(/\n/g, ''), 'base64').toString('utf8');
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > 300_000) break;
      files.push({ path, content });
    }
    return files;
  }

  async createBranch(repository: string, base: string, branch: string): Promise<string> {
    const baseRef = await this.request<{ object?: { sha?: string } }>(`/repos/${repository}/git/ref/heads/${encodeURIComponent(base)}`);
    const sha = baseRef?.object?.sha;
    if (!sha) throw new Error('Default branch SHA could not be resolved.');
    await this.request(`/repos/${repository}/git/refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    return sha;
  }

  private async writeFile(repository: string, branch: string, change: PlannedFileChange, message: string) {
    const existing = await this.request<ContentsResponse>(
      `/repos/${repository}/contents/${encodeRepoPath(change.path)}?ref=${encodeURIComponent(branch)}`,
      undefined,
      true,
    );
    await this.request(`/repos/${repository}/contents/${encodeRepoPath(change.path)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        branch,
        content: Buffer.from(change.content, 'utf8').toString('base64'),
        ...(existing?.sha ? { sha: existing.sha } : {}),
      }),
    });
  }

  async commitChanges(repository: string, branch: string, changes: PlannedFileChange[], message: string): Promise<string> {
    if (!changes.length) throw new Error('No file changes were produced.');
    for (const change of changes) await this.writeFile(repository, branch, change, message);
    const ref = await this.request<{ object?: { sha?: string } }>(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!ref?.object?.sha) throw new Error('Commit SHA could not be resolved after write.');
    return ref.object.sha;
  }

  async openPullRequest(repository: string, base: string, branch: string, title: string, body: string): Promise<{ number: number; url: string }> {
    const pr = await this.request<{ number?: number; html_url?: string }>(`/repos/${repository}/pulls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, head: branch, base, draft: false }),
    });
    if (!pr?.number || !pr.html_url) throw new Error('GitHub pull request response was incomplete.');
    return { number: pr.number, url: pr.html_url };
  }

  async createPullRequestWithChanges(input: {
    repository: string;
    base: string;
    branch: string;
    changes: PlannedFileChange[];
    commitMessage: string;
    title: string;
    body: string;
  }): Promise<PullRequestResult> {
    await this.createBranch(input.repository, input.base, input.branch);
    const commitSha = await this.commitChanges(input.repository, input.branch, input.changes, input.commitMessage);
    const pr = await this.openPullRequest(input.repository, input.base, input.branch, input.title, input.body);
    return { ...pr, branch: input.branch, commitSha };
  }

  async checkCommit(repository: string, sha: string): Promise<CheckResult> {
    const checks = await this.request<{ total_count?: number; check_runs?: CheckRun[] }>(
      `/repos/${repository}/commits/${sha}/check-runs`,
    );
    const statuses = await this.request<{ state?: string; total_count?: number }>(`/repos/${repository}/commits/${sha}/status`);
    const runs = checks?.check_runs ?? [];
    if (!runs.length && !(statuses?.total_count ?? 0)) return 'missing';
    if (runs.some((run) => run.status !== 'completed') || statuses?.state === 'pending') return 'pending';
    if (runs.some((run) => !['success', 'neutral', 'skipped'].includes(run.conclusion ?? '')) || ['failure', 'error'].includes(statuses?.state ?? '')) return 'failed';
    return 'success';
  }

  async waitForChecks(repository: string, sha: string): Promise<CheckResult> {
    let missingSeen = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const state = await this.checkCommit(repository, sha);
      if (state === 'success' || state === 'failed') return state;
      if (state === 'missing') missingSeen += 1;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    return missingSeen === 24 ? 'missing' : 'pending';
  }

  async getFailureDiagnostics(repository: string, sha: string): Promise<CiFailureDiagnostics> {
    const checks = await this.request<{ check_runs?: CheckRun[] }>(`/repos/${repository}/commits/${sha}/check-runs?per_page=100`);
    const failedChecks = (checks?.check_runs ?? [])
      .filter((run) => run.status === 'completed' && !['success', 'neutral', 'skipped'].includes(run.conclusion ?? ''))
      .slice(0, 10)
      .map((run) => ({
        name: run.name?.trim() || 'Unnamed check',
        conclusion: run.conclusion ?? 'failure',
        ...(run.details_url ? { detailsUrl: run.details_url } : {}),
        ...((run.output?.title || run.output?.summary || run.output?.text) ? {
          output: boundedDiagnostic([run.output?.title, run.output?.summary, run.output?.text].filter(Boolean).join('\n'), this.config.token).slice(0, 4000),
        } : {}),
      }));

    const workflowRuns = await this.request<{ workflow_runs?: WorkflowRun[] }>(
      `/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=10`,
      undefined,
      true,
    );
    const failedRun = (workflowRuns?.workflow_runs ?? [])
      .filter((run) => run.conclusion === 'failure')
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];

    let failedJobs: CiFailureDiagnostics['failedJobs'] = [];
    let logExcerpt: string | undefined;
    if (failedRun?.id) {
      const jobs = await this.request<{ jobs?: WorkflowJob[] }>(`/repos/${repository}/actions/runs/${failedRun.id}/jobs?per_page=100`, undefined, true);
      const failed = (jobs?.jobs ?? []).filter((job) => job.conclusion === 'failure').slice(0, 6);
      failedJobs = failed.map((job) => ({
        name: job.name?.trim() || 'Unnamed job',
        conclusion: job.conclusion ?? 'failure',
        failedSteps: (job.steps ?? []).filter((step) => step.conclusion === 'failure').map((step) => step.name?.trim() || `Step ${step.number ?? '?'}`).slice(0, 12),
        ...(job.html_url ? { url: job.html_url } : {}),
      }));
      const logParts: string[] = [];
      for (const job of failed.slice(0, 2)) {
        if (!job.id) continue;
        try {
          const raw = await this.requestText(`/repos/${repository}/actions/jobs/${job.id}/logs`, true);
          if (raw) logParts.push(`## ${job.name ?? 'Failed job'}\n${boundedDiagnostic(raw, this.config.token)}`);
        } catch {
          // Check output + failed step metadata remain available when raw logs cannot be downloaded.
        }
      }
      if (logParts.length) logExcerpt = boundedDiagnostic(logParts.join('\n\n'), this.config.token);
    }

    const parts = [
      failedChecks.length ? `${failedChecks.length} failed check(s): ${failedChecks.map((item) => item.name).join(', ')}` : '',
      failedJobs.length ? `${failedJobs.length} failed job(s): ${failedJobs.map((item) => item.name).join(', ')}` : '',
    ].filter(Boolean);
    return {
      commitSha: sha,
      summary: parts.join('. ') || 'GitHub reported failed checks but no bounded failure metadata was available.',
      failedChecks,
      failedJobs,
      ...(logExcerpt ? { logExcerpt } : {}),
    };
  }
}
