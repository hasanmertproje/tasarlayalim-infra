#!/usr/bin/env node
/**
 * Classify Coolify build/deploy output without printing raw logs.
 * Logs may contain generated configuration and credentials, so only fixed enums
 * are permitted on GitHub Actions output.
 */
import { readFileSync } from 'node:fs';

export function classifyDeploymentFailure(input) {
  const raw = typeof input === 'string' ? input : '';
  const text = raw.replace(/\u001b\[[0-9;]*m/g, '').toLowerCase();
  if (!text.trim()) return 'LOG_UNAVAILABLE';
  if (/no space left on device|not enough space|disk quota exceeded/.test(text)) return 'DISK_CAPACITY';
  if (/npm err!|eresolve|etimedout.*registry|eai_again.*registry|npm ci|npm install|pnpm install|yarn install/.test(text)) return 'DEPENDENCY_INSTALL';
  if (/\bts\d{4}\b|typescript|vite build|tsc -/.test(text)) return 'SOURCE_BUILD';
  if (/err_module_not_found|cannot find module|syntaxerror|referenceerror|uncaught exception|failed to start application/.test(text)) return 'RUNTIME_STARTUP';
  if (/unauthorized|authentication required|denied: requested access|repository not found|invalid username or password/.test(text)) return 'REGISTRY_AUTH';
  if (/health ?check|unhealthy|healthcheck/.test(text)) return 'HEALTHCHECK';
  if (/could not resolve host|enetworkunreach|econnreset|etimedout|enotfound|network is unreachable/.test(text)) return 'NETWORK';
  if (/failed to solve|executor failed running|dockerfile parse error|buildkit/.test(text)) return 'CONTAINER_BUILD';
  return 'UNKNOWN';
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  let payload = '';
  try {
    payload = readFileSync(0, 'utf8');
    const body = JSON.parse(payload);
    const logs = typeof body?.logs === 'string' ? body.logs : '';
    const status = typeof body?.status === 'string' ? body.status.toLowerCase() : 'unknown';
    console.log('preview_deployment_diagnostic status=' + (['failed','cancelled','cancelled-by-user','finished','in_progress','queued'].includes(status) ? status : 'unknown') +
      ' category=' + classifyDeploymentFailure(logs) + ' log_available=' + String(Boolean(logs.trim())));
  } catch {
    console.log('preview_deployment_diagnostic status=unknown category=INVALID_DIAGNOSTIC_PAYLOAD log_available=false');
    process.exitCode = 1;
  }
}
