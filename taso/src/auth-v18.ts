import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.js';

type LoginReturn = ReturnType<AuthService['login']>;

/**
 * V18 compatibility wrapper: AuthService.login can return an internal session
 * issuer object when a trusted device skips TOTP. Normalize that object into
 * the same public authenticated response used by the regular login path.
 */
export class AuthServiceV18 extends AuthService {
  override login(
    request: FastifyRequest,
    reply: FastifyReply,
    emailRaw: string | undefined,
    password: string | undefined,
  ): LoginReturn {
    const result = super.login(request, reply, emailRaw, password);
    if (
      result
      && typeof result === 'object'
      && 'expiresAt' in result
      && 'send' in result
      && typeof (result as { send?: unknown }).send === 'function'
      && !('statusCode' in result)
    ) {
      return (result as { send: () => LoginReturn }).send();
    }
    return result;
  }
}
