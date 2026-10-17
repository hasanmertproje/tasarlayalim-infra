import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseUi} from '../scripts/taso-ui-only-live-release.mjs';
const sha='a'.repeat(40);
const base='https://taso.tasarlayalim.com';
const apps=[{name:'taso-ui-prod',uuid:'ui-fixture-123',fqdn:base},{name:'taso-core-prod',uuid:'core-fixture-123',fqdn:''}];
const details={core:{name:'taso-core-prod',git_branch:'main',git_repository:'hasanmertproje/tasarlayalim-infra',
  base_directory:'/taso',environment_id:2,status:'running:healthy'}};
details.ui={...details.core,name:'taso-ui-prod',base_directory:'/taso-ui'};
const respond=(data,status=200)=>({ok:status===200,status,
  json:async()=>data,text:async()=>String(data)});
function fixture({gateway=200,mounts=[{mount_path:'/data'}],depStatus='finished',assetChanges=true,auth=true}={}){
  const calls=[];let deployed=false;
  async function request(url,opt){
    calls.push({url,method:opt.method,redirect:opt.redirect});
    if(url.endsWith('/applications'))return respond(apps);
    if(url.endsWith('applications/core-fixture-123'))return respond(details.core);
    if(url.endsWith('applications/ui-fixture-123'))return respond(details.ui);
    if(url.includes('/deployments/applications/'))return respond([{status:'finished',commit:sha}]);
    if(url.endsWith('core-fixture-123/storages'))return respond({persistent_storages:mounts});
    if(url.endsWith('/api/health'))return respond({ok:true});
    if(url.endsWith('/api/gateway/health'))return respond({},gateway);
    if(url.endsWith('/api/auth/session'))return respond({configured:auth,authenticated:false});
    if(url===base+'/')return respond('<script src="/assets/dashboard-'+(deployed&&assetChanges?'new':'old')+'.js"></script>');
    if(url.includes('deploy?uuid=ui-fixture-123'))return respond({deployments:[{resource_uuid:'ui-fixture-123',deployment_uuid:'ui-deployment-123'}]});
    if(url.endsWith('/deployments/ui-deployment-123')){
      deployed=true;return respond({status:depStatus,commit:sha});
    }
    throw Error('UNEXPECTED_REQUEST');
  }
  return {calls,request};
}
test('only one POST to existing UI after live gateway and storage preflight',async()=>{
  const f=fixture(),messages=[];
  await releaseUi({request:f.request,sha,token:'fixture-token',pause:async()=>{},log:s=>messages.push(s)});
  const writes=f.calls.filter(r=>r.method!=='GET');
  assert.equal(writes.length,1);
  assert.equal(writes[0].method,'POST');
  assert.match(writes[0].url,/deploy\?uuid=ui-fixture-123&force=true$/);
  assert.ok(f.calls.every(r=>r.redirect==='error'));
  assert.ok(messages.some(x=>x.includes('taso_ui_release=SUCCESS')));
  assert.ok(!JSON.stringify(messages).includes('fixture-token'));
});
test('broken gateway fails without a deployment request',async()=>{
  const f=fixture({gateway:404});
  await assert.rejects(releaseUi({request:f.request,sha,token:'fixture-token'}),/EXISTING_LIVE_SYSTEM_UNHEALTHY/);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('Core volume or configured owner boundary missing fails without writes',async()=>{
  for(const options of [{mounts:[]},{mounts:[{mount_path:'/data'},{mount_path:'/data'}]},{auth:false}]){
    const f=fixture(options);
    await assert.rejects(releaseUi({request:f.request,sha,token:'fixture-token'}));
    assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
  }
});
test('deployment failure is not classified as completed',async()=>{
  const f=fixture({depStatus:'failed'});
  await assert.rejects(releaseUi({request:f.request,sha,token:'fixture-token',pause:async()=>{}}),/UI_DEPLOYMENT_FAILED/);
});
test('unchanged UI asset after successful deployment fails acceptance',async()=>{
  const f=fixture({assetChanges:false});
  await assert.rejects(releaseUi({request:f.request,sha,token:'fixture-token',pause:async()=>{}}),/UI_BUILD_ASSET_UNCHANGED/);
});
