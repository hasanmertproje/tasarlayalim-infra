// Contract: all feature-branch PRs get CI and browser validation.
// Preview receives Coolify secrets only for same-repository TASO stack or main PRs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const files=['ci.yml','taso-browser-ci.yml','taso-urgent-preview.yml'];
for(const name of files){
  const workflow=read('.github/workflows/'+name);
  assert.match(workflow,/^\s{2}pull_request:\s*$/m,name+' must accept stacked PR bases');
  assert.doesNotMatch(workflow,/pull_request:\n\s+branches:/,name+' must not silently exclude future stacked PRs');
  if(name==='taso-urgent-preview.yml'){
    assert.match(workflow,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
    assert.match(workflow,/startsWith\(github\.base_ref, 'feature\/taso-'\)/);
    assert.match(workflow,/group: taso-urgent-preview-shared-resources/);
    assert.match(workflow,/cancel-in-progress: false/);
    assert.match(workflow,/secrets\.COOLIFY_API_TOKEN/);
    assert.match(workflow,/paths:\n\s+- "taso\/\*\*"/);
  }else{
    assert.doesNotMatch(workflow,/secrets\.COOLIFY_API_TOKEN/);
  }
}
const prod=read('.github/workflows/taso-production-deploy.yml');
assert.match(prod,/workflow_dispatch:/);
assert.match(prod,/taso-production-ui-retry-compat\.sh/);
console.log('taso_next_stack_ci_contract=PASS trigger=all_prs preview=in_repo_taso_branches serialized=true production=unchanged');
