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
