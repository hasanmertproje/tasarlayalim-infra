import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../.github/workflows/taso-urgent-preview.yml',import.meta.url),'utf8');
test('same PR reruns cannot cancel a workflow that may hold the shared preview lock',()=>{
  const match=source.match(/concurrency:\s*group:\s*taso-urgent-preview-([^\n]+)\n\s*cancel-in-progress:\s*(true|false)/);
  assert.ok(match,'top-level preview concurrency gate must be explicit');
  assert.match(match[1],/github\.event\.pull_request\.number \|\| github\.run_id/);
  assert.equal(match[2],'false','a new commit must not interrupt a running shared-preview mutation');
});
test('shared preview state is globally serialized without cross PR active cancellation',()=>{
  assert.match(source,/deploy-and-verify:\s*#.*\n\s*#.*\n\s*concurrency:\s*group: taso-urgent-preview-shared-resources\s*cancel-in-progress: false/);
});
test('preview job remains fail closed',()=>{
  assert.match(source,/bash -n scripts\/taso-urgent-preview-deploy\.sh/);
  assert.match(source,/bash scripts\/taso-urgent-preview-deploy\.sh/);
});
