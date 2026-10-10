import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type SessionRecord = {
  email: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent?: string;
  ip?: string;
};

type LoginAttempt = {
  failures: number;
  firstFailureAt: number;
  blockedUntil?: number;
};

export type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
  email?: string;
  expiresAt?: string;
};

const COOKIE_NAME = 'taso_session';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function parseCookies(header: string | undefined) {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result.set(key, decodeURIComponent(value));
  }
  return result;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieHeader(token: string, ttlMs: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`;
}

function clearCookieHeader() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function parseScryptHash(value: string) {
  const [scheme, saltB64, hashB64] = value.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return null;
  try {
    return { salt: Buffer.from(saltB64, 'base64'), hash: Buffer.from(hashB64, 'base64') };
  } catch {
    return null;
  }
}

function verifyPassword(password: string, configuredHash: string | undefined) {
  const parsed = configuredHash ? parseScryptHash(configuredHash) : null;
  if (parsed) {
    const candidate = scryptSync(password, parsed.salt, parsed.hash.length);
    return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
  }

  const insecureBootstrapAllowed = process.env.NODE_ENV !== 'production' || process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP === '1';
  const insecurePassword = process.env.TASO_OWNER_PASSWORD;
  if (insecureBootstrapAllowed && insecurePassword) {
    const a = Buffer.from(password);
    const b = Buffer.from(insecurePassword);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // Burn comparable work so an unconfigured account does not become a cheap timing oracle.
  scryptSync(password, Buffer.from('taso-auth-dummy-salt'), 32);
  return false;
}

function clientKey(request: FastifyRequest, email: string) {
  const forwarded = request.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : request.ip;
  return `${ip || 'unknown'}:${email}`;
}

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly attempts = new Map<string, LoginAttempt>();
  private readonly email = normalizeEmail(process.env.TASO_OWNER_EMAIL);
  private readonly passwordHash = process.env.TASO_OWNER_PASSWORD_HASH?.trim();
  private readonly ttlMs = Math.max(5 * 60 * 1000, Number(process.env.TASO_SESSION_TTL_MS) || DEFAULT_TTL_MS);

  configured() {
    const hasPassword = Boolean(this.passwordHash) || Boolean(process.env.TASO_OWNER_PASSWORD && (process.env.NODE_ENV !== 'production' || process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP === '1'));
    return Boolean(this.email && hasPassword);
  }

  status(request: FastifyRequest): AuthStatus {
    if (!this.configured()) return { configured: false, authenticated: false };
    const session = this.getSession(request);
    if (!session) return { configured: true, authenticated: false };
    return {
      configured: true,
      authenticated: true,
      email: session.email,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  login(request: FastifyRequest, reply: FastifyReply, emailRaw: string | undefined, password: string | undefined) {
    reply.header('Cache-Control', 'no-store');
    if (!this.configured()) {
      return reply.code(503).send({ error: 'Taso application authentication is not configured.' });
    }

    const email = normalizeEmail(emailRaw);
    const key = clientKey(request, email);
    const now = Date.now();
    const attempt = this.attempts.get(key);
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      reply.header('Retry-After', String(Math.ceil((attempt.blockedUntil - now) / 1000)));
      return reply.code(429).send({ error: 'Too many failed login attempts. Try again later.' });
    }
    if (attempt && now - attempt.firstFailureAt > ATTEMPT_WINDOW_MS) this.attempts.delete(key);

    const passwordOk = typeof password === 'string' && verifyPassword(password, this.passwordHash);
    const valid = email === this.email && passwordOk;
    if (!valid) {
      const current = this.attempts.get(key);
      const next: LoginAttempt = current && now - current.firstFailureAt <= ATTEMPT_WINDOW_MS
        ? { ...current, failures: current.failures + 1 }
        : { failures: 1, firstFailureAt: now };
      if (next.failures >= MAX_FAILURES) next.blockedUntil = now + BLOCK_MS;
      this.attempts.set(key, next);
      request.log.warn({ event: 'auth.login_failed', email, ip: request.ip }, 'Taso login failed');
      return reply.code(401).send({ error: 'E-posta veya şifre hatalı.' });
    }

    this.attempts.delete(key);
    const token = randomBytes(32).toString('base64url');
    const digest = tokenHash(token);
    const expiresAt = now + this.ttlMs;
    this.sessions.set(digest, {
      email: this.email,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    reply.header('Set-Cookie', cookieHeader(token, this.ttlMs));
    request.log.info({ event: 'auth.login_success', email: this.email, ip: request.ip }, 'Taso login succeeded');
    return reply.send({ authenticated: true, email: this.email, expiresAt: new Date(expiresAt).toISOString() });
  }

  logout(request: FastifyRequest, reply: FastifyReply) {
    const token = parseCookies(request.headers.cookie).get(COOKIE_NAME);
    if (token) this.sessions.delete(tokenHash(token));
    reply.header('Set-Cookie', clearCookieHeader());
    reply.header('Cache-Control', 'no-store');
    request.log.info({ event: 'auth.logout', ip: request.ip }, 'Taso session logged out');
    return reply.send({ authenticated: false });
  }

  requireSession(request: FastifyRequest, reply: FastifyReply) {
    if (!this.configured()) return reply.code(503).send({ error: 'Taso application authentication is not configured.' });
    const session = this.getSession(request);
    if (!session) {
      reply.header('Set-Cookie', clearCookieHeader());
      return reply.code(401).send({ error: 'Authentication required.' });
    }
    return undefined;
  }

  private getSession(request: FastifyRequest) {
    const token = parseCookies(request.headers.cookie).get(COOKIE_NAME);
    if (!token) return undefined;
    const digest = tokenHash(token);
    const session = this.sessions.get(digest);
    if (!session) return undefined;
    const now = Date.now();
    if (session.expiresAt <= now) {
      this.sessions.delete(digest);
      return undefined;
    }
    session.lastSeenAt = now;
    return session;
  }
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  app.get('/auth/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return auth.status(request);
  });

  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (request, reply) => {
    const body = request.body ?? {};
    return auth.login(request, reply, body.email, body.password);
  });

  app.post('/auth/logout', async (request, reply) => auth.logout(request, reply));

  // nginx auth_request expects 2xx for an authenticated request and 401 otherwise.
  app.get('/auth/verify', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const denied = auth.requireSession(request, reply);
    if (denied) return denied;
    return reply.code(204).send();
  });
}
