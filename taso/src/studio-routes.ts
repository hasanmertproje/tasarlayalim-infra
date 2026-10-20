import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ProjectRegistry } from './project-registry.js';
import { StudioError, type StudioMutation, type StudioStore } from './studio-store.js';
import { currentRequestIdentity } from './request-context.js';
import { studioPageHtml } from './studio-export.js';

/** Requires Nginx's /auth/authorize project membership check AND Core's trusted gateway. */
export function registerStudioRoutes(app: FastifyInstance, projects: ProjectRegistry, studio: StudioStore) {
  function authorize(request: FastifyRequest, reply: FastifyReply, write: boolean) {
    const actor = currentRequestIdentity();
    const required = write ? 'projects.write' : 'projects.read';
    // A gateway secret never grants a user identity; Nginx must forward auth_request claims.
    if (!actor.userId || actor.permission !== required ||
        request.headers['x-taso-user-id'] !== actor.userId ||
        request.headers['x-taso-permission'] !== required) {
      reply.code(403).send({ error: 'Studio requires verified project permission.' });
      return undefined;
    }
    return actor.userId;
  }
  function projectCheck(projectId: string, reply: FastifyReply, write: boolean) {
    const project = projects.get(projectId);
    if (!project) {
      reply.code(404).send({ error:'Project not found.' });
      return false;
    }
    if (write && (project.lifecycleStatus ?? 'active') !== 'active') {
      reply.code(409).send({ error:'Restore the project before editing Studio.' });
      return false;
    }
    return true;
  }
  function fail(error: unknown, reply: FastifyReply) {
    if (error instanceof StudioError) return reply.code(error.status).send({ error:error.message });
    requestError(reply);
  }
  function requestError(reply: FastifyReply) {
    return reply.code(500).send({ error:'Studio operation failed.' });
  }
  type Params = { id: string };
  app.get<{ Params: Params }>('/v1/projects/:id/studio', async (request, reply) => {
    if (!authorize(request,reply,false) || !projectCheck(request.params.id,reply,false)) return;
    return { document:studio.get(request.params.id) ?? null };
  });
  app.get<{ Params: Params & { pageId: string }; Querystring: { version?: string } }>('/v1/projects/:id/studio/pages/:pageId/export.html',async(request,reply)=>{
    if (!authorize(request,reply,false) || !projectCheck(request.params.id,reply,false)) return;
    const doc=studio.get(request.params.id);
    if(!doc)return reply.code(404).send({error:'Studio document not initialized.'});
    const requestedVersion=request.query?.version;
    if (requestedVersion!==undefined &&
      (!/^[1-9][0-9]{0,9}$/.test(requestedVersion)||Number(requestedVersion)!==doc.version)) {
      return reply.code(409).send({error:'Studio export source version changed; reload before downloading.'});
    }
    reply.header('X-Taso-Studio-Version',String(doc.version));
    const page=doc.pages.find(p=>p.id===request.params.pageId);
    if(!page)return reply.code(404).send({error:'Studio page not found.'});
    // This is a source artifact, not an executable dashboard route or simulated deploy.
    reply.header('Content-Disposition','attachment; filename="taso-'+page.slug+'.html"');
    reply.header('Cache-Control','private, no-store');
    reply.header('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
    reply.header('X-Content-Type-Options','nosniff');
    return reply.type('text/html; charset=utf-8').send(studioPageHtml(page));
  });
  app.post<{ Params: Params; Body: { title?: string } }>('/v1/projects/:id/studio', async (request, reply) => {
    const actor=authorize(request,reply,true);
    if (!actor || !projectCheck(request.params.id,reply,true)) return;
    try { return reply.code(201).send({ document:studio.create(request.params.id,actor,request.body?.title) }); }
    catch (error) { return fail(error,reply); }
  });
  app.put<{ Params: Params; Body: StudioMutation }>('/v1/projects/:id/studio', async (request, reply) => {
    const actor=authorize(request,reply,true);
    if (!actor || !projectCheck(request.params.id,reply,true)) return;
    try { return { document:studio.replace(request.params.id,actor,request.body ?? {}) }; }
    catch (error) { return fail(error,reply); }
  });
  app.post<{ Params: Params; Body: { expectedVersion?: number; label?: string } }>('/v1/projects/:id/studio/revisions', async (request, reply) => {
    const actor=authorize(request,reply,true);
    if (!actor || !projectCheck(request.params.id,reply,true)) return;
    try { return reply.code(201).send({ document:studio.checkpoint(request.params.id,actor,request.body?.expectedVersion,request.body?.label) }); }
    catch (error) { return fail(error,reply); }
  });
  app.post<{ Params: Params & { revisionId: string }; Body: { expectedVersion?: number } }>('/v1/projects/:id/studio/revisions/:revisionId/restore', async (request, reply) => {
    const actor=authorize(request,reply,true);
    if (!actor || !projectCheck(request.params.id,reply,true)) return;
    try { return { document:studio.restore(request.params.id,actor,request.body?.expectedVersion,request.params.revisionId) }; }
    catch (error) { return fail(error,reply); }
  });
}
