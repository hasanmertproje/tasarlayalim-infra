import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/taso-urgent-preview-deploy.sh', import.meta.url), 'utf8');
test('Coolify API errors expose only method path and status', () => {
  assert.match(script, /Coolify API \$method \$path failed \(HTTP \$\{code:-000\}\)/);
  assert.match(script, /Retry only idempotent GETs on transport errors or 5xx/);\n  assert.match(script, /\"\$method\" == GET && \"\$attempt\" -lt 3/);\n  assert.doesNotMatch(script, /cat "\$RESP"\|jq -r/);
  assert.doesNotMatch(script, /\.message\/\/\.error\/\/empty/);
});
test('secrets are masked and tracing is disabled', () => {
  assert.match(script, /set \+x/);
  assert.match(script, /::add-mask::/);
  assert.match(script, /umask 077/);
});
