import type { DataClass, Mission, Project } from './domain.js';
import { verifyMissionVisualPreview, type MissionVisualVerification } from './mission-visual-verifier.js';

interface RuntimeProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  allowPrivateCode: boolean;
  allowSensitive: boolean;
}

export interface FunctionalCheck {
  id: string;
  title: string;
  method: 'GET' | 'HEAD';
  path: string;
  expectedStatuses: number[];
  mustContain: string[];
  mustNotContain: string[];
}

export interface FunctionalCheckResult {
  check: FunctionalCheck;
  passed: boolean;
  url: string;
  status?: number;
  latencyMs: number;
  summary: string;
  bodyPreview?: string;
}

export interface FunctionalVerificationReport {
  passed: boolean;
  summary: string;
  planned: number;
  passedCount: number;
  checks: FunctionalCheckResult[];
  visual?: MissionVisualVerification;
}

function envPrefix(id: string) { return `TASO_PROVIDER_${id.toUpperCase().replace(/-/g, '_')}`; }
function providerFromEnv(id: string): RuntimeProvider | undefined {
  const prefix = envPrefix(id);
  const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim();
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  const data = new Set((process.env[`${prefix}_DATA`] ?? 'public').split(',').map((value) => value.trim()));
  return { id, baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model, allowPrivateCode: data.has('private_code') || data.has('sensitive'), allowSensitive: data.has('sensitive') };
}
function legacyProvider(): RuntimeProvider | undefined {
  const baseUrl = process.env.TASO_AI_BASE_URL?.trim();
  const apiKey = process.env.TASO_AI_API_KEY?.trim();
  const model = process.env.TASO_AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return { id: 'legacy', baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model, allowPrivateCode: process.env.TASO_AI_ALLOW_PRIVATE_CODE === 'true', allowSensitive: process.env.TASO_AI_ALLOW_SENSITIVE === 'true' };
}
function eligible(provider: RuntimeProvider, dataClass: DataClass) { if (dataClass === 'private_code') return provider.allowPrivateCode; if (dataClass === 'sensitive') return provider.allowSensitive; return true; }
function boundedInt(name: string, fallback: number, min: number, max: number) { const parsed = Number(process.env[name]); if (!Number.isFinite(parsed)) return fallback; return Math.max(min, Math.min(max, Math.trunc(parsed))); }
function extractJson(value: string) { const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(); const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned; }
function safeText(value: unknown, max = 120) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function safePath(value: unknown) { if (typeof value !== 'string') return undefined; const path = value.trim(); if (!path.startsWith('/') || path.startsWith('//') || /https?:\/\//i.test(path) || path.includes('..') || path.includes('#')) return undefined; return path.slice(0, 300); }
function normalizeChecks(raw: unknown): FunctionalCheck[] {
  const items = raw && typeof raw === 'object' && Array.isArray((raw as { checks?: unknown[] }).checks) ? (raw as { checks: unknown[] }).checks : [];
  const checks: FunctionalCheck[] = [];
  for (let index = 0; index < items.slice(0, 5).length; index += 1) {
    const item = items[index]; if (!item || typeof item !== 'object') continue; const draft = item as Record<string, unknown>; const path = safePath(draft.path); if (!path) continue;
    const method = draft.method === 'HEAD' ? 'HEAD' : 'GET';
    const expected = Array.isArray(draft.expectedStatuses) ? [...new Set(draft.expectedStatuses.filter((status): status is number => typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599))].slice(0, 6) : [];
    const mustContain = Array.isArray(draft.mustContain) ? draft.mustContain.map((value) => safeText(value)).filter(Boolean).slice(0, 3) : [];
    const mustNotContain = Array.isArray(draft.mustNotContain) ? draft.mustNotContain.map((value) => safeText(value)).filter(Boolean).slice(0, 3) : [];
    checks.push({ id: safeText(draft.id, 48).replace(/[^a-zA-Z0-9_-]+/g, '-') || `acceptance-${index + 1}`, title: safeText(draft.title, 120) || `Acceptance check ${index + 1}`, method, path, expectedStatuses: expected.length ? expected : [200], mustContain, mustNotContain });
  }
  return checks;
}
function compactBody(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 1600); }

export class FunctionalVerifier {
  private readonly timeoutMs = boundedInt('TASO_FUNCTIONAL_CHECK_TIMEOUT_MS', 10_000, 2_000, 30_000);
  private readonly providers = new Map<string, RuntimeProvider>();
  private readonly legacy = legacyProvider();
  constructor(providerIds: string[]) { for (const id of providerIds) { const provider = providerFromEnv(id); if (provider) this.providers.set(id, provider); } }
  static fromMission(mission: Mission) { const verifier = new FunctionalVerifier(mission.providerChain); return verifier.candidates(mission).length ? verifier : undefined; }
  private candidates(mission: Mission) {
    const providers = mission.providerChain.map((id) => this.providers.get(id)).filter((provider): provider is RuntimeProvider => Boolean(provider)).filter((provider) => eligible(provider, mission.dataClass));
    if (!providers.length && this.legacy && eligible(this.legacy, mission.dataClass)) providers.push(this.legacy);
    return providers;
  }
  private async plan(project: Project, mission: Mission, previewUrl: string): Promise<FunctionalCheck[]> {
    const failures: string[] = [];
    for (const provider of this.candidates(mission)) {
      try {
        const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: provider.model, temperature: 0, messages: [{ role: 'system', content: ['You are Taso Functional Verification Agent.','Translate the mission objective into 1-5 safe read-only HTTP acceptance checks against an isolated preview.','Return strict JSON only: {"checks":[{"id":"...","title":"...","method":"GET|HEAD","path":"/relative-path","expectedStatuses":[200],"mustContain":["short literal"],"mustNotContain":["short literal"]}]}.','Use only GET or HEAD. Never submit forms, mutate state, authenticate, pay, delete, upload, send messages, trigger jobs or call another origin.','Check behavior directly implied by the mission. Prefer stable visible/API literals over styling details. Do not invent paths unless strongly implied by the objective.'].join(' ') },{ role: 'user', content: JSON.stringify({ project: { name: project.name, technology: project.technology }, missionObjective: mission.objective, previewOrigin: new URL(previewUrl).origin, workPlan: (mission.execution?.workPlan ?? []).map((step) => ({ title: step.title, objective: step.objective, targetPaths: step.targetPaths })) }) }] }), signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; const content = payload.choices?.[0]?.message?.content; if (!content) throw new Error('empty response');
        const checks = normalizeChecks(JSON.parse(extractJson(content))); if (!checks.length) throw new Error('no safe acceptance checks'); return checks;
      } catch (error) { failures.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    throw new Error(`Functional verification planning failed: ${failures.join(' | ') || 'no eligible provider'}`);
  }
  private async runCheck(previewUrl: string, check: FunctionalCheck): Promise<FunctionalCheckResult> {
    const origin = new URL(previewUrl).origin; const target = new URL(check.path, `${origin}/`); if (target.origin !== origin) throw new Error(`Functional check attempted cross-origin URL: ${target.href}`); const startedAt = Date.now();
    try {
      const response = await fetch(target, { method: check.method, redirect: 'follow', headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'user-agent': 'Taso-Functional-Verifier/1.0' }, signal: AbortSignal.timeout(this.timeoutMs) });
      const body = check.method === 'HEAD' ? '' : compactBody(await response.text()); const statusOk = check.expectedStatuses.includes(response.status); const lower = body.toLowerCase(); const missing = check.mustContain.filter((needle) => !lower.includes(needle.toLowerCase())); const forbidden = check.mustNotContain.filter((needle) => lower.includes(needle.toLowerCase())); const passed = statusOk && !missing.length && !forbidden.length;
      const details = [statusOk ? undefined : `expected HTTP ${check.expectedStatuses.join('/')} but received ${response.status}`,missing.length ? `missing required content: ${missing.join(', ')}` : undefined,forbidden.length ? `found forbidden content: ${forbidden.join(', ')}` : undefined].filter(Boolean).join('; ');
      return { check, passed, url: response.url || target.href, status: response.status, latencyMs: Date.now() - startedAt, summary: passed ? `${check.title} passed.` : `${check.title} failed: ${details}`, bodyPreview: passed ? undefined : body };
    } catch (error) { return { check, passed: false, url: target.href, latencyMs: Date.now() - startedAt, summary: `${check.title} failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 800) }; }
  }
  async verify(project: Project, mission: Mission, previewUrl: string): Promise<FunctionalVerificationReport> {
    const checks = await this.plan(project, mission, previewUrl); const results: FunctionalCheckResult[] = []; for (const check of checks) results.push(await this.runCheck(previewUrl, check));
    const passedCount = results.filter((result) => result.passed).length; const failed = results.filter((result) => !result.passed);
    const visual = failed.length ? undefined : await verifyMissionVisualPreview(project, mission, previewUrl);
    const visualFailed = Boolean(visual?.required && !visual.passed);
    const passed = failed.length === 0 && !visualFailed;
    const functionalSummary = failed.length ? `${failed.length}/${results.length} functional acceptance check(s) failed: ${failed.map((result) => result.summary).join(' | ')}`.slice(0, 1200) : `${passedCount}/${results.length} functional acceptance check(s) passed for the mission objective.`;
    const summary = visualFailed ? `${functionalSummary} Visual acceptance failed: ${visual!.summary}`.slice(0,1200) : visual?.required ? `${functionalSummary} ${visual.summary}`.slice(0,1200) : functionalSummary;
    return { passed, planned: results.length, passedCount, checks: results, visual, summary };
  }
}
