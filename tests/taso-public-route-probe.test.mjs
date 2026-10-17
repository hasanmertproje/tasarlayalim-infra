import assert from 'node:assert/strict';
import test from 'node:test';
import { routes, classify, classifyAnonymous401, probe } from '../scripts/taso-public-route-probe.mjs';

test('anonymous projects access must be denied (not HTTP 200)', () => {
  const r = routes.find(x => x.id === 'projects_anonymous_rejected');
  assert.equal(classify(r, 401), 'EXPECTED_STATUS');
  assert.equal(classify(r, 403), 'EXPECTED_STATUS');
  assert.equal(classify(r, 200), 'UNEXPECTED_STATUS');
});
test('401 on UI, Core, gateway, or session must not pass', () => {
  for (const r of routes.filter(x => x.id !== 'projects_anonymous_rejected')) {
    assert.equal(classify(r, 401), 'UNEXPECTED_401');
  }
});
test('classify timeout, unexpected redirect, valid health', () => {
  assert.equal(classify(routes[0], 0), 'UNREACHABLE');
  assert.equal(classify(routes[0], 302), 'REDIRECT');
  assert.equal(classify(routes[0], 200), 'EXPECTED_STATUS');
});
test('probe never sends credentials, logs bodies, or changes state', async () => {
  const seen = [];
  const fake = async (url, options) => {
    seen.push({ url: String(url), options });
    return { status: url.pathname.endsWith('/v1/projects') ? 401 : 200,
      headers: { get: (key) => key === 'content-type' ? 'application/json; charset=utf-8' : null },
      text: async () => '{"error":"Unauthorized session."}',
      body: { cancel: async () => undefined } };
  };
  const result = await probe('https://taso.tasarlayalim.com', fake);
  assert.equal(result.length, routes.length);
  assert.ok(result.every(x => ['EXPECTED_STATUS', 'EXPECTED_ANONYMOUS_DENIAL'].includes(x.classification)));
  assert.ok(seen.every(x => x.options.method === 'GET' &&
    !('authorization' in x.options.headers) && !('cookie' in x.options.headers)));
  assert.ok(seen.every(x => x.url.startsWith('https://taso.tasarlayalim.com/')));
});

test('exact Core Unauthorized gateway rejection is never mistaken for ordinary guest denial', async () => {
  assert.equal(classifyAnonymous401('{"error":"Unauthorized gateway."}'), 'GATEWAY_SECRET_REJECTED');
  assert.equal(classifyAnonymous401('{"error":"Unauthorized session."}'), 'EXPECTED_ANONYMOUS_DENIAL');
  assert.equal(classifyAnonymous401('{"message":"Unauthorized gateway.","error":"Unauthorized"}'), 'GATEWAY_SECRET_REJECTED');
  assert.equal(classifyAnonymous401('<html>Unauthorized gateway.</html>'), 'ANONYMOUS_401_UNCLASSIFIED');
  assert.equal(classifyAnonymous401('{"error":"'+ 'x'.repeat(2100) +'"}'), 'ANONYMOUS_401_UNCLASSIFIED');
});
test('real public endpoint fingerprint flags secret mismatch while keeping response out of results', async () => {
  const fake = async (url) => ({
    status: url.pathname.endsWith('/v1/projects') ? 401 : 200,
    headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
    text: async () => '{"error":"Unauthorized gateway."}',
    body: { cancel: async () => undefined },
  });
  const results = await probe('https://taso.tasarlayalim.com', fake);
  assert.equal(results.at(-1)?.classification, 'GATEWAY_SECRET_REJECTED');
  assert.ok(!JSON.stringify(results).includes('Unauthorized gateway.'));
});
