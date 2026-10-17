#!/usr/bin/env node
// TASO read-only public route diagnostic. No cookies, tokens or response bodies in logs.
// A bounded anonymous 401 JSON response is classified only in memory.
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
export function classifyAnonymous401(raw) {
  try {
    if (raw.length > 2048) return 'ANONYMOUS_401_UNCLASSIFIED';
    const data = JSON.parse(raw);
    const error = data && typeof data.error === 'string' ? data.error : '';
    if (error === 'Unauthorized gateway.' || data.message === 'Unauthorized gateway.') return 'GATEWAY_SECRET_REJECTED';
    if (error && error.length <= 256) return 'EXPECTED_ANONYMOUS_DENIAL';
  } catch {
    // Do not print a raw response from a production authentication boundary.
  }
  return 'ANONYMOUS_401_UNCLASSIFIED';
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
      let classification = classify(route, code);
      if (route.id === 'projects_anonymous_rejected' && code === 401) {
        const length = Number(resp.headers?.get('content-length') || 0);
        const type = resp.headers?.get('content-type') || '';
        if (length <= 2048 && type.includes('application/json') && typeof resp.text === 'function') {
          const raw = await resp.text();
          classification = classifyAnonymous401(raw);
        } else {
          classification = 'ANONYMOUS_401_UNCLASSIFIED';
          await resp.body?.cancel();
        }
      } else {
        await resp.body?.cancel();
      }
      results.push({ id: route.id, code, classification, elapsedMs: Date.now() - started });
      continue;
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
  console.log('TASO public production route status (no auth headers; anonymous 401 fingerprint only, no bodies logged)');
  for (const r of results) console.log(r.id + '=HTTP_' + r.code + ' classification=' + r.classification);
  const failures = results.filter(r => !['EXPECTED_STATUS', 'EXPECTED_ANONYMOUS_DENIAL'].includes(r.classification));
  console.log('public_route_count=' + results.length + ' unexpected=' + failures.length);
  if (failures.length) process.exitCode = 1;
}
