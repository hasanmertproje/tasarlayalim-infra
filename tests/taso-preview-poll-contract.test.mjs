import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/taso-urgent-preview-deploy.sh', import.meta.url), 'utf8');
test('read-after-write lookup retries only HTTP 404 with bounded attempts', () => {
  assert.match(script, /if \[\[ "\$code" == 404 \]\]; then printf '%s' '__NOT_VISIBLE__'/);
  assert.match(script, /missing > 6/);
  assert.match(script, /missing=\$\(\(missing\+1\)\)/);
  assert.match(script, /HTTP 404 after bounded retries/);
  assert.match(script, /\[\[ "\$code" =~ \^2 \]\] \|\|/);
});
test('failed deployment remains fail-closed and exact UUID tracked', () => {
  assert.match(script, /failed\|cancelled\|cancelled-by-user\)/);
  assert.match(script, /wait_deployment "\$deployment_uuid" "\$name"/);
  assert.match(script, /deployment_status "\$deployment_uuid"/);
});
