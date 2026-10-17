import test from 'node:test';
import assert from 'node:assert/strict';
import {identify,verifyDetail,verifyMount,verifyHistory,verifySession,queuedDeployment,run} from '../scripts/taso-core-ui-live-recover.mjs';
const SHA='a'.repeat(40), HOST='https://taso.tasarlayalim.com';
const apps=[{name:'taso-ui-prod',uuid:'ui-123456',fqdn:HOST},{name:'taso-core-prod',uuid:'core-123456',fqdn:''}];
const core={name:'taso-core-prod',git_branch:'main',git_repository:'hasanmertproje/tasarlayalim-infra',base_directory:'/taso',environment_id:2,status:'running:healthy'};
const ui={...core,name:'taso-ui-prod',base_directory:'/taso-ui'};
function response(body,status=200){return {ok:status===200,status,json:async()=>body,text:async()=>typeof body==='string'?body:JSON.stringify(body)};}
test('reject ambiguous resources and domain ownership',()=>{
 assert.equal(identify(apps)['taso-ui-prod'].uuid,'ui-123456');
 assert.throws(()=>identify([...apps,apps[0]]),/IDENTITY_AMBIGUOUS/);
 assert.throws(()=>identify([...apps,{name:'any',uuid:'other-123456',fqdn:HOST}]),/DOMAIN_NOT_UNIQUE_UI/);
});
test('fail closed on wrong identity, unhealthy Core, missing volume and session',()=>{
 assert.equal(verifyDetail(core,'taso-core-prod','/taso'),true);
 assert.throws(()=>verifyDetail({...core,status:'running:unknown'},'taso-core-prod','/taso'),/NOT_HEALTHY/);
 assert.throws(()=>verifyDetail({...core,git_branch:'dev'},'taso-core-prod','/taso'),/SOURCE_IDENTITY/);
 assert.throws(()=>verifyMount({persistent_storages:[]}),/VOLUME/);
 assert.throws(()=>verifyMount({persistent_storages:[{mount_path:'/data'},{mount_path:'/data'}]}),/VOLUME/);
 assert.equal(verifyMount({persistent_storages:[{mount_path:'/data'}]}),true);
 assert.throws(()=>verifyHistory([{status:'queued'}],'core'),/ALREADY_ACTIVE/);
 assert.throws(()=>verifyHistory([],'core'),/NO_PREVIOUS_RELEASE/);
 assert.equal(verifyHistory([{status:'finished',commit:SHA}],'core'),true);
 assert.throws(()=>verifySession({configured:false,authenticated:false}),/OWNER_SESSION/);
 assert.equal(verifySession({configured:true,authenticated:false}),true);
 assert.throws(()=>queuedDeployment({deployments:[]},'core-123456'),/NOT_QUEUED/);
});
test('preflight failure never writes Coolify',async()=>{
 const calls=[];
 const stub=async (url,opts)=>{
  calls.push([url,opts.method]);
  if(url.endsWith('/applications'))return response(apps);
  if(url.endsWith('core-123456'))return response(core);
  if(url.endsWith('ui-123456'))return response(ui);
  if(url.includes('/deployments/applications/'))return response([{status:'finished',commit:SHA}]);
  if(url.endsWith('/storages'))return response({persistent_storages:[]});
  throw Error('unplanned');
 };
 await assert.rejects(run({request:stub,token:'stub',sha:SHA}),/CORE_DATA_VOLUME/);
 assert.ok(calls.every(x=>x[1]==='GET'));
});
test('exact Core then UI deployment and postdeploy gateway verification',async()=>{
 const calls=[];let coreDone=false,uiDone=false;
 const stub=async (url,opts)=>{
  calls.push([url,opts.method]);
  if(url.endsWith('/applications'))return response(apps);
  if(url.endsWith('core-123456'))return response(core);
  if(url.endsWith('ui-123456'))return response(ui);
  if(url.includes('/deployments/applications/'))return response([{status:'finished',commit:SHA}]);
  if(url.endsWith('core-123456/storages'))return response({persistent_storages:[{mount_path:'/data'}]});
  if(url.endsWith('/api/auth/session'))return response({configured:true,authenticated:false});
  if(url===HOST+'/')return response('<script src="/assets/index-'+(uiDone?'new':'old')+'.js"></script>');
  if(url.endsWith('/api/gateway/health'))return response('',coreDone?200:404);
  if(url.endsWith('/api/health'))return response('');
  if(url.includes('deploy?uuid=core-123456'))return response({deployments:[{resource_uuid:'core-123456',deployment_uuid:'deploycore'}]});
  if(url.includes('deploy?uuid=ui-123456'))return response({deployments:[{resource_uuid:'ui-123456',deployment_uuid:'deployui'}]});
  if(url.endsWith('/deployments/deploycore')){coreDone=true;return response({status:'finished',commit:SHA});}
  if(url.endsWith('/deployments/deployui')){uiDone=true;return response({status:'finished',commit:SHA});}
  throw Error('unexpected request');
 };
 const logs=[];
 await run({request:stub,token:'fake-token',sha:SHA,pause:async()=>{},log:s=>logs.push(s)});
 assert.ok(logs.some(s=>s.includes('taso_live_recovery=SUCCESS')));
 const writes=calls.filter(x=>x[1]==='POST');
 assert.equal(writes.length,2);
 assert.ok(writes[0][0].includes('uuid=core-123456'));
 assert.ok(writes[1][0].includes('uuid=ui-123456'));
 assert.ok(calls.every(x=>['GET','POST'].includes(x[1])));
});