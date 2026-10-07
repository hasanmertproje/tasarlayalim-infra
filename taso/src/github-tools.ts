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

export interface PullRequestResult {
  number: number;
  url: string;
  branch: string;
  commitSha: string;
}

export type CheckResult = 'success' | 'failed' | 'pending' | 'missing';

function encodeRepoPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function isUsefulPath(path: string) {
  if (!path || /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|storage\/logs)(\/|$)/i.test(path)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|mp4|mp3|woff2?|ttf|eot|lock)$/i.test(path)) return false;
  return true;
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
    const checks = await this.request<{ total_count?: number; check_runs?: Array<{ status?: string; conclusion?: string | null }> }>(
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
}
