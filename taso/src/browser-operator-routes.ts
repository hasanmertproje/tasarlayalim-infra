import type { FastifyInstance } from 'fastify';

function workerUrl() {
  return (process.env.TASO_BROWSER_WORKER_URL || '').trim().replace(/\/$/, '');
}

function workerSecret() {
  return (process.env.TASO_BROWSER_WORKER_SECRET || '').trim();
}

type BrowserAction = {
  type: 'click' | 'fill' | 'select' | 'check' | 'press' | 'wait';
  selector?: string;
  value?: string;
  ms?: number;
};

type BrowserRunBody = {
  url?: string;
  viewports?: Array<'desktop' | 'mobile'>;
  actions?: BrowserAction[];
  authority?: 'READ' | 'DRAFT';
};

export function registerBrowserOperatorRoutes(app: FastifyInstance) {
  app.get('/v1/browser/status', async () => {
    const url = workerUrl();
    const secret = workerSecret();
    if (!url || !secret) {
      return {
        configured: false,
        ready: false,
        state: 'not-configured',
        authority: ['READ', 'DRAFT'],
        externalWrite: false,
      };
    }
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
      return {
        configured: true,
        ready: response.ok,
        state: response.ok ? 'ready' : 'degraded',
        authority: ['READ', 'DRAFT'],
        externalWrite: false,
      };
    } catch {
      return { configured: true, ready: false, state: 'unavailable', authority: ['READ', 'DRAFT'], externalWrite: false };
    }
  });

  app.post<{ Body: BrowserRunBody }>('/v1/browser/run', async (request, reply) => {
    const url = workerUrl();
    const secret = workerSecret();
    if (!url || !secret) return reply.code(503).send({ error: 'Browser Operator is not configured.' });
    const body = request.body ?? {};
    if (body.authority && !['READ', 'DRAFT'].includes(body.authority)) {
      return reply.code(403).send({ error: 'Browser Operator V26 allows READ/DRAFT only. External WRITE/HIGH_IMPACT is disabled.' });
    }
    if (!body.url || typeof body.url !== 'string') return reply.code(400).send({ error: 'url is required.' });
    if (body.actions && !Array.isArray(body.actions)) return reply.code(400).send({ error: 'actions must be an array.' });

    try {
      const response = await fetch(`${url}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          url: body.url,
          viewports: body.viewports,
          actions: (body.actions ?? []).slice(0, 20),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const payload = await response.json().catch(() => ({ error: `Browser worker returned ${response.status}.` }));
      if (!response.ok) return reply.code(response.status >= 400 && response.status < 500 ? response.status : 502).send(payload);
      return payload;
    } catch (error) {
      return reply.code(502).send({ error: `Browser worker unavailable: ${(error as Error).message}` });
    }
  });
}
