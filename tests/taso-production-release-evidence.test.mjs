import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedCommit, inventory, storageStatus, gatewayMetadata, deploymentState, gatewayLogSignal, gatewayLogProbe, s3TargetState, collect} from '../scripts/taso-production-release-evidence.mjs';
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const names = ['taso-ui-prod','taso-core-prod','taso-search-prod','taso-browser-prod','taso-speaker-prod','taso-voice-prod'];
const apps = names.map((name,i) => ({name,uuid:'sample'+i+'uuid',fqdn:i===0?'https://taso.tasarlayalim.com':''}));

test('unique domain owner and duplicate resources fail closed', () => {
  assert.equal(inventory(apps).domain,'UNIQUE');
  assert.equal(inventory([...apps, apps[0]]).domain,'CONFLICT');
  assert.equal(inventory([...apps, apps[0]]).rows[0].match,'AMBIGUOUS');
});
test('finished history excludes failures and invalid SHAs', () => {
  assert.equal(finishedCommit([{status:'failed',commit:other,created_at:'2026-10-17T20:00:00Z'},
    {status:'finished',commit:sha,created_at:'2026-10-17T18:00:00Z'}]),sha);
  assert.equal(finishedCommit({deployments:[{status:'finished',commit:other}]}),other);
  assert.equal(finishedCommit([{status:'finished',commit:'bad'}]),'UNKNOWN');
  assert.equal(finishedCommit({data:[]}), 'UNKNOWN');
});
test('storage and key metadata never assert secrets or backups exist', () => {
  assert.equal(storageStatus(null,'/data'),'UNVERIFIABLE');
  assert.equal(storageStatus({persistent_storages:[]},'/data'),'MISSING');
  assert.equal(storageStatus({persistent_storages:[{mount_path:'/data'}]},'/data'),'PRESENT');
  assert.equal(storageStatus({persistent_storages:[{mount_path:'/data'},{mount_path:'/data'}]},'/data'),'DUPLICATED');
  assert.equal(gatewayMetadata([{key:'TASO_GATEWAY_SECRET',real_value:'test-private-value'}]),'KEY_PRESENT_VALUE_UNVERIFIED');
  assert.equal(gatewayMetadata([{key:'TASO_GATEWAY_SECRET'},{key:'TASO_GATEWAY_SECRET'}]),'DUPLICATED');
  assert.equal(gatewayMetadata([]),'MISSING');
});
test('read-only contract: GET requests, no secret output, NO_GO until proven', async () => {
  const paths=[];
  const mock=async(url,options)=>{
    paths.push({url,method:options.method});
    const path=url.replace('https://coolify.tasarlayalim.com/api/v1/','');
    let data=null;
    if(path==='applications') data=apps;
    else if(path==='s3-storages') data=[{is_usable:true,secret:'invisible-secret'}];
    else if(path.endsWith('/envs')) data=[{key:'TASO_GATEWAY_SECRET',real_value:'invisible-secret'}];
    else if(path.endsWith('/storages')) data={persistent_storages:[{mount_path:'/data'},{mount_path:'/voices'}]};
    else if(path.startsWith('deployments/applications/')) data=[{status:'finished',commit:sha}];
    else if(path.includes('/logs?lines=100')) data={logs:'Sensitive owner token invisible-secret. Unauthorized gateway.'};
    else if(path.startsWith('applications/')) data={status:'running:healthy',git_branch:'main'};
    else throw Error('unexpected path');
    return {ok:true,json:async()=>data};
  };
  const result=await collect(mock,'fake-token',other);
  assert.equal(result.decision,'NO_GO');
  assert.equal(result.atHead,false);
  assert.equal(result.offsite,'USABLE_TARGET_ONLY');
  assert.ok(paths.every(p=>p.method==='GET'));
  assert.ok(!JSON.stringify(result).includes('invisible-secret'));
  assert.equal(result.gatewayLogs['taso-ui-prod'],'UNAUTHORIZED_GATEWAY_OBSERVED');
  assert.equal(result.reports[0].rollbackCandidate,sha);
  assert.equal(result.reports[0].pendingDeployments,0);
  assert.ok(result.reasons.includes('RUNTIME_IMAGE_UNVERIFIED'));
});

test('rollback history is a candidate only, never a verified rollback',()=>{
  const state=deploymentState([
    {status:'finished',commit:sha,created_at:'2026-10-17T10:00:00Z'},
    {status:'failed',commit:other,created_at:'2026-10-17T11:00:00Z'},
    {status:'queued',commit:other,created_at:'2026-10-17T12:00:00Z'}
  ]);
  assert.equal(state.rollbackCandidate,sha);
  assert.equal(state.lastFailedCommit,other);
  assert.equal(state.pendingDeployments,1);
  assert.equal(deploymentState(null).rollbackCandidate,'UNVERIFIABLE');
});
test('logs and backup metadata redact all sensitive content',()=>{
  assert.equal(gatewayLogSignal({logs:'credential=SENSITIVE Unauthorized gateway.'}),'UNAUTHORIZED_GATEWAY_OBSERVED');
  assert.equal(gatewayLogSignal({logs:'Authorization=SECRET'}),'NOT_OBSERVED_IN_LAST_100_LINES');
  assert.equal(gatewayLogSignal(null),'UNVERIFIABLE');
  assert.equal(s3TargetState([]),'NOT_CONFIGURED');
  assert.equal(s3TargetState([{is_usable:false}]),'CONFIGURED_NOT_USABLE');
  assert.equal(s3TargetState([{is_usable:true}]),'USABLE_TARGET_ONLY');
  assert.equal(s3TargetState(null),'UNVERIFIABLE');
});

test('restricted Coolify log API reports permission instead of obscuring the blocker',async()=>{
  const requests=[];
  const stub=status=>async(url,options)=>{
    requests.push({url,method:options.method,redirect:options.redirect});
    return {ok:status===200,status,json:async()=>({logs:'BEARER_NEVER_LOG Unauthorized gateway.'})};
  };
  const uuid='exampleknownappuuid';
  assert.equal(await gatewayLogProbe(stub(403),'fixture-token',uuid),'API_PERMISSION_DENIED');
  assert.equal(await gatewayLogProbe(stub(401),'fixture-token',uuid),'API_PERMISSION_DENIED');
  assert.equal(await gatewayLogProbe(stub(404),'fixture-token',uuid),'LOG_RESOURCE_UNAVAILABLE');
  assert.equal(await gatewayLogProbe(stub(503),'fixture-token',uuid),'COOLIFY_HTTP_ERROR');
  assert.equal(await gatewayLogProbe(stub(200),'fixture-token',uuid),'UNAUTHORIZED_GATEWAY_OBSERVED');
  assert.equal(await gatewayLogProbe(async()=>{throw Error('secret-internal-error')},'fixture-token',uuid),'LOG_REQUEST_UNVERIFIABLE');
  assert.equal(await gatewayLogProbe(stub(200),'fixture-token','../escape'),'INVALID_TARGET');
  assert.equal(requests.length,5);
  assert.ok(requests.every(r=>r.method==='GET'&&r.redirect==='error'));
  assert.ok(requests.every(r=>r.url.startsWith('https://coolify.tasarlayalim.com/api/v1/applications/')));
});
