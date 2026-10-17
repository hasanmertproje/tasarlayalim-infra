import assert from 'node:assert/strict';
import test from 'node:test';
import { routes, classify, probe } from '../scripts/taso-public-route-probe.mjs';

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
test('probe never sends credentials, reads bodies, or changes state', async () => {
  const seen = [];
  const fake = async (url, options) => {
    seen.push({ url: String(url), options });
    return { status: url.pathname.endsWith('/v1/projects') ? 401 : 200,
      body: { cancel: async () => undefined } };
  };
  const result = await probe('https://taso.tasarlayalim.com', fake);
  assert.equal(result.length, routes.length);
  assert.ok(result.every(x => x.classification === 'EXPECTED_STATUS'));
  assert.ok(seen.every(x => x.options.method === 'GET' &&
    !('authorization' in x.options.headers) && !('cookie' in x.options.headers)));
  assert.ok(seen.every(x => x.url.startsWith('https://taso.tasarlayalim.com/')));
});
