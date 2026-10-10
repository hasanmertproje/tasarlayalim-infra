import type { FastifyInstance } from 'fastify';

type BrowserConsoleEntry = { type?: string; text?: string };
type BrowserFailure = { url?: string; error?: string };
type ElementCandidate = { tag?: string; id?: string; className?: string; width?: number; height?: number };

export type BrowserEvidence = {
  viewport?: string;
  theme?: string | null;
  dimensions?: { width?: number; height?: number };
  httpStatus?: number | null;
  title?: string;
  url?: string;
  horizontalOverflow?: boolean;
  documentWidth?: number;
  viewportWidth?: number;
  overflowers?: ElementCandidate[];
  clippedFixed?: ElementCandidate[];
  smallTapTargets?: ElementCandidate[];
  console?: BrowserConsoleEntry[];
  pageErrors?: string[];
  requestFailures?: BrowserFailure[];
  screenshot?: { mime?: string; base64?: string; bytes?: number; omitted?: boolean };
};

export type BrowserRunPayload = {
  ok?: boolean;
  target?: string;
  generatedAt?: string;
  evidence?: BrowserEvidence[];
  summary?: Record<string, unknown>;
};

export type VisualQaIssue = {
  code: 'http-status' | 'horizontal-overflow' | 'fixed-clipping' | 'small-tap-target' | 'console-error' | 'page-error' | 'request-failure' | 'missing-screenshot';
  severity: 'blocker' | 'warning';
  viewport: string;
  theme: string;
  message: string;
  evidence?: Record<string, unknown>;
};

export type VisualQaReport = {
  status: 'passed' | 'failed';
  target?: string;
  generatedAt: string;
  viewports: string[];
  themes: string[];
  blockerCount: number;
  warningCount: number;
  issues: VisualQaIssue[];
  browser: BrowserRunPayload;
};

export type RepairAttempt<TReport> = {
  attempt: number;
  report: TReport;
  repaired: boolean;
  repairSummary?: string;
};

export type BoundedRepairResult<TReport> = {
  passed: boolean;
  exhausted: boolean;
  maxAttempts: number;
  attempts: RepairAttempt<TReport>[];
  finalReport: TReport;
};

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

