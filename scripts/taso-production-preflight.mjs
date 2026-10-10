#!/usr/bin/env node

const timeoutMs = Number(process.env.TASO_PREFLIGHT_TIMEOUT_MS || 8000);

const requiredEnv = [
  'TASO_SEARCH_ENDPOINT',
  'TASO_BROWSER_WORKER_URL',
  'TASO_BROWSER_WORKER_SECRET',
  'TASO_SPEAKER_SERVICE_URL',
  'TASO_SPEAKER_SERVICE_SECRET',
];

const missing = requiredEnv.filter((key) => !String(process.env[key] || '').trim());
if (missing.length) {
  console.error(`Missing required production wiring env: ${missing.join(', ')}`);
  process.exit(2);
}

async function request(name, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { name, ok: true, status: response.status };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const search = new URL(process.env.TASO_SEARCH_ENDPOINT);
search.searchParams.set('q', 'OpenAI');
search.searchParams.set('format', 'json');

const browserBase = process.env.TASO_BROWSER_WORKER_URL.replace(/\/$/, '');
const speakerBase = process.env.TASO_SPEAKER_SERVICE_URL.replace(/\/$/, '');

const results = await Promise.all([
  request('web-search', search),
  request('browser-worker', `${browserBase}/health`, {
    headers: { authorization: `Bearer ${process.env.TASO_BROWSER_WORKER_SECRET}` },
  }),
  request('speaker-recognition', `${speakerBase}/health`, {
    headers: { authorization: `Bearer ${process.env.TASO_SPEAKER_SERVICE_SECRET}` },
  }),
]);

for (const result of results) {
  if (result.ok) console.log(`PASS ${result.name} (${result.status})`);
  else console.error(`FAIL ${result.name}: ${result.error}`);
}

if (results.some((result) => !result.ok)) process.exit(1);
console.log('Taso production auxiliary-service preflight passed.');
