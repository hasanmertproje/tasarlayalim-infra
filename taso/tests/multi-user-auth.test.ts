import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAuthRoutes } from '../src/auth.js';
import { AuthServiceV18 } from '../src/auth-v18.js';
import { IdentityStore } from '../src/identity-store.js';

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

test('non-owner credentials use isolated TOTP and require first-login password rotation', async () => {
  const keys = [
    'NODE_ENV','TASO_OWNER_EMAIL','TASO_OWNER_PASSWORD','TASO_OWNER_PASSWORD_HASH',
    'TASO_GATEWAY_SECRET','TASO_AUTH_ENCRYPTION_KEY','TASO_AUTH_SECURITY_FILE','TASO_IDENTITY_FILE',
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = 'test';
  process.env.TASO_GATEWAY_SECRET = 'multi-user-auth-test-gateway-secret';
  delete process.env.TASO_OWNER_EMAIL;
  delete process.env.TASO_OWNER_PASSWORD;
  delete process.env.TASO_OWNER_PASSWORD_HASH;
  delete process.env.TASO_AUTH_SECURITY_FILE;
  delete process.env.TASO_IDENTITY_FILE;

  const identities = new IdentityStore('');
  const alice = identities.createUser({
    email: 'alice@example.test',
    displayName: 'Alice',
    roleIds: ['role_viewer'],
    password: 'temporary-pass-123!',
    passwordChangeRequired: true,
  });
  const bob = identities.createUser({
    email: 'bob@example.test',
    displayName: 'Bob',
    roleIds: ['role_viewer'],
    password: 'temporary-pass-456!',
    passwordChangeRequired: true,
  });

  const auth = new AuthServiceV18(identities);
  const app = Fastify({ logger: false });
  registerAuthRoutes(app, auth);

  try {
    const aliceLogin = await app.inject({ method:'POST', url:'/auth/login', payload:{ email:alice.email, password:'temporary-pass-123!' } });
    assert.equal(aliceLogin.statusCode, 200);
    assert.equal(aliceLogin.json().requiresTwoFactorSetup, true);
    const aliceSetup = aliceLogin.json();

    const aliceEnroll = await app.inject({
      method:'POST', url:'/auth/2fa/setup/confirm',
      payload:{ challengeId:aliceSetup.challengeId, code:currentTotp(aliceSetup.secret), deviceName:'Alice test device' },
    });
    assert.equal(aliceEnroll.statusCode, 200);
    assert.equal(aliceEnroll.json().passwordChangeRequired, true);
    const aliceCookie = cookiesFrom(aliceEnroll.headers['set-cookie']).find((entry) => entry.startsWith('taso_session='));
    assert.ok(aliceCookie);

    const blocked = await app.inject({ method:'GET', url:'/auth/verify', headers:{ cookie:aliceCookie! } });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().code, 'PASSWORD_CHANGE_REQUIRED');

    const bobLogin = await app.inject({ method:'POST', url:'/auth/login', payload:{ email:bob.email, password:'temporary-pass-456!' } });
    assert.equal(bobLogin.statusCode, 200);
    assert.equal(bobLogin.json().requiresTwoFactorSetup, true);
    assert.notEqual(bobLogin.json().secret, aliceSetup.secret);
    assert.equal(auth.security.hasTotp(alice.id), true);
    assert.equal(auth.security.hasTotp(bob.id), false);

    const changed = await app.inject({
      method:'POST', url:'/auth/password/change', headers:{ cookie:aliceCookie! },
      payload:{ currentPassword:'temporary-pass-123!', newPassword:'permanent-password-789!' },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().changed, true);
    assert.equal(identities.getUserById(alice.id)?.passwordChangeRequired, false);

    const oldLogin = await app.inject({ method:'POST', url:'/auth/login', payload:{ email:alice.email, password:'temporary-pass-123!' } });
    assert.equal(oldLogin.statusCode, 401);
    const newLogin = await app.inject({ method:'POST', url:'/auth/login', payload:{ email:alice.email, password:'permanent-password-789!' } });
    assert.equal(newLogin.statusCode, 200);
    assert.equal(newLogin.json().requiresTwoFactor, true);
  } finally {
    await app.close();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
