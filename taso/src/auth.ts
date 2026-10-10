import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthSecurityStore } from './auth-security.js';

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

type TwoFactorChallenge = {
  id: string;
  kind: 'setup' | 'verify';
  email: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  setupSecret?: string;
};

export type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
  email?: string;
  expiresAt?: string;
  twoFactorEnabled?: boolean;
  trustedDevice?: boolean;
};

const SESSION_COOKIE = 'taso_session';
const TRUSTED_COOKIE = 'taso_trusted_device';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

function cookieHeader(name: string, token: string, ttlMs: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`;
}

function clearCookieHeader(name: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
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

  scryptSync(password, Buffer.from('taso-auth-dummy-salt'), 32);
  return false;
}

function clientKey(request: FastifyRequest, email: string) {
  const forwarded = request.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : request.ip;
  return `${ip || 'unknown'}:${email}`;
}

function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string) {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpCode(secret: string, timeMs: number) {
  const counter = BigInt(Math.floor(timeMs / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function verifyTotp(secret: string, code: string) {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totpCode(secret, now + offset));
    const supplied = Buffer.from(normalized);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

function createRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(10).toString('hex').toUpperCase();
    return raw.match(/.{1,5}/g)!.join('-');
  });
}

function deviceLabel(request: FastifyRequest, requested?: string) {
  if (requested?.trim()) return requested.trim().slice(0, 80);
  const ua = request.headers['user-agent'] || 'Bilinmeyen cihaz';
  if (/android/i.test(ua)) return 'Android cihaz';
  if (/iphone|ipad/i.test(ua)) return 'Apple mobil cihaz';
  if (/windows/i.test(ua)) return 'Windows cihaz';
  if (/macintosh/i.test(ua)) return 'Mac cihaz';
  return 'Tarayıcı cihazı';
}

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly attempts = new Map<string, LoginAttempt>();
  private readonly challenges = new Map<string, TwoFactorChallenge>();
  private readonly email = normalizeEmail(process.env.TASO_OWNER_EMAIL);
  private readonly passwordHash = process.env.TASO_OWNER_PASSWORD_HASH?.trim();
  private readonly ttlMs = Math.max(5 * 60 * 1000, Number(process.env.TASO_SESSION_TTL_MS) || DEFAULT_TTL_MS);
  readonly security = new AuthSecurityStore();

  configured() {
    const hasPassword = Boolean(this.passwordHash) || Boolean(process.env.TASO_OWNER_PASSWORD && (process.env.NODE_ENV !== 'production' || process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP === '1'));
    return Boolean(this.email && hasPassword);
  }

  status(request: FastifyRequest): AuthStatus {
    if (!this.configured()) return { configured: false, authenticated: false };
    const session = this.getSession(request);
    const trusted = this.getTrustedDevice(request);
    if (!session) return {
      configured: true,
      authenticated: false,
      twoFactorEnabled: this.security.hasTotp(),
      trustedDevice: Boolean(trusted),
    };
    return {
      configured: true,
      authenticated: true,
      email: session.email,
      expiresAt: new Date(session.expiresAt).toISOString(),
      twoFactorEnabled: this.security.hasTotp(),
      trustedDevice: Boolean(trusted),
    };
  }

  login(request: FastifyRequest, reply: FastifyReply, emailRaw: string | undefined, password: string | undefined) {
    reply.header('Cache-Control', 'no-store');
    if (!this.configured()) return reply.code(503).send({ error: 'Taso application authentication is not configured.' });

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
    this.cleanupChallenges();

    const trusted = this.getTrustedDevice(request);
    if (this.security.hasTotp() && trusted) {
      request.log.info({ event: 'auth.trusted_device_used', deviceId: trusted.id, email: this.email }, 'Trusted device skipped TOTP');
      return this.issueSession(request, reply);
    }

    if (!this.security.encryptionReady()) {
      return reply.code(503).send({ error: 'Taso 2FA encryption key is not configured.' });
    }

    if (!this.security.hasTotp()) {
      const secret = base32Encode(randomBytes(20));
      const challenge = this.createChallenge('setup', secret);
      const issuer = encodeURIComponent('Taso');
      const account = encodeURIComponent(this.email);
      const otpauthUri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
      request.log.info({ event: 'auth.totp_enrollment_required', email: this.email }, 'TOTP enrollment required');
      return reply.send({
        authenticated: false,
        requiresTwoFactorSetup: true,
        challengeId: challenge.id,
        secret,
        otpauthUri,
      });
    }

    const challenge = this.createChallenge('verify');
    return reply.send({ authenticated: false, requiresTwoFactor: true, challengeId: challenge.id });
  }

  confirmTotpSetup(request: FastifyRequest, reply: FastifyReply, input: { challengeId?: string; code?: string; deviceName?: string }) {
    const challenge = input.challengeId ? this.challenges.get(input.challengeId) : undefined;
    if (!challenge || challenge.kind !== 'setup' || !challenge.setupSecret || challenge.expiresAt <= Date.now()) {
      return reply.code(401).send({ error: '2FA setup challenge expired. Please sign in again.' });
    }
    challenge.attempts += 1;
    if (challenge.attempts > 5) {
      this.challenges.delete(challenge.id);
      return reply.code(429).send({ error: 'Too many invalid Authenticator codes.' });
    }
    if (!input.code || !verifyTotp(challenge.setupSecret, input.code)) {
      return reply.code(401).send({ error: 'Authenticator kodu doğrulanamadı.' });
    }

    this.security.setTotpSecret(challenge.setupSecret);
    const recoveryCodes = createRecoveryCodes();
    this.security.setRecoveryCodes(recoveryCodes);
    this.challenges.delete(challenge.id);
    const trusted = this.issueTrustedDevice(request, reply, input.deviceName);
    const session = this.issueSession(request, reply, [trusted.cookie]);
    request.log.info({ event: 'auth.totp_enabled', email: this.email, deviceId: trusted.record.id }, 'TOTP enabled and device trusted');
    return session.send({
      authenticated: true,
      email: this.email,
      expiresAt: session.expiresAt,
      recoveryCodes,
      trustedDevice: true,
    });
  }

  verifyTwoFactor(request: FastifyRequest, reply: FastifyReply, input: { challengeId?: string; code?: string; deviceName?: string }) {
    const challenge = input.challengeId ? this.challenges.get(input.challengeId) : undefined;
    if (!challenge || challenge.kind !== 'verify' || challenge.expiresAt <= Date.now()) {
      return reply.code(401).send({ error: '2FA challenge expired. Please sign in again.' });
    }
    challenge.attempts += 1;
    if (challenge.attempts > 5) {
      this.challenges.delete(challenge.id);
      return reply.code(429).send({ error: 'Too many invalid Authenticator codes.' });
    }
    const code = input.code?.trim() || '';
    const secret = this.security.getTotpSecret();
    const totpOk = Boolean(secret && verifyTotp(secret, code));
    const recoveryOk = !totpOk && code.length >= 10 && this.security.consumeRecoveryCode(code);
    if (!totpOk && !recoveryOk) return reply.code(401).send({ error: 'Authenticator veya kurtarma kodu doğrulanamadı.' });

    this.challenges.delete(challenge.id);
    const trusted = this.issueTrustedDevice(request, reply, input.deviceName);
    const session = this.issueSession(request, reply, [trusted.cookie]);
    request.log.info({ event: recoveryOk ? 'auth.recovery_code_used' : 'auth.totp_verified', email: this.email, deviceId: trusted.record.id }, 'Second factor verified');
    return session.send({ authenticated: true, email: this.email, expiresAt: session.expiresAt, trustedDevice: true, recoveryCodeUsed: recoveryOk });
  }

  logout(request: FastifyRequest, reply: FastifyReply, forgetDevice = false) {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.get(SESSION_COOKIE);
    if (token) this.sessions.delete(tokenHash(token));
    const headers = [clearCookieHeader(SESSION_COOKIE)];
    if (forgetDevice) {
      const trustedToken = cookies.get(TRUSTED_COOKIE);
      if (trustedToken) {
        const trusted = this.security.validateTrustedDevice(trustedToken);
        if (trusted) this.security.revokeTrustedDevice(trusted.id);
      }
      headers.push(clearCookieHeader(TRUSTED_COOKIE));
    }
    reply.header('Set-Cookie', headers);
    reply.header('Cache-Control', 'no-store');
    request.log.info({ event: 'auth.logout', forgetDevice, ip: request.ip }, 'Taso session logged out');
    return reply.send({ authenticated: false, trustedDeviceForgotten: forgetDevice });
  }

  requireSession(request: FastifyRequest, reply: FastifyReply) {
    if (!this.configured()) return reply.code(503).send({ error: 'Taso application authentication is not configured.' });
    const session = this.getSession(request);
    if (!session) {
      reply.header('Set-Cookie', clearCookieHeader(SESSION_COOKIE));
      return reply.code(401).send({ error: 'Authentication required.' });
    }
    return undefined;
  }

  private createChallenge(kind: TwoFactorChallenge['kind'], setupSecret?: string) {
    const now = Date.now();
    const challenge: TwoFactorChallenge = {
      id: randomBytes(24).toString('base64url'),
      kind,
      email: this.email,
      createdAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
      attempts: 0,
      setupSecret,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  private cleanupChallenges() {
    const now = Date.now();
    for (const [id, challenge] of this.challenges) if (challenge.expiresAt <= now) this.challenges.delete(id);
  }

  private issueSession(request: FastifyRequest, reply: FastifyReply, additionalCookies: string[] = []) {
    const now = Date.now();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + this.ttlMs;
    this.sessions.set(tokenHash(token), {
      email: this.email,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    reply.header('Set-Cookie', [cookieHeader(SESSION_COOKIE, token, this.ttlMs), ...additionalCookies]);
    reply.header('Cache-Control', 'no-store');
    request.log.info({ event: 'auth.login_success', email: this.email, ip: request.ip }, 'Taso login succeeded');
    return {
      expiresAt: new Date(expiresAt).toISOString(),
      send: (body?: Record<string, unknown>) => reply.send(body ?? { authenticated: true, email: this.email, expiresAt: new Date(expiresAt).toISOString() }),
    };
  }

  private issueTrustedDevice(request: FastifyRequest, _reply: FastifyReply, requestedName?: string) {
    const token = randomBytes(32).toString('base64url');
    const days = this.security.trustedDeviceDays();
    const record = this.security.createTrustedDevice({ token, label: deviceLabel(request, requestedName), userAgent: request.headers['user-agent'] });
    return { record, cookie: cookieHeader(TRUSTED_COOKIE, token, days * 24 * 60 * 60 * 1000) };
  }

  private getTrustedDevice(request: FastifyRequest) {
    const token = parseCookies(request.headers.cookie).get(TRUSTED_COOKIE);
    return token ? this.security.validateTrustedDevice(token) : undefined;
  }

  private getSession(request: FastifyRequest) {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
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

  app.post<{ Body: { challengeId?: string; code?: string; deviceName?: string } }>('/auth/2fa/setup/confirm', async (request, reply) => {
    return auth.confirmTotpSetup(request, reply, request.body ?? {});
  });

  app.post<{ Body: { challengeId?: string; code?: string; deviceName?: string } }>('/auth/2fa/verify', async (request, reply) => {
    return auth.verifyTwoFactor(request, reply, request.body ?? {});
  });

  app.post<{ Body: { forgetDevice?: boolean } }>('/auth/logout', async (request, reply) => auth.logout(request, reply, Boolean(request.body?.forgetDevice)));

  app.get('/auth/security', async (request, reply) => {
    const denied = auth.requireSession(request, reply);
    if (denied) return denied;
    return {
      twoFactorEnabled: auth.security.hasTotp(),
      trustedDeviceDays: auth.security.trustedDeviceDays(),
      trustedDevices: auth.security.listTrustedDevices(),
    };
  });

  app.patch<{ Body: { trustedDeviceDays?: number } }>('/auth/security/policy', async (request, reply) => {
    const denied = auth.requireSession(request, reply);
    if (denied) return denied;
    const days = Number(request.body?.trustedDeviceDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) return reply.code(400).send({ error: 'trustedDeviceDays must be between 1 and 365.' });
    return { trustedDeviceDays: auth.security.setTrustedDeviceDays(days) };
  });

  app.delete<{ Params: { id: string } }>('/auth/trusted-devices/:id', async (request, reply) => {
    const denied = auth.requireSession(request, reply);
    if (denied) return denied;
    const revoked = auth.security.revokeTrustedDevice(request.params.id);
    if (!revoked) return reply.code(404).send({ error: 'Trusted device not found.' });
    return { revoked: true };
  });

  app.post('/auth/trusted-devices/revoke-all', async (request, reply) => {
    const denied = auth.requireSession(request, reply);
    if (denied) return denied;
    return { revoked: auth.security.revokeAllTrustedDevices() };
  });

  app.get('/auth/verify', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const denied = auth.requireSession(request, reply);
    if (denied) return denied;
    return reply.code(204).send();
  });
}
