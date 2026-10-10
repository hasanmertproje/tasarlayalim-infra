import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.js';
import { ControlPlaneStore, TASO_ANIMATION_PRESETS, type TasoAnimationPreset } from './control-plane-store.js';
import { IdentityStore, type TasoPermission } from './identity-store.js';

function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
  identities: IdentityStore,
  permission: TasoPermission,
) {
  const status = auth.status(request);
  if (!status.authenticated || !status.email) {
    reply.code(401).send({ error: 'Authentication required.' });
    return undefined;
  }
  const user = identities.getUserByEmail(status.email);
  if (!user || !user.active) {
    reply.code(403).send({ error: 'Account is disabled or not registered.' });
    return undefined;
  }
  if (!identities.can(user, permission)) {
    reply.code(403).send({ error: 'Insufficient permission.', permission });
    return undefined;
  }
  return user;
}

export function registerControlPlaneRoutes(
  app: FastifyInstance,
  auth: AuthService,
  identities: IdentityStore,
  store = new ControlPlaneStore(),
) {
  app.get('/control-plane/branding', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'settings.read');
    if (!user) return;
    return { branding: store.getSnapshot().branding, animationPresets: TASO_ANIMATION_PRESETS };
  });

  app.patch<{ Body: {
    assistantName?: string;
    assistantSubtitle?: string;
    iconDataUrl?: string;
    lightIconDataUrl?: string;
    animationPreset?: TasoAnimationPreset;
  } }>('/control-plane/branding', async (request, reply) => {
    const user = requirePermission(request, reply, auth, identities, 'settings.write');
    if (!user) return;
    try {
      const branding = store.updateBranding(request.body ?? {});
      request.log.info({ event: 'control_plane.branding_updated', userId: user.id }, 'Taso branding updated');
      return { branding, animationPresets: TASO_ANIMATION_PRESETS };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
}
