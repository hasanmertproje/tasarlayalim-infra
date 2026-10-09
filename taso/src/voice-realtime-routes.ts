import type { FastifyInstance } from 'fastify';
import { classifyConversationIntent } from './conversation.js';
import { GeminiLiveRuntime } from './gemini-live.js';
import { GeminiTtsRuntime } from './gemini-tts.js';
import { VoiceRealtimeRuntime } from './voice-realtime.js';

interface CreateRealtimeSessionBody {
  projectId?: string;
  workspaceName?: string;
  sdp?: string;
  speed?: number;
}

interface CreateGeminiSessionBody {
  projectId?: string;
  workspaceName?: string;
}

interface GeminiTtsBody {
  projectId?: string;
  text?: string;
  style?: string;
}

interface ClassifyVoiceTurnBody {
  projectId?: string;
  text?: string;
}

type WindowState = { count: number; resetAt: number };

function consumeWindow(windows: Map<string, WindowState>, projectId: string, limit: number) {
  const now = Date.now();
  const previous = windows.get(projectId);
  const windowState = !previous || previous.resetAt <= now
    ? { count: 0, resetAt: now + 60_000 }
    : previous;
  if (windowState.count >= limit) return false;
  windowState.count += 1;
  windows.set(projectId, windowState);
  return true;
}

export function registerVoiceRealtimeRoutes(app: FastifyInstance) {
  const openai = new VoiceRealtimeRuntime();
  const gemini = new GeminiLiveRuntime();
  const geminiTts = new GeminiTtsRuntime();
  const windows = new Map<string, WindowState>();

  app.get('/v1/voice/realtime', async () => {
    const geminiStatus = gemini.status();
    return {
      realtime: geminiStatus.ready ? geminiStatus : openai.status(),
      providers: {
        gemini: geminiStatus,
        geminiTts: geminiTts.status(),
        openai: openai.status(),
      },
    };
  });

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

  app.post<{ Body: CreateGeminiSessionBody }>('/v1/voice/gemini/token', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const workspaceName = request.body?.workspaceName?.trim().slice(0, 120);
    if (!projectId) return reply.code(400).send({ error: 'projectId is required.' });
    if (!consumeWindow(windows, `gemini:${projectId}`, 12)) {
      return reply.code(429).send({ error: 'Gemini Live token rate limit exceeded for this workspace.' });
    }
    try {
      const session = await gemini.createEphemeralToken({ projectId, workspaceName });
      return reply.code(201).send({ session, realtime: gemini.status() });
    } catch (error) {
      const message = (error as Error).message;
      const unavailable = /disabled|not configured/i.test(message);
      return reply.code(unavailable ? 503 : 502).send({ error: message, realtime: gemini.status() });
    }
  });

  app.post<{ Body: GeminiTtsBody }>('/v1/voice/gemini/tts', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const text = request.body?.text?.trim();
    const style = request.body?.style?.trim();
    if (!projectId || !text) return reply.code(400).send({ error: 'projectId and text are required.' });
    if (!consumeWindow(windows, `gemini-tts:${projectId}`, 24)) {
      return reply.code(429).send({ error: 'Gemini TTS rate limit exceeded for this workspace.' });
    }
    try {
      const audio = await geminiTts.synthesize({ text, style });
      return reply.send({ audio, tts: geminiTts.status() });
    } catch (error) {
      const message = (error as Error).message;
      const unavailable = /disabled|not configured/i.test(message);
      return reply.code(unavailable ? 503 : 502).send({ error: message, tts: geminiTts.status() });
    }
  });

  // Legacy optional OpenAI WebRTC path remains available as a non-primary provider.
  app.post<{ Body: CreateRealtimeSessionBody }>('/v1/voice/realtime/session', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const workspaceName = request.body?.workspaceName?.trim().slice(0, 120);
    const sdp = request.body?.sdp;
    const speed = Number(request.body?.speed);
    if (!projectId || typeof sdp !== 'string') {
      return reply.code(400).send({ error: 'projectId and sdp are required.' });
    }
    if (!consumeWindow(windows, `openai:${projectId}`, 10)) {
      return reply.code(429).send({ error: 'Realtime voice session rate limit exceeded for this workspace.' });
    }

    try {
      const session = await openai.createSession(
        { projectId, workspaceName },
        sdp,
        { speed: Number.isFinite(speed) ? speed : undefined },
      );
      return reply.code(201).send({ session });
    } catch (error) {
      const message = (error as Error).message;
      const unavailable = /disabled|not allowed|not configured/i.test(message);
      return reply.code(unavailable ? 503 : 502).send({ error: message, realtime: openai.status() });
    }
  });
}
