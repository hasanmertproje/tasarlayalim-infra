import assert from 'node:assert/strict';
import test from 'node:test';
import { collectHealthMatrix, IncidentStore } from '../src/health-incidents.js';

test('health matrix never invents configured browser/search services', async () => {
  const oldBrowserUrl = process.env.TASO_BROWSER_WORKER_URL;
  const oldBrowserSecret = process.env.TASO_BROWSER_WORKER_SECRET;
  const oldSearch = process.env.TASO_SEARCH_ENDPOINT;
  delete process.env.TASO_BROWSER_WORKER_URL;
  delete process.env.TASO_BROWSER_WORKER_SECRET;
  delete process.env.TASO_SEARCH_ENDPOINT;
  const matrix = await collectHealthMatrix();
  assert.equal(matrix.find((item) => item.id === 'browser-worker')?.state, 'Not configured');
  assert.equal(matrix.find((item) => item.id === 'web-research')?.state, 'Not configured');
  if (oldBrowserUrl === undefined) delete process.env.TASO_BROWSER_WORKER_URL; else process.env.TASO_BROWSER_WORKER_URL = oldBrowserUrl;
  if (oldBrowserSecret === undefined) delete process.env.TASO_BROWSER_WORKER_SECRET; else process.env.TASO_BROWSER_WORKER_SECRET = oldBrowserSecret;
  if (oldSearch === undefined) delete process.env.TASO_SEARCH_ENDPOINT; else process.env.TASO_SEARCH_ENDPOINT = oldSearch;
});

test('incident reconciliation opens and resolves deterministic health incidents', () => {
  const oldFile = process.env.TASO_INCIDENT_FILE;
  delete process.env.TASO_INCIDENT_FILE;
  const store = new IncidentStore();
  const bad = store.reconcile([{ id: 'browser-worker', label: 'Browser Worker', state: 'Unavailable', summary: 'down', checkedAt: new Date().toISOString() }]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]?.state, 'open');
  assert.equal(bad[0]?.severity, 'critical');
  const good = store.reconcile([{ id: 'browser-worker', label: 'Browser Worker', state: 'Healthy', summary: 'ok', checkedAt: new Date().toISOString() }]);
  assert.equal(good[0]?.state, 'resolved');
  if (oldFile === undefined) delete process.env.TASO_INCIDENT_FILE; else process.env.TASO_INCIDENT_FILE = oldFile;
});
