import Fastify from 'fastify';
import { bootstrapProjects } from './bootstrap-projects.js';
import { ConversationAi, type ConversationEvidence } from './conversation-ai.js';
import { classifyConversationIntent, ConversationStore } from './conversation.js';
import type { DataClass, RiskLevel } from './domain.js';
import { MissionEventStore } from './mission-events.js';
import { bindMissionProjectContext } from './mission-project-context.js';
import { RuntimeSelfHealingExecutor } from './runtime-self-healing-executor.js';
import { buildOperationsSnapshot } from './operations-snapshot.js';
import {
  ProjectKnowledgeStore,
  type CreateProjectKnowledgeInput,
  type UpdateProjectKnowledgeInput,
} from './project-knowledge.js';
import type { UpsertProjectManifestInput } from './project-manifest.js';
import {
  ProjectMilestoneStore,
  type CreateProjectMilestoneInput,
  type UpdateProjectMilestoneInput,
} from './project-milestones.js';
import { ProjectRegistry, type CreateProjectInput } from './project-registry.js';
import { ProviderRouter, defaultProviders } from './provider-router.js';
import { JsonStateStore } from './state-store.js';
import { StudioStore } from './studio-store.js';
import { registerStudioRoutes } from './studio-routes.js';
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
  webSearch?: boolean;
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
  const app = Fastify({ logger: true, trustProxy: 'uniquelocal' });
  const stateFile = process.env.TASO_STATE_FILE?.trim() || (process.env.NODE_ENV === 'production' ? '/data/taso-state.json' : undefined);
  const stateStore = new JsonStateStore(stateFile);
  const snapshot = stateStore.load();

  let projects!: ProjectRegistry;
  let milestones!: ProjectMilestoneStore;
  let knowledge!: ProjectKnowledgeStore;
  let tasks!: TaskEngine;
  let conversations!: ConversationStore;
  let studio!: StudioStore;
  const persist = () => {
    if (!projects || !milestones || !knowledge || !tasks || !conversations || !studio) return;
    stateStore.save({
      projects: projects.list(),
      manifests: projects.listManifests(),
      milestones: milestones.list(),
      knowledge: knowledge.all(),
      missions: tasks.listMissions(),
      events: tasks.allEvents(),
      conversations: conversations.list(),
      studioDocuments: studio.list(),
    });
  };

  projects = new ProjectRegistry(snapshot.projects, snapshot.manifests, persist);
  studio = new StudioStore(snapshot.studioDocuments, persist);
  for (const project of bootstrapProjects) {
    if (!projects.findBySlug(project.slug)) projects.create(project);
  }
  milestones = new ProjectMilestoneStore(snapshot.milestones, (projectId) => Boolean(projects.get(projectId)), persist);
  knowledge = new ProjectKnowledgeStore(snapshot.knowledge, (projectId) => Boolean(projects.get(projectId)), persist);
  conversations = new ConversationStore(snapshot.conversations, persist);
  const router = new ProviderRouter(defaultProviders());
  const events = new MissionEventStore(snapshot.events, persist);
  tasks = new TaskEngine(projects, router, events, snapshot.missions, persist);
  tasks.recoverInterruptedMissions();
  persist();

  const executor = bindMissionProjectContext(new RuntimeSelfHealingExecutor(tasks, projects), tasks, projects, knowledge);
  const conversationAi = new ConversationAi(router);
  const stopWatchdog = executor.startWatchdog();
  const gatewaySecret = process.env.TASO_GATEWAY_SECRET?.trim();

  app.addHook('onClose', async () => {
    stopWatchdog();
  });

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
      version: '0.9.0',
      gateway: gatewaySecret ? 'configured' : 'missing',
      state: stateStore.enabled() ? 'persistent' : 'memory',
      conversation: conversationAi.status(),
      executor: { read: readiness.readyForRead, write: readiness.readyForWrite, deploy: readiness.readyForDeploy },
    };
  });

  // Verify the internal nginx-to-Core trust boundary without exposing its secret.
  // /health deliberately remains a basic process check; this route proves gateway wiring.
  app.get('/gateway/health', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!gatewaySecret) return reply.code(503).send({ ok: false, gateway: 'unavailable' });
    if (request.headers['x-taso-gateway'] !== gatewaySecret) {
      return reply.code(401).send({ ok: false, gateway: 'unauthorized' });
    }
    return reply.send({ ok: true, gateway: 'verified' });
  });

  app.get('/v1/executor', async () => ({ executor: executor.readiness() }));
  app.get('/v1/providers', async () => ({ providers: router.safeSummary() }));
  app.get('/v1/projects', async () => ({ projects: projects.list() }));
  app.get('/v1/missions', async () => ({ missions: tasks.listMissions() }));
  app.get<{ Querystring: { projectId?: string } }>('/v1/conversations', async (request) => ({
    messages: conversations.list(request.query.projectId),
  }));

  app.post<{ Body: ConversationBody }>('/v1/conversations/messages', async (request, reply) => {
    const projectId = typeof request.body?.projectId==='string'?request.body.projectId.trim():'';
    const text = typeof request.body?.text==='string'?request.body.text.trim():'';
    if (!projectId || !text) return reply.code(400).send({ error: 'projectId and text are required.' });
    if(text.length>16000)return reply.code(400).send({error:'Mesaj en fazla 16000 karakter olabilir.'});
    const project = projects.get(projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    if ((project.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Project must be restored before sending messages.' });

    const decision = classifyConversationIntent(text);
    const previousTurns = conversations
      .list(projectId)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-16)
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));
    const userMessage = conversations.append({ projectId, role: 'user', content: text, intent: decision.intent });
    const projectMissions = tasks.listMissions().filter((mission) => mission.projectId === projectId);
    const active = projectMissions.find((mission) => !['completed', 'failed', 'cancelled'].includes(mission.status));

    let content: string;
    let evidence: ConversationEvidence = {mode:'system',sources:[]};
    try {
      const result = await conversationAi.replyDetailed(project, previousTurns, text, {
        webSearch: request.body.webSearch === true,
        activeMission: active ? { id: active.id, objective: active.objective, status: active.status } : undefined,
        recentMissions: projectMissions.slice(0, 5).map((mission) => ({ objective: mission.objective, status: mission.status })),
      });
      content = result.content;
      evidence = result;
    } catch (error) {
      if (decision.intent === 'STATUS') {
        content = active
          ? `${project.name} için aktif görev ${active.status} aşamasında: ${active.objective}`
          : `${project.name} için şu anda aktif görev yok.`;
      } else if (decision.executionRequested) {
        content = `Bu istek yürütme gerektiriyor. ${decision.suggestedRisk ?? 'READ'} sınırıyla bir mission önerebilirim; sen ayrıca onaylamadan hiçbir repository işlemi başlamaz.`;
      } else {
        evidence.mode = 'unavailable';
        content = conversationAi.status().configured
          ? 'AI hizmetinden yanıt alınamadı. Biraz sonra tekrar deneyebilirsin. Mesajın sohbet geçmişine kaydedildi.'
          : 'AI sohbet hizmeti yapılandırılmamış. Yönetici bir AI sağlayıcısını bağlamalı. Mesajın sohbet geçmişine kaydedildi.';
      }
    }

    const assistantMessage = conversations.append({
      projectId,
      role: 'assistant',
      content,
      intent: decision.intent,
      replyMode: evidence.mode,
      sources: evidence.sources,
    });

    return reply.code(evidence.mode==='unavailable'?503:201).send({
      error: evidence.mode==='unavailable'?content:undefined,
      decision,
      userMessage,
      assistantMessage,
      suggestedMission: decision.executionRequested ? {
        objective: text,
        riskLevel: decision.suggestedRisk ?? 'READ',
        dataClass: 'private_code',
      } : undefined,
      conversation: conversationAi.status(),
    });
  });

  app.get<{ Querystring: { limit?: string } }>('/v1/operations', async (request) => {
    const requestedLimit = Number(request.query?.limit);
    return {
      operations: buildOperationsSnapshot({
        projects: projects.list(),
        milestones: milestones.list(),
        missions: tasks.listMissions(),
        events: tasks.allEvents(),
        readiness: executor.readiness(),
        watchdogRunning: true,
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 30,
      }),
    };
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

  app.post<{ Params: { id: string }; Body: { action?: 'archive' | 'trash' | 'restore' } }>('/v1/projects/:id/lifecycle', async (request, reply) => {
    const project = projects.get(request.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    const action = request.body?.action;
    if (action !== 'archive' && action !== 'trash' && action !== 'restore') {
      return reply.code(400).send({ error: 'action must be archive, trash, or restore.' });
    }
    if (action !== 'restore') {
      const unfinished = tasks.listMissions().filter(
        (mission) => mission.projectId === project.id && !['completed', 'failed', 'cancelled'].includes(mission.status),
      );
      if (unfinished.length > 0) {
        return reply.code(409).send({ error: 'Complete or cancel pending missions before changing project lifecycle.', unfinishedMissions: unfinished.length });
      }
    }
    try {
      return { project: projects.setLifecycle(project.id, action) };
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id/manifest', async (request, reply) => {
    if (!projects.get(request.params.id)) return reply.code(404).send({ error: 'Project not found.' });
    const manifest = projects.getManifest(request.params.id);
    if (!manifest) return reply.code(404).send({ error: 'Project manifest not found.' });
    return { manifest };
  });

  app.put<{ Params: { id: string }; Body: UpsertProjectManifestInput }>('/v1/projects/:id/manifest', async (request, reply) => {
    const mutableProject = projects.get(request.params.id);
    if (!mutableProject) return reply.code(404).send({ error: 'Project not found.' });
    if ((mutableProject.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Restore project before editing it.' });
    try {
      return { manifest: projects.upsertManifest(request.params.id, request.body ?? {}) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id/knowledge', async (request, reply) => {
    try {
      return { knowledge: knowledge.list(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string }; Body: CreateProjectKnowledgeInput }>('/v1/projects/:id/knowledge', async (request, reply) => {
    const mutableProject = projects.get(request.params.id);
    if (!mutableProject) return reply.code(404).send({ error: 'Project not found.' });
    if ((mutableProject.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Restore project before editing it.' });
    try {
      return reply.code(201).send({ knowledge: knowledge.create(request.params.id, request.body ?? ({} as CreateProjectKnowledgeInput)) });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.patch<{ Params: { id: string; knowledgeId: string }; Body: UpdateProjectKnowledgeInput }>('/v1/projects/:id/knowledge/:knowledgeId', async (request, reply) => {
    const mutableProject = projects.get(request.params.id);
    if (!mutableProject) return reply.code(404).send({ error: 'Project not found.' });
    if ((mutableProject.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Restore project before editing it.' });
    try {
      return { knowledge: knowledge.update(request.params.id, request.params.knowledgeId, request.body ?? {}) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>('/v1/projects/:id/milestones', async (request, reply) => {
    try {
      if (!projects.get(request.params.id)) return reply.code(404).send({ error: 'Project not found.' });
      return {
        milestones: milestones.list(request.params.id),
        progress: milestones.progress(request.params.id),
      };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string }; Body: CreateProjectMilestoneInput }>('/v1/projects/:id/milestones', async (request, reply) => {
    const mutableProject = projects.get(request.params.id);
    if (!mutableProject) return reply.code(404).send({ error: 'Project not found.' });
    if ((mutableProject.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Restore project before editing it.' });
    try {
      return reply.code(201).send({ milestone: milestones.create(request.params.id, request.body ?? ({} as CreateProjectMilestoneInput)) });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.patch<{ Params: { id: string; milestoneId: string }; Body: UpdateProjectMilestoneInput }>('/v1/projects/:id/milestones/:milestoneId', async (request, reply) => {
    const mutableProject = projects.get(request.params.id);
    if (!mutableProject) return reply.code(404).send({ error: 'Project not found.' });
    if ((mutableProject.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Restore project before editing it.' });
    try {
      return { milestone: milestones.update(request.params.id, request.params.milestoneId, request.body ?? {}) };
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
    if ((projects.get(mission.projectId)?.lifecycleStatus ?? 'active') !== 'active') return reply.code(409).send({ error: 'Project must be restored before executing missions.' });
    executor.executeSoon(mission.id);
    return reply.code(202).send({ mission });
  });

  app.post<{ Params: { id: string } }>('/v1/missions/:id/cancel', async (request, reply) => {
    const mission = tasks.getMission(request.params.id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found.' });
    if (['completed', 'preview_ready', 'failed'].includes(mission.status)) {
      return reply.code(409).send({ error: `Terminal mission cannot be cancelled from ${mission.status}.` });
    }
    return { mission: tasks.cancelMission(request.params.id) };
  });

  registerStudioRoutes(app, projects, studio);
  return app;
}

