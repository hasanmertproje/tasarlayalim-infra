import type { FastifyInstance } from 'fastify';
import { VoiceRealtimeRuntime } from './voice-realtime.js';

interface CreateRealtimeSessionBody {
  projectId?: string;
  workspaceName?: string;
  sdp?: string;
}

type WindowState = { count: number; resetAt: number };

export function registerVoiceRealtimeRoutes(app: FastifyInstance) {
  const runtime = new VoiceRealtimeRuntime();
  const windows = new Map<string, WindowState>();

  app.get('/v1/voice/realtime', async () => ({ realtime: runtime.status() }));

  app.post<{ Body: CreateRealtimeSessionBody }>('/v1/voice/realtime/session', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const workspaceName = request.body?.workspaceName?.trim().slice(0, 120);
    const sdp = request.body?.sdp;
    if (!projectId || typeof sdp !== 'string') {
      return reply.code(400).send({ error: 'projectId and sdp are required.' });
    }

    const now = Date.now();
    const previous = windows.get(projectId);
    const windowState = !previous || previous.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : previous;
    if (windowState.count >= 10) {
      return reply.code(429).send({ error: 'Realtime voice session rate limit exceeded for this workspace.' });
    }
    windowState.count += 1;
    windows.set(projectId, windowState);

    try {
      const session = await runtime.createSession({ projectId, workspaceName }, sdp);
      return reply.code(201).send({ session });
    } catch (error) {
      const message = (error as Error).message;
      const unavailable = /disabled|not allowed|not configured/i.test(message);
      return reply.code(unavailable ? 503 : 502).send({ error: message, realtime: runtime.status() });
    }
  });
}
