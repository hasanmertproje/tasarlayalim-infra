import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAuthRoutes } from '../src/auth.js';
import { AuthServiceV18 } from '../src/auth-v18.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of input.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const index = ALPHABET.indexOf(character);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string) {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function cookiesFrom(header: string | string[] | undefined) {
  const headers = Array.isArray(header) ? header : header ? [header] : [];
  return headers.map((entry) => entry.split(';')[0]!).filter(Boolean);
}

function cookieValue(cookies: string[], name: string) {
  return cookies.find((entry) => entry.startsWith(`${name}=`));
}

test('TOTP enrollment trusts a device, skips repeat 2FA, and supports revoke', async () => {
  const keys = [
    'TASO_OWNER_EMAIL', 'TASO_OWNER_PASSWORD', 'TASO_OWNER_PASSWORD_HASH', 'NODE_ENV',
    'TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP', 'TASO_GATEWAY_SECRET', 'TASO_AUTH_ENCRYPTION_KEY',
    'TASO_AUTH_SECURITY_FILE', 'TASO_IDENTITY_FILE',
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  process.env.NODE_ENV = 'test';
  process.env.TASO_OWNER_EMAIL = 'owner@example.test';
  process.env.TASO_OWNER_PASSWORD = 'correct-horse-battery-staple';
  process.env.TASO_GATEWAY_SECRET = 'test-gateway-secret-for-auth-derivation';
  delete process.env.TASO_OWNER_PASSWORD_HASH;
  delete process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP;
  delete process.env.TASO_AUTH_SECURITY_FILE;
  delete process.env.TASO_IDENTITY_FILE;

  const app = Fastify({ logger: false });
  const auth = new AuthServiceV18();
  registerAuthRoutes(app, auth);

  try {
    const anonymous = await app.inject({ method: 'GET', url: '/auth/session' });
    assert.equal(anonymous.statusCode, 200);
    assert.equal(anonymous.json().configured, true);
    assert.equal(anonymous.json().authenticated, false);

    const rejected = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@example.test', password: 'wrong-password' } });
    assert.equal(rejected.statusCode, 401);

    const initialLogin = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'OWNER@example.test', password: 'correct-horse-battery-staple' },
    });
    assert.equal(initialLogin.statusCode, 200);
    const setup = initialLogin.json();
    assert.equal(setup.authenticated, false);
    assert.equal(setup.requiresTwoFactorSetup, true);
    assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);
    assert.ok(setup.secret);

    const enrollment = await app.inject({
      method: 'POST', url: '/auth/2fa/setup/confirm',
      payload: { challengeId: setup.challengeId, code: currentTotp(setup.secret), deviceName: 'Test phone' },
    });
    assert.equal(enrollment.statusCode, 200);
    const enrolled = enrollment.json();
    assert.equal(enrolled.authenticated, true);
    assert.equal(enrolled.trustedDevice, true);
    assert.equal(enrolled.recoveryCodes.length, 10);
    const enrolledCookies = cookiesFrom(enrollment.headers['set-cookie']);
    const sessionCookie = cookieValue(enrolledCookies, 'taso_session');
    const trustedCookie = cookieValue(enrolledCookies, 'taso_trusted_device');
    assert.ok(sessionCookie);
    assert.ok(trustedCookie);
    assert.match(String(enrollment.headers['set-cookie']), /HttpOnly/);
    assert.match(String(enrollment.headers['set-cookie']), /SameSite=Strict/);

    const verified = await app.inject({ method: 'GET', url: '/auth/verify', headers: { cookie: `${sessionCookie}; ${trustedCookie}` } });
    assert.equal(verified.statusCode, 204);

    const security = await app.inject({ method: 'GET', url: '/auth/security', headers: { cookie: `${sessionCookie}; ${trustedCookie}` } });
    assert.equal(security.statusCode, 200);
    assert.equal(security.json().twoFactorEnabled, true);
    assert.equal(security.json().trustedDeviceDays, 30);
    assert.equal(security.json().trustedDevices.length, 1);
    assert.equal(security.json().trustedDevices[0].label, 'Test phone');
    assert.equal('tokenHash' in security.json().trustedDevices[0], false);

    const policy = await app.inject({
      method: 'PATCH', url: '/auth/security/policy', headers: { cookie: `${sessionCookie}; ${trustedCookie}` },
      payload: { trustedDeviceDays: 60 },
    });
    assert.equal(policy.statusCode, 200);
    assert.equal(policy.json().trustedDeviceDays, 60);

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: `${sessionCookie}; ${trustedCookie}` }, payload: {} });
    assert.equal(logout.statusCode, 200);

    const trustedLogin = await app.inject({
      method: 'POST', url: '/auth/login', headers: { cookie: trustedCookie },
      payload: { email: 'owner@example.test', password: 'correct-horse-battery-staple' },
    });
    assert.equal(trustedLogin.statusCode, 200);
    assert.equal(trustedLogin.json().authenticated, true);
    const trustedLoginSession = cookieValue(cookiesFrom(trustedLogin.headers['set-cookie']), 'taso_session');
    assert.ok(trustedLoginSession);

    const forget = await app.inject({
      method: 'POST', url: '/auth/logout', headers: { cookie: `${trustedLoginSession}; ${trustedCookie}` },
      payload: { forgetDevice: true },
    });
    assert.equal(forget.statusCode, 200);
    assert.equal(forget.json().trustedDeviceForgotten, true);

    const untrustedLogin = await app.inject({
      method: 'POST', url: '/auth/login', headers: { cookie: trustedCookie },
      payload: { email: 'owner@example.test', password: 'correct-horse-battery-staple' },
    });
    assert.equal(untrustedLogin.statusCode, 200);
    const challenge = untrustedLogin.json();
    assert.equal(challenge.authenticated, false);
    assert.equal(challenge.requiresTwoFactor, true);

    const secret = auth.security.getTotpSecret();
    assert.ok(secret);
    const secondFactor = await app.inject({
      method: 'POST', url: '/auth/2fa/verify',
      payload: { challengeId: challenge.challengeId, code: currentTotp(secret!), deviceName: 'Replacement device' },
    });
    assert.equal(secondFactor.statusCode, 200);
    assert.equal(secondFactor.json().authenticated, true);
    assert.equal(secondFactor.json().trustedDevice, true);
  } finally {
    await app.close();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
