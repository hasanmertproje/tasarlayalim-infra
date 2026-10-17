import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedCommit, inventory, storageStatus, gatewayMetadata, collect} from '../scripts/taso-production-release-evidence.mjs';
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
  assert.ok(result.reasons.includes('RUNTIME_IMAGE_UNVERIFIED'));
});