function clipped(value: unknown, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function assessVisualQaEvidence(browser: BrowserRunPayload): VisualQaReport {
  const issues: VisualQaIssue[] = [];
  const evidence = Array.isArray(browser.evidence) ? browser.evidence : [];

  for (const item of evidence) {
    const viewport = clipped(item.viewport || 'unknown', 40) || 'unknown';
    const theme = clipped(item.theme || 'unknown', 20) || 'unknown';
    const push = (issue: Omit<VisualQaIssue, 'viewport' | 'theme'>) => issues.push({ ...issue, viewport, theme });
    const status = typeof item.httpStatus === 'number' ? item.httpStatus : null;

    if (status !== null && status >= 400) push({
      code: 'http-status', severity: 'blocker', message: `HTTP ${status} returned for ${viewport}/${theme}.`,
      evidence: { status, url: clipped(item.url, 500) },
    });

    if (item.horizontalOverflow) push({
      code: 'horizontal-overflow', severity: 'blocker', message: `Horizontal overflow detected on ${viewport}/${theme}.`,
      evidence: { documentWidth: item.documentWidth, viewportWidth: item.viewportWidth, candidates: (item.overflowers ?? []).slice(0, 12) },
    });

    if ((item.clippedFixed ?? []).length) push({
      code: 'fixed-clipping', severity: 'blocker', message: `Fixed/sticky controls are clipped on ${viewport}/${theme}.`,
      evidence: { candidates: (item.clippedFixed ?? []).slice(0, 12) },
    });

    if ((item.smallTapTargets ?? []).length) push({
      code: 'small-tap-target', severity: 'warning', message: `${item.smallTapTargets!.length} compact interactive target(s) detected on ${viewport}/${theme}.`,
      evidence: { candidates: item.smallTapTargets!.slice(0, 12) },
    });

    for (const entry of item.console ?? []) {
      if (entry.type === 'error') push({ code: 'console-error', severity: 'blocker', message: clipped(entry.text || 'Console error', 800) });
    }
    for (const error of item.pageErrors ?? []) push({ code: 'page-error', severity: 'blocker', message: clipped(error, 800) });
    for (const failure of item.requestFailures ?? []) push({
      code: 'request-failure', severity: 'warning',
      message: `${clipped(failure.error || 'Request failed', 220)} · ${clipped(failure.url, 500)}`,
    });

    if (!item.screenshot || item.screenshot.omitted || !item.screenshot.base64) push({
      code: 'missing-screenshot', severity: 'warning', message: `Screenshot evidence is unavailable for ${viewport}/${theme}.`,
      evidence: { bytes: item.screenshot?.bytes },
    });
  }

  if (!evidence.length) issues.push({
    code: 'page-error', severity: 'blocker', viewport: 'unknown', theme: 'unknown', message: 'Browser Operator returned no viewport evidence.',
  });

  const blockerCount = issues.filter((issue) => issue.severity === 'blocker').length;
  const warningCount = issues.length - blockerCount;
  return {
    status: blockerCount ? 'failed' : 'passed',
    target: browser.target,
    generatedAt: browser.generatedAt || new Date().toISOString(),
    viewports: [...new Set(evidence.map((item) => clipped(item.viewport || 'unknown', 40)))],
    themes: [...new Set(evidence.map((item) => clipped(item.theme || 'unknown', 20)))],
    blockerCount,
    warningCount,
    issues,
    browser,
  };
}

export async function runBoundedVisualRepairLoop<TReport extends { status: 'passed' | 'failed' }>(input: {
  verify: () => Promise<TReport>;
  repair: (report: TReport, attempt: number) => Promise<{ repaired: boolean; summary?: string }>;
  maxAttempts?: number;
}): Promise<BoundedRepairResult<TReport>> {
  const maxAttempts = Math.max(0, Math.min(3, Math.trunc(input.maxAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS)));
  const attempts: RepairAttempt<TReport>[] = [];
  let report = await input.verify();

  for (let attempt = 1; report.status === 'failed' && attempt <= maxAttempts; attempt += 1) {
    const repair = await input.repair(report, attempt);
    attempts.push({ attempt, report, repaired: repair.repaired, repairSummary: repair.summary });
    if (!repair.repaired) break;
    report = await input.verify();
  }

  return { passed: report.status === 'passed', exhausted: report.status === 'failed' && attempts.length >= maxAttempts, maxAttempts, attempts, finalReport: report };
}

function workerUrl() {
  return (process.env.TASO_BROWSER_WORKER_URL || '').trim().replace(/\/$/, '');
}

function workerSecret() {
  return (process.env.TASO_BROWSER_WORKER_SECRET || '').trim();
}

async function browserRun(input: { url: string; actions?: unknown[] }) {
  const url = workerUrl();
  const secret = workerSecret();
  if (!url || !secret) throw new Error('Browser Operator is not configured.');
  const response = await fetch(`${url}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      url: input.url,
      viewports: ['desktop', 'mobile'],
      themes: ['dark', 'light'],
      actions: Array.isArray(input.actions) ? input.actions.slice(0, 20) : [],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({ error: `Browser worker returned ${response.status}.` }));
  if (!response.ok) throw new Error(clipped((payload as { error?: unknown }).error || `Browser worker returned ${response.status}.`, 800));
  return payload as BrowserRunPayload;
}

export function registerVisualQaRoutes(app: FastifyInstance) {
  app.get('/v1/visual-qa/status', async () => ({
    configured: Boolean(workerUrl() && workerSecret()),
    maxAutoRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
    viewports: ['desktop', 'mobile'],
    themes: ['dark', 'light'],
    gates: ['http', 'horizontal-overflow', 'fixed-sticky-clipping', 'tap-targets', 'console', 'page-errors', 'request-failures', 'screenshot-evidence'],
    durableAutoRepair: 'mission-callback-required',
  }));

  app.post<{ Body: { url?: string; actions?: unknown[] } }>('/v1/visual-qa/run', async (request, reply) => {
    if (!request.body?.url || typeof request.body.url !== 'string') return reply.code(400).send({ error: 'url is required.' });
    try {
      const report = assessVisualQaEvidence(await browserRun({ url: request.body.url, actions: request.body.actions }));
      return {
        ...report,
        autoRepair: { maxAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS, required: report.status === 'failed', durableRepairRequiresMissionContext: true },
      };
    } catch (error) {
      const message = clipped(error instanceof Error ? error.message : error, 800);
      return reply.code(message.includes('not configured') ? 503 : 502).send({ error: message });
    }
  });
}
