import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../.github/workflows/taso-urgent-preview.yml',import.meta.url),'utf8');
test('same PR cancels old workflow run',()=>{
  assert.match(source,/group: taso-urgent-preview-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}/);
  assert.match(source,/concurrency:\s*group: taso-urgent-preview-.*\n\s*cancel-in-progress: true/);
});
test('shared preview state is globally serialized without cross PR active cancellation',()=>{
  assert.match(source,/deploy-and-verify:\\s*if: github\\.event_name == 'workflow_dispatch'[^\\n]*github\\.event\\.pull_request\\.head\\.repo\\.full_name == github\\.repository/);
  assert.match(source,/group: taso-urgent-preview-shared-resources\\s*cancel-in-progress: false/);
  assert.match(source,/startsWith\\(github\\.base_ref, 'feature\\/taso-'\\)/);
});
test('preview job remains fail closed',()=>{
  assert.match(source,/bash -n scripts\/taso-urgent-preview-deploy\.sh/);
  assert.match(source,/bash scripts\/taso-urgent-preview-deploy\.sh/);
});
