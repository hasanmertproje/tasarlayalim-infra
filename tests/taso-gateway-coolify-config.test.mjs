import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../scripts/taso-gateway-coolify-config-check.mjs';

const entry = (value, is_preview = false) => ({
  key: 'TASO_GATEWAY_SECRET', value, is_preview,
});

test('same authoritative production values are equal', () => {
  assert.equal(evaluate([entry('fixture-only')], [entry('fixture-only')]), 'MATCH');
});
test('different production values report a mismatch without disclosure', () => {
  const result = evaluate([entry('fixture-A')], [entry('fixture-B')]);
  assert.equal(result, 'MISMATCH');
  assert.ok(!result.includes('fixture'));
});
test('preview-specific values never override production values', () => {
  assert.equal(evaluate(
    [entry('fixture-P', true), entry('fixture-C')],
    [entry('fixture-U', true), entry('fixture-C')],
  ), 'MATCH');
});
test('missing, duplicate and masked values fail closed', () => {
  assert.equal(evaluate([], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(evaluate([entry('fixture'), entry('fixture')], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(evaluate([{ key: 'TASO_GATEWAY_SECRET', value: null }], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(evaluate([entry('')], [entry('fixture')]), 'UNVERIFIABLE');
});
test('explicit real value wins over a masked display placeholder', () => {
  const input = [{ key: 'TASO_GATEWAY_SECRET', value: 'masked', real_value: 'fixture' }];
  assert.equal(evaluate(input, [entry('fixture')]), 'MATCH');
});
