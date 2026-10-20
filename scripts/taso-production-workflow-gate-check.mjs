import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/taso-production-deploy.yml',import.meta.url),'utf8');
const jobs=workflow.split('\njobs:\n')[1];
assert.ok(jobs, 'production workflow must have jobs');
const deploy=jobs.match(/(^|\n)  deploy:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|$)/);
assert.ok(deploy, 'production deploy job missing');
assert.match(deploy[2],/^[ \t]+if:\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]/m,
  'production deploy job must require explicit workflow_dispatch');
assert.match(workflow,/workflow_dispatch:/,'manual dispatch trigger must remain available');
assert.doesNotMatch(deploy[2],/if:\s*\$\{\{\s*always\(\)/,'unsafe unconditional deploy override');
console.log('PASS: production deployment requires explicit manual workflow dispatch');
const oneShot=readFileSync(new URL('../.github/workflows/taso-production-one-shot-20261020.yml',import.meta.url),'utf8');
const release=oneShot.split('jobs:\\n')[1]?.match(/(^|\\n)  release:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|$)/);
assert.ok(release,'TASO NEXT one-shot release job missing');
assert.match(oneShot,/branches:\\s*\\[main\\]/,'one-shot release must only react to main pushes');
assert.match(release[2],/if:\\s*github\\.event_name\\s*==\\s*['"]push['"]\\s*&&\\s*github\\.ref\\s*==\\s*['"]refs\\/heads\\/main['"]\\s*&&\\s*startsWith\\(github\\.event\\.head_commit\\.message,\\s*['"]TASO_ONE_SHOT_RELEASE_20261020['"]\\)/,
  'one-shot mutation must require the unique explicitly approved main release marker');
assert.match(release[2],/TASO_ONE_SHOT_BACKUP_WAIVER:\\s*2026-10-20-explicit-operator-waiver/,
  'temporary backup waiver must be dated and single-release scoped');
assert.doesNotMatch(release[2],/github\\.event_name\\s*==\\s*['"]pull_request['"]/,
  'one-shot production mutation must never run from a pull request');
console.log('PASS: one-shot release requires exact main-only marker and dated explicit waiver');
