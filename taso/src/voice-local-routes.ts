import type { FastifyInstance } from 'fastify';

function baseUrl() {
  return process.env.TASO_LOCAL_VOICE_URL?.trim().replace(/\/$/, '');
}

function timeoutMs() {
  const parsed = Number(process.env.TASO_LOCAL_VOICE_TIMEOUT_MS || 90_000);
  return Number.isFinite(parsed) ? Math.min(120_000, Math.max(5_000, parsed)) : 90_000;
}

type LocalVoiceHealth = {
  engine?: string;
  provider?: string;
  model?: string;
  device?: string;
  steps?: number;
  license?: string;
  voices?: unknown[];
  ready?: boolean;
  loading?: boolean;
  error?: string | null;
};

export function registerLocalVoiceRoutes(app: FastifyInstance) {
  app.get('/v1/voice/local', async (_request, reply) => {
    const url = baseUrl();
    if (!url) return { local: { configured: false, ready: false, loading: false, provider: 'self-hosted', voices: [] } };
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as LocalVoiceHealth;
      return {
        local: {
          configured: true,
          ready: payload.ready === true,
          loading: payload.loading === true,
          provider: payload.provider ?? 'self-hosted',
          engine: payload.engine ?? 'unknown',
          model: payload.model,
          device: payload.device,
          steps: payload.steps,
          license: payload.license,
          voices: Array.isArray(payload.voices) ? payload.voices : [],
          error: payload.error ?? undefined,
        },
      };
    } catch (error) {
      reply.code(200);
      return {
        local: {
          configured: true,
          ready: false,
          loading: false,
          provider: 'self-hosted',
          voices: [],
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  app.post<{ Body: { text?: string; voiceId?: string; speed?: number } }>('/v1/voice/local/synthesize', async (request, reply) => {
    const url = baseUrl();
    if (!url) return reply.code(503).send({ error: 'Local neural voice is not configured.' });

    const text = request.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: 'text is required.' });
    if (text.length > 1_500) return reply.code(400).send({ error: 'text is too long.' });

    try {
      const response = await fetch(`${url}/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: request.body?.voiceId?.trim() || undefined,
          speed: request.body?.speed,
        }),
        signal: AbortSignal.timeout(timeoutMs()),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        return reply.code(response.status >= 500 ? 502 : response.status).send({ error: detail || `Voice service HTTP ${response.status}` });
      }

      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) return reply.code(502).send({ error: 'Voice service returned empty audio.' });
      const contentType = response.headers.get('content-type') || 'audio/wav';
      reply.header('cache-control', 'no-store');
      reply.type(contentType);
      return reply.send(audio);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /timeout|aborted|abort/i.test(message);
      return reply.code(timedOut ? 504 : 502).send({
        error: timedOut
          ? `Local neural synthesis timed out after ${timeoutMs()} ms.`
          : `Local neural synthesis request failed: ${message}`,
      });
    }
  });
}
