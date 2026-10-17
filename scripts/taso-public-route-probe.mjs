#!/usr/bin/env node
// TASO read-only public route diagnostic. No cookies, tokens or response bodies.
const defaultBase = 'https://taso.tasarlayalim.com';
export const routes = [
  { id: 'ui_root', path: '/', expected: [200] },
  { id: 'ui_static_health', path: '/health', expected: [200] },
  { id: 'core_via_ui', path: '/api/health', expected: [200] },
  { id: 'session_anonymous', path: '/api/auth/session', expected: [200] },
  { id: 'gateway_authenticated_internal', path: '/api/gateway/health', expected: [200] },
  { id: 'projects_anonymous_rejected', path: '/api/v1/projects', expected: [401, 403] },
];
export function classify(route, code) {
  if (code === 0) return 'UNREACHABLE';
  if (route.expected.includes(code)) return 'EXPECTED_STATUS';
  if (code === 401 && !route.id.includes('anonymous_rejected')) return 'UNEXPECTED_401';
  if (code >= 300 && code < 400) return 'REDIRECT';
  return 'UNEXPECTED_STATUS';
}
export async function probe(base, f = fetch) {
  const results = [];
  for (const route of routes) {
    const url = new URL(route.path, base);
    const started = Date.now();
    let code = 0;
    try {
      const resp = await f(url, {
        method: 'GET', redirect: 'manual', cache: 'no-store',
        signal: AbortSignal.timeout(12000),
        headers: { accept: 'application/json, text/plain, text/html' },
      });
      code = resp.status;
      await resp.body?.cancel();
    } catch {
      code = 0;
    }
    results.push({ id: route.id, code, classification: classify(route, code), elapsedMs: Date.now() - started });
  }
  return results;
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const url = process.env.TASO_PUBLIC_BASE_URL || defaultBase;
  if (new URL(url).origin !== defaultBase) {
    console.error('public_origin=INVALID');
    process.exit(2);
  }
  const results = await probe(url);
  console.log('TASO public production route status (no auth headers or response bodies)');
  for (const r of results) console.log(r.id + '=HTTP_' + r.code + ' classification=' + r.classification);
  const failures = results.filter(r => r.classification !== 'EXPECTED_STATUS');
  console.log('public_route_count=' + results.length + ' unexpected=' + failures.length);
  if (failures.length) process.exitCode = 1;
}
