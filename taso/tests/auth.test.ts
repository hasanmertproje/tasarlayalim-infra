import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService, registerAuthRoutes } from '../src/auth.js';

test('application auth requires credentials and issues revocable HttpOnly session', async () => {
  const previous = {
    email: process.env.TASO_OWNER_EMAIL,
    password: process.env.TASO_OWNER_PASSWORD,
    hash: process.env.TASO_OWNER_PASSWORD_HASH,
    nodeEnv: process.env.NODE_ENV,
    insecure: process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP,
  };

  process.env.NODE_ENV = 'test';
  process.env.TASO_OWNER_EMAIL = 'owner@example.test';
  process.env.TASO_OWNER_PASSWORD = 'correct-horse-battery-staple';
  delete process.env.TASO_OWNER_PASSWORD_HASH;
  delete process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP;

  const app = Fastify({ logger: false });
  const auth = new AuthService();
  registerAuthRoutes(app, auth);

  try {
    const anonymous = await app.inject({ method: 'GET', url: '/auth/session' });
    assert.equal(anonymous.statusCode, 200);
    assert.deepEqual(anonymous.json(), { configured: true, authenticated: false });

    const rejected = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'owner@example.test', password: 'wrong-password' },
    });
    assert.equal(rejected.statusCode, 401);

    const accepted = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'OWNER@example.test', password: 'correct-horse-battery-staple' },
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().authenticated, true);
    const setCookie = accepted.headers['set-cookie'];
    assert.equal(typeof setCookie, 'string');
    assert.match(String(setCookie), /taso_session=/);
    assert.match(String(setCookie), /HttpOnly/);
    assert.match(String(setCookie), /SameSite=Strict/);
    const cookie = String(setCookie).split(';')[0];

    const verified = await app.inject({ method: 'GET', url: '/auth/verify', headers: { cookie } });
    assert.equal(verified.statusCode, 204);

    const session = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().authenticated, true);
    assert.equal(session.json().email, 'owner@example.test');

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    assert.equal(logout.statusCode, 200);
    assert.equal(logout.json().authenticated, false);

    const afterLogout = await app.inject({ method: 'GET', url: '/auth/verify', headers: { cookie } });
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    await app.close();
    if (previous.email === undefined) delete process.env.TASO_OWNER_EMAIL; else process.env.TASO_OWNER_EMAIL = previous.email;
    if (previous.password === undefined) delete process.env.TASO_OWNER_PASSWORD; else process.env.TASO_OWNER_PASSWORD = previous.password;
    if (previous.hash === undefined) delete process.env.TASO_OWNER_PASSWORD_HASH; else process.env.TASO_OWNER_PASSWORD_HASH = previous.hash;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.insecure === undefined) delete process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP; else process.env.TASO_AUTH_ALLOW_INSECURE_BOOTSTRAP = previous.insecure;
  }
});
