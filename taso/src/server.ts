import Fastify from 'fastify';
import type { DataClass, RiskLevel } from './domain.js';
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
  const router = new ProviderRouter(defaultProviders());
  const tasks = new TaskEngine(projects, router);

  app.get('/health', async () => ({
    ok: true,
    service: 'taso-core',
    version: '0.1.0',
  }));

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

  app.post<{ Body: CreateMissionBody }>('/v1/missions', async (request, reply) => {
    try {
      const body = request.body;
      if (!body?.projectId || !body.objective || !isRiskLevel(body.riskLevel) || !isDataClass(body.dataClass)) {
        return reply.code(400).send({
          error: 'projectId, objective, riskLevel and dataClass are required.',
        });
      }

      const mission = tasks.createMission({
        projectId: body.projectId,
        objective: body.objective,
        riskLevel: body.riskLevel,
        dataClass: body.dataClass,
        autonomous: body.autonomous,
      });
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

  app.post<{ Params: { id: string } }>('/v1/missions/:id/approve', async (request, reply) => {
    try {
      return { mission: tasks.approveMission(request.params.id) };
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
