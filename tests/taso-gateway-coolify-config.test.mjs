import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, inspectMetadata } from '../scripts/taso-gateway-coolify-config-check.mjs';

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
test('missing and duplicate keys fail closed and report only metadata', () => {
  assert.equal(evaluate([], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(inspectMetadata([]), 'MISSING');
  assert.equal(evaluate([entry('fixture'), entry('fixture')], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(inspectMetadata([entry('fixture'), entry('fixture')]), 'DUPLICATED');
  assert.equal(inspectMetadata({ error: 'private-content' }), 'INVALID_RESPONSE');
});
test('null, empty and masked values are not accepted as credentials', () => {
  assert.equal(evaluate([{ key: 'TASO_GATEWAY_SECRET', value: null }], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(evaluate([entry('')], [entry('fixture')]), 'UNVERIFIABLE');
  assert.equal(inspectMetadata([entry('')]), 'EMPTY_OR_UNAVAILABLE');
  for (const placeholder of ['***', '********', 'masked', 'REDACTED', '<hidden>', '[hidden]', '••••']) {
    assert.equal(inspectMetadata([entry(placeholder)]), 'MASKED_OR_UNAVAILABLE');
    assert.equal(evaluate([entry(placeholder)], [entry(placeholder)]), 'UNVERIFIABLE');
  }
});
test('explicit real value wins over a masked display placeholder', () => {
  const input = [{ key: 'TASO_GATEWAY_SECRET', value: 'masked', real_value: 'fixture' }];
  assert.equal(evaluate(input, [entry('fixture')]), 'MATCH');
  assert.equal(inspectMetadata(input), 'AVAILABLE');
});
test('diagnostic metadata cannot contain the supplied credentials', () => {
  for (const credential of ['fixture-A-dont-log', 'fixture-B-dont-log']) {
    assert.equal(inspectMetadata([entry(credential)]), 'AVAILABLE');
    assert.ok(!evaluate([entry(credential)], [entry('different-fixture')]).includes(credential));
  }
});
