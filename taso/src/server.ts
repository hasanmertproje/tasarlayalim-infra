import Fastify from 'fastify';
import { bootstrapProjects } from './bootstrap-projects.js';
import type { DataClass, RiskLevel } from './domain.js';
import { MissionExecutor } from './mission-executor.js';
import type { UpsertProjectManifestInput } from './project-manifest.js';
import { ProjectRegistry, type CreateProjectInput } from './project-registry.js';
import { ProviderRouter, defaultProviders } from './provider-router.js';
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

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'READ' || value === 'WRITE' || value === 'HIGH_IMPACT';
}

function isDataClass(value: unknown): value is DataClass {
  return value === 'public' || value === 'private_code' || value === 'sensitive';
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const projects = new ProjectRegistry();
  for (const project of bootstrapProjects) projects.create(project);
  const router = new ProviderRouter(defaultProviders());
  const tasks = new TaskEngine(projects, router);
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
      version: '0.4.0',
      gateway: gatewaySecret ? 'configured' : 'missing',
      executor: {
        read: readiness.readyForRead,
        write: readiness.readyForWrite,
        deploy: readiness.readyForDeploy,
      },
    };
  });

  app.get('/v1/executor', async () => ({ executor: executor.readiness() }));
  app.get('/v1/providers', async () => ({ providers: router.safeSummary() }));
  app.get('/v1/projects', async () => ({ projects: projects.list() }));
  app.get('/v1/missions', async () => ({ missions: tasks.listMissions() }));

  app.post<{ Body: CreateProjectInput }>('/v1/projects', async (request, reply) => {
    try {
      const body = request.body;
      if (!body?.slug || !body?.name || !body?.repository || typeof body.isExisting !== 'boolean') {
        return reply.code(400).send({ error: 'slug, name, repository and isExisting are required.' });
      }
      const project = projects.create(body);
      return reply.code(201).send({ project });
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
    try {
      return { events: tasks.listEvents(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
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
    try {
      const mission = tasks.getMission(request.params.id);
      if (!mission) return reply.code(404).send({ error: 'Mission not found.' });
      if (mission.status !== 'queued') return reply.code(409).send({ error: `Mission cannot execute from status ${mission.status}.` });
      executor.executeSoon(mission.id);
      return reply.code(202).send({ mission });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/v1/missions/:id/cancel', async (request, reply) => {
    try {
      return { mission: tasks.cancelMission(request.params.id) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  return app;
}
