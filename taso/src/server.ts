import Fastify from 'fastify';
import { bootstrapProjects } from './bootstrap-projects.js';
import { classifyConversationIntent, ConversationStore } from './conversation.js';
import type { DataClass, RiskLevel } from './domain.js';
import { MissionEventStore } from './mission-events.js';
import { MissionExecutor } from './mission-executor.js';
import type { UpsertProjectManifestInput } from './project-manifest.js';
import { ProjectRegistry, type CreateProjectInput } from './project-registry.js';
import { ProviderRouter, defaultProviders } from './provider-router.js';
import { JsonStateStore } from './state-store.js';
import { TaskEngine } from './task-engine.js';

interface CreateMissionBody {
  projectId?: string;
  objective?: string;
  riskLevel?: RiskLevel;
  dataClass?: DataClass;
  autonomous?: {
    enabled?: boolean;
    maxRetries?: number;
    previewRequired?: boolean;
    production?: 'ask' | 'deny' | 'auto';
    destructive?: 'ask' | 'deny';
    paidAi?: boolean;
    notifications?: 'important_only' | 'all';
  };
}

interface ConversationBody {
  projectId?: string;
  text?: string;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'READ' || value === 'WRITE' || value === 'HIGH_IMPACT';
}

function isDataClass(value: unknown): value is DataClass {
  return value === 'public' || value === 'private_code' || value === 'sensitive';
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const stateFile = process.env.TASO_STATE_FILE?.trim() || (process.env.NODE_ENV === 'production' ? '/data/taso-state.json' : undefined);
  const stateStore = new JsonStateStore(stateFile);
  const snapshot = stateStore.load();

  let projects!: ProjectRegistry;
  let tasks!: TaskEngine;
  let conversations!: ConversationStore;
  const persist = () => {
    if (!projects || !tasks || !conversations) return;
    stateStore.save({
      projects: projects.list(),
      manifests: projects.listManifests(),
      missions: tasks.listMissions(),
      events: tasks.allEvents(),
      conversations: conversations.list(),
    });
  };

  projects = new ProjectRegistry(snapshot.projects, snapshot.manifests, persist);
  for (const project of bootstrapProjects) {
    if (!projects.findBySlug(project.slug)) projects.create(project);
  }
  const router = new ProviderRouter(defaultProviders());
  const events = new MissionEventStore(snapshot.events, persist);
  tasks = new TaskEngine(projects, router, events, snapshot.missions, persist);
  conversations = new ConversationStore(snapshot.conversations, persist);
  tasks.recoverInterruptedMissions();
  persist();

  const executor = new MissionExecutor(tasks, projects);
  const gatewaySecret = process.env.TASO_GATEWAY_SECRET?.trim();

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (!gatewaySecret) {
      if (process.env.NODE_ENV === 'production') return reply.code(503).send({ error: 'Taso gateway is not configured.' });
      return;
    }
    const supplied = request.headers['x-taso-gateway'];
    if (typeof supplied !== 'string' || supplied !== gatewaySecret) return reply.code(401).send({ error: 'Unauthorized gateway.' });
  });

  app.get('/health', async () => {
    const readiness = executor.readiness();
    return {
      ok: true,
      service: 'taso-core',
      version: '0.5.0-v2-preview',
      gateway: gatewaySecret ? 'configured' : 'missing',
      state: stateStore.enabled() ? 'persistent' : 'memory',
      executor: { read: readiness.readyForRead, write: readiness.readyForWrite, deploy: readiness.readyForDeploy },
    };
  });

  app.get('/v1/executor', async () => ({ executor: executor.readiness() }));
  app.get('/v1/providers', async () => ({ providers: router.safeSummary() }));
  app.get('/v1/projects', async () => ({ projects: projects.list() }));
  app.get('/v1/missions', async () => ({ missions: tasks.listMissions() }));
  app.get<{ Querystring: { projectId?: string } }>('/v1/conversations', async (request) => ({
    messages: conversations.list(request.query.projectId),
  }));

  app.post<{ Body: ConversationBody }>('/v1/conversations/messages', async (request, reply) => {
    const projectId = request.body?.projectId?.trim();
    const text = request.body?.text?.trim();
    if (!projectId || !text) return reply.code(400).send({ error: 'projectId and text are required.' });
    const project = projects.get(projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });

    const decision = classifyConversationIntent(text);
    const userMessage = conversations.append({ projectId, role: 'user', content: text, intent: decision.intent });
    const projectMissions = tasks.listMissions().filter((mission) => mission.projectId === projectId);
    const active = projectMissions.find((mission) => !['completed', 'failed', 'cancelled'].includes(mission.status));

    let content: string;
    if (decision.intent === 'STATUS') {
      content = active
        ? `${project.name} için aktif görev ${active.status} aşamasında: ${active.objective}`
        : `${project.name} için şu anda aktif görev yok. Son kayıtları konuşma veya Missions ekranından inceleyebilirsin.`;
    } else if (decision.executionRequested) {
      content = `Bu istek yürütme gerektiriyor. ${decision.suggestedRisk ?? 'READ'} sınırıyla ayrı bir mission oluşturulmalı; konuşma katmanı bunu normal sohbetten ayrı tutuyor.`;
    } else if (decision.intent === 'CHAT') {
      content = `Buradayım. ${project.name} bağlamındayız. Bu mesaj için mission oluşturmadım.`;
    } else if (decision.intent === 'QUESTION' || decision.intent === 'PLAN') {
      content = `Sorunu ${project.name} bağlamında aldım. V2 Conversation Engine bu tür mesajları mission oluşturmadan yanıtlayacak; AI cevap üretimi M2 katmanında bu aynı endpoint'e bağlanacak.`;
    } else {
      content = `Mesajı ${decision.intent} olarak sınıflandırdım. Herhangi bir repository işlemi başlatmadım.`;
    }

    const assistantMessage = conversations.append({
      projectId,
      role: 'assistant',
      content,
      intent: decision.intent,
    });

    return reply.code(201).send({
      decision,
      userMessage,
      assistantMessage,
      suggestedMission: decision.executionRequested ? {
        objective: text,
        riskLevel: decision.suggestedRisk ?? 'READ',
        dataClass: 'private_code',
      } : undefined,
    });
  });

  app.post<{ Body: CreateProjectInput }>('/v1/projects', async (request, reply) => {
    try {
      const body = request.body;
      if (!body?.slug || !body?.name || !body?.repository || typeof body.isExisting !== 'boolean') {
        return reply.code(400).send({ error: 'slug, name, repository and isExisting are required.' });
      }
      return reply.code(201).send({ project: projects.create(body) });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id/manifest', async (request, reply) => {
    if (!projects.get(request.params.id)) return reply.code(404).send({ error: 'Project not found.' });
    const manifest = projects.getManifest(request.params.id);
    if (!manifest) return reply.code(404).send({ error: 'Project manifest not found.' });
    return { manifest };
  });

  app.put<{ Params: { id: string }; Body: UpsertProjectManifestInput }>('/v1/projects/:id/manifest', async (request, reply) => {
    try {
      return { manifest: projects.upsertManifest(request.params.id, request.body ?? {}) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Body: CreateMissionBody }>('/v1/missions', async (request, reply) => {
    try {
      const body = request.body;
      if (!body?.projectId || !body.objective || !isRiskLevel(body.riskLevel) || !isDataClass(body.dataClass)) {
        return reply.code(400).send({ error: 'projectId, objective, riskLevel and dataClass are required.' });
      }
      const mission = tasks.createMission({
        projectId: body.projectId,
        objective: body.objective,
        riskLevel: body.riskLevel,
        dataClass: body.dataClass,
        autonomous: body.autonomous,
      });
      if (mission.status === 'queued') executor.executeSoon(mission.id);
      return reply.code(201).send({ mission });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/v1/missions/:id', async (request, reply) => {
    const mission = tasks.getMission(request.params.id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found.' });
    return { mission };
  });

  app.get<{ Params: { id: string } }>('/v1/missions/:id/events', async (request, reply) => {
    try { return { events: tasks.listEvents(request.params.id) }; }
    catch (error) { return reply.code(404).send({ error: (error as Error).message }); }
  });

  app.post<{ Params: { id: string } }>('/v1/missions/:id/approve', async (request, reply) => {
    try {
      const mission = tasks.approveMission(request.params.id);
      if (mission.status === 'queued') executor.executeSoon(mission.id);
      return { mission };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/v1/missions/:id/retry', async (request, reply) => {
    try {
      const mission = tasks.retryMission(request.params.id);
      if (mission.status === 'queued') executor.executeSoon(mission.id);
      return { mission };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/v1/missions/:id/execute', async (request, reply) => {
    const mission = tasks.getMission(request.params.id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found.' });
    if (mission.status !== 'queued') return reply.code(409).send({ error: `Mission cannot execute from status ${mission.status}.` });
    executor.executeSoon(mission.id);
    return reply.code(202).send({ mission });
  });

  app.post<{ Params: { id: string } }>('/v1/missions/:id/cancel', async (request, reply) => {
    try { return { mission: tasks.cancelMission(request.params.id) }; }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });

  return app;
}
