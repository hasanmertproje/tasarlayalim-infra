import type { FastifyInstance } from 'fastify';
import { classifyConversationIntent } from './conversation.js';
import { VoiceRealtimeRuntime } from './voice-realtime.js';

interface CreateRealtimeSessionBody {
  projectId?: string;
  workspaceName?: string;
  sdp?: string;
  speed?: number;
}

interface ClassifyVoiceTurnBody {
  projectId?: string;
  text?: string;
}

type WindowState = { count: number; resetAt: number };

export function registerVoiceRealtimeRoutes(app: FastifyInstance) {
  const runtime = new VoiceRealtimeRuntime();
  const windows = new Map<string, WindowState>();

  app.get('/v1/voice/realtime', async () => ({ realtime: runtime.status() }));

  app.post<{ Body: ClassifyVoiceTurnBody }>('/v1/voice/classify', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const text = request.body?.text?.trim();
    if (!projectId || !text) return reply.code(400).send({ error: 'projectId and text are required.' });
    const decision = classifyConversationIntent(text);
    return {
      decision,
      suggestedMission: decision.executionRequested ? {
        projectId,
        objective: text,
        riskLevel: decision.suggestedRisk ?? 'READ',
        dataClass: 'private_code' as const,
      } : undefined,
    };
  });

  app.post<{ Body: CreateRealtimeSessionBody }>('/v1/voice/realtime/session', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const workspaceName = request.body?.workspaceName?.trim().slice(0, 120);
    const sdp = request.body?.sdp;
    const speed = Number(request.body?.speed);
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
      const session = await runtime.createSession(
        { projectId, workspaceName },
        sdp,
        { speed: Number.isFinite(speed) ? speed : undefined },
      );
      return reply.code(201).send({ session });
    } catch (error) {
      const message = (error as Error).message;
      const unavailable = /disabled|not allowed|not configured/i.test(message);
      return reply.code(unavailable ? 503 : 502).send({ error: message, realtime: runtime.status() });
    }
  });
}
