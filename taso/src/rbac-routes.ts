import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.js';
import { IdentityStore, type TasoPermission } from './identity-store.js';

function temporaryPassword() {
  return `${randomBytes(12).toString('base64url')}A9!`;
}

function authenticatedUser(request: FastifyRequest, reply: FastifyReply, auth: AuthService, identities: IdentityStore) {
  const status = auth.status(request);
  if (!status.authenticated || !status.email) {
    reply.code(401).send({ error: 'Authentication required.' });
    return undefined;
  }
  if (status.passwordChangeRequired) {
    reply.code(403).send({ error: 'Password change required before accessing Taso.', code: 'PASSWORD_CHANGE_REQUIRED' });
    return undefined;
  }
  const user = identities.getUserByEmail(status.email);
  if (!user || !user.active) {
    reply.code(403).send({ error: 'Account is disabled or not registered.' });
    return undefined;
  }
  return user;
}

function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
  identities: IdentityStore,
  permission: TasoPermission,
) {
  const user = authenticatedUser(request, reply, auth, identities);
  if (!user) return undefined;
  if (!identities.can(user, permission)) {
    reply.code(403).send({ error: 'Insufficient permission.', permission });
    return undefined;
  }
  return user;
}

export function registerRbacRoutes(app: FastifyInstance, auth: AuthService, identities: IdentityStore) {
  app.get('/auth/me', async (request, reply) => {
    const user = authenticatedUser(request, reply, auth, identities);
    if (!user) return;
    return {
      user,
      permissions: identities.permissionsForUser(user),
      roles: identities.listRoles().filter((role) => user.roleIds.includes(role.id)),
    };
  });

  app.get('/auth/admin/permissions', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'roles.read');
    if (!user) return;
    return { permissions: identities.listPermissions() };
  });

  app.get('/auth/admin/roles', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'roles.read');
    if (!user) return;
    return { roles: identities.listRoles() };
  });

  app.post<{ Body: { name?: string; description?: string; permissions?: string[] } }>('/auth/admin/roles', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'roles.write');
    if (!user) return;
    try {
      return reply.code(201).send({ role: identities.createRole({
        name: request.body?.name ?? '',
        description: request.body?.description,
        permissions: request.body?.permissions,
      }) });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; permissions?: string[] } }>('/auth/admin/roles/:id', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'roles.write');
    if (!user) return;
    try {
      return { role: identities.updateRole(request.params.id, request.body ?? {}) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>('/auth/admin/roles/:id', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'roles.write');
    if (!user) return;
    try {
      if (!identities.deleteRole(request.params.id)) return reply.code(404).send({ error: 'Role not found.' });
      return { deleted: true };
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });

  app.get('/auth/admin/users', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'users.read');
    if (!user) return;
    return { users: identities.listUsers() };
  });

  app.post<{ Body: { email?: string; displayName?: string; roleIds?: string[]; password?: string } }>('/auth/admin/users', async (request, reply) => {
    const actor = requirePermission(request, reply, auth, identities, 'users.write');
    if (!actor) return;
    try {
      const supplied = request.body?.password?.trim();
      const generated = supplied || temporaryPassword();
      const user = identities.createUser({
        email: request.body?.email ?? '',
        displayName: request.body?.displayName,
        roleIds: request.body?.roleIds,
        password: generated,
        passwordChangeRequired: true,
      });
      request.log.info({ event: 'auth.user_created', actorId: actor.id, userId: user.id }, 'Taso user created with one-time credential');
      return reply.code(201).send({
        user,
        temporaryPassword: supplied ? undefined : generated,
        passwordChangeRequired: true,
      });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.patch<{ Params: { id: string }; Body: { displayName?: string; roleIds?: string[]; active?: boolean } }>('/auth/admin/users/:id', async (request, reply) => {
    const actor = requirePermission(request, reply, auth, identities, 'users.write');
    if (!actor) return;
    try {
      const user = identities.updateUser(request.params.id, request.body ?? {});
      if (request.body?.active === false) {
        auth.revokeUserSessions(user.id);
        auth.security.revokeAllTrustedDevices(user.id);
      }
      request.log.info({ event: 'auth.user_updated', actorId: actor.id, userId: user.id, active: user.active }, 'Taso user updated');
      return { user };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post<{ Params: { id: string }; Body: { password?: string } }>('/auth/admin/users/:id/reset-password', async (request, reply) => {
    const actor = requirePermission(request, reply, auth, identities, 'users.write');
    if (!actor) return;
    const target = identities.getUserById(request.params.id);
    if (!target) return reply.code(404).send({ error: 'User not found.' });
    if (target.owner) return reply.code(409).send({ error: 'Owner password is managed by environment configuration.' });
    try {
      const supplied = request.body?.password?.trim();
      const generated = supplied || temporaryPassword();
      const user = identities.setPassword(target.id, generated, true);
      const revokedSessions = auth.revokeUserSessions(target.id);
      const revokedDevices = auth.security.revokeAllTrustedDevices(target.id);
      request.log.warn({ event: 'auth.password_reset', actorId: actor.id, userId: target.id, revokedSessions, revokedDevices }, 'Taso user password reset');
      return {
        user,
        temporaryPassword: supplied ? undefined : generated,
        passwordChangeRequired: true,
        revokedSessions,
        revokedDevices,
      };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
}
