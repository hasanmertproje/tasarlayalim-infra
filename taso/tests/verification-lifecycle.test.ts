import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveVerificationSnapshot, type VerificationGate } from '../src/verification-lifecycle.js';

function gates(overrides: Partial<Record<string, VerificationGate['state']>> = {}): VerificationGate[] {
  const ids = [
    'core-tests','ci','functional','browser-qa','responsive','visual',
    'auth-security','accessibility','approval',
  ];
  return ids.map((id) => ({ id, label: id, state: overrides[id] ?? 'passed' }));
}

test('verification lifecycle promotes only after required gates pass', () => {
  const verified = deriveVerificationSnapshot({
    missionId: 'mission_demo',
    previewUrl: 'https://preview.example.test',
    gates: gates({ 'auth-security': 'pending', accessibility: 'pending', approval: 'pending' }),
  });
  assert.equal(verified.state, 'VERIFIED_DEMO');
  assert.equal(verified.verifiedDemo, true);
  assert.equal(verified.productionReady, false);
  assert.equal(verified.productionCandidate, true);

  const production = deriveVerificationSnapshot({ missionId: 'mission_prod', gates: gates() });
  assert.equal(production.state, 'PRODUCTION_READY');
  assert.equal(production.productionReady, true);
});

test('failed blocker prevents promotion even when other gates pass', () => {
  const result = deriveVerificationSnapshot({
    missionId: 'mission_blocked',
    gates: gates({ visual: 'failed' }),
  });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blockers.length, 1);
  assert.equal(result.productionReady, false);
});

test('missing demo gates remain preview', () => {
  const result = deriveVerificationSnapshot({
    missionId: 'mission_preview',
    gates: gates({ 'browser-qa': 'pending', responsive: 'pending', visual: 'pending' }),
  });
  assert.equal(result.state, 'PREVIEW');
  assert.equal(result.verifiedDemo, false);
});
