import test from 'node:test';
import assert from 'node:assert/strict';
import {identify,verifyDetail,verifyStorage,verifyHistory,verifyAuth,verifyGateway,queued,release} from '../scripts/taso-production-one-shot-20261020.mjs';
const sha='a'.repeat(40), pub='https://taso.tasarlayalim.com';
const defs=[['taso-search-prod','/docker/taso-search'],['taso-browser-prod','/docker/taso-browser'],
  ['taso-speaker-prod','/docker/taso-speaker'],['taso-core-prod','/taso'],
  ['taso-ui-prod','/taso-ui'],['taso-voice-prod','/docker/taso-voice']];
const apps=defs.map(([name],i)=>({name,uuid:'test-app-'+i,fqdn:name==='taso-ui-prod'?pub:''}));
const details=Object.fromEntries(defs.map(([name,base],i)=>[name,{...apps[i],base_directory:base,
  git_repository:'hasanmertproje/tasarlayalim-infra',git_branch:'main',environment_id:2,
  status:name==='taso-voice-prod'?'stopped':'running:healthy'}]));
const env=[{key:'TASO_GATEWAY_SECRET',real_value:'test-matching-secret'}];
const response=(body,status=200)=>({ok:status===200,status,json:async()=>body});
function fake({badMount=false,mismatch=false,badAuth=false,failedAt=null}={}){
  const calls=[],deployments=new Map(),running=new Set();
  const run=async(url,options)=>{
    const path=url.replace(/^https:\/\/coolify\.tasarlayalim\.com\/api\/v1\//,'');
    calls.push({path,method:options.method});
    if(path==='applications')return response(apps);
    if(path.startsWith(pub)){
      if(path.endsWith('/api/auth/session'))return response({configured:!badAuth,authenticated:false});
      return response({},200);
    }
    const item=apps.map(a=>a.uuid).find(id=>path.includes(id));
    const name=item?apps.find(a=>a.uuid===item).name:null;
    if(path.startsWith('applications/')&&!path.includes('/storages')&&!path.includes('/envs'))
      return response(running.has(name)?{...details[name],status:'running:healthy'}:details[name]);
    if(path.includes('/storages'))
      return response({persistent_storages:badMount&&name==='taso-core-prod'?[]:
        [{mount_path:name==='taso-voice-prod'?'/voices':'/data'}]});
    if(path.includes('/envs'))return response(name==='taso-ui-prod'&&mismatch?
      [{key:'TASO_GATEWAY_SECRET',real_value:'different'}]:env);
    if(path.startsWith('deployments/applications/'))return response([{status:'finished',commit:sha}]);
    if(path.startsWith('deploy?uuid=')){
      const uuid=path.split('=')[1],n=apps.find(a=>a.uuid===uuid).name;
      const ticket='ticket-'+uuid;deployments.set(ticket,{n});
      return response({deployments:[{resource_uuid:uuid,deployment_uuid:ticket}]});
    }
    if(path.startsWith('deployments/ticket-')){
      const state=deployments.get(path.slice('deployments/'.length));
      if(state.n!==failedAt)running.add(state.n);
      return response({status:state.n===failedAt?'failed':'finished',commit:sha});
    }
    throw Error('UNEXPECTED_TEST_REQUEST '+path);
  };
  return {run,calls};
}
test('source, ownership, volume, auth, history and queue fail closed',()=>{
  const found=identify(apps);
  assert.equal(Object.keys(found).length,6);
  assert.throws(()=>identify([...apps,apps[0]]),/NOT_UNIQUE/);
  assert.throws(()=>identify([...apps,{name:'other',uuid:'another-app',fqdn:pub}]),/PUBLIC_DOMAIN/);
  assert.throws(()=>verifyDetail({...details['taso-core-prod'],git_branch:'dev'},found['taso-core-prod']),/IDENTITY/);
  assert.throws(()=>verifyStorage({persistent_storages:[]},found['taso-core-prod']),/PERSISTENT_VOLUME/);
  assert.throws(()=>verifyHistory([{status:'pending'}],'test'),/IN_PROGRESS/);
  assert.throws(()=>verifyHistory([],'test'),/NO_KNOWN_ROLLBACK/);
  assert.throws(()=>verifyAuth({configured:false,authenticated:false}),/AUTH_BOUNDARY/);
  assert.throws(()=>queued({deployments:[]},'test-app-0'),/DEPLOYMENT_NOT_QUEUED/);
});
test('gateway mismatch refuses release; masked values are never printed',()=>{
  assert.equal(verifyGateway(env,env),'EQUAL');
  assert.throws(()=>verifyGateway(env,[{key:'TASO_GATEWAY_SECRET',real_value:'different'}]),/MISMATCH/);
  assert.equal(verifyGateway([{key:'TASO_GATEWAY_SECRET',value:'****'}],
    [{key:'TASO_GATEWAY_SECRET',value:'****'}]),'KEYS_PRESENT_CONTENT_UNVERIFIABLE');
});
test('missing waiver or missing production Core volume never writes',async()=>{
  const f=fake({badMount:true});
  await assert.rejects(release({request:f.run,token:'fake',sha,waiver:'wrong'}),/WAIVER_INVALID/);
  assert.equal(f.calls.length,0);
  await assert.rejects(release({request:f.run,token:'fake',sha,
    waiver:'2026-10-20-explicit-operator-waiver'}),/PERSISTENT_VOLUME/);
  assert.ok(f.calls.every(x=>x.method==='GET'));
});
test('auth or gateway mismatch never writes',async()=>{
  for(const opts of [{badAuth:true},{mismatch:true}]){
    const f=fake(opts);
    await assert.rejects(release({request:f.run,token:'fake',sha,
      waiver:'2026-10-20-explicit-operator-waiver'}));
    assert.ok(f.calls.every(x=>x.method==='GET'));
  }
});
test('six existing apps deploy in order; no environment, storage or backup mutation',async()=>{
  const f=fake(),logs=[];
  await release({request:f.run,token:'fake',sha,waiver:'2026-10-20-explicit-operator-waiver',
    pause:async()=>{},log:s=>logs.push(s)});
  assert.deepEqual(f.calls.filter(x=>x.method==='POST').map(x=>x.path),
    apps.map(x=>'deploy?uuid='+x.uuid));
  assert.ok(f.calls.every(x=>['GET','POST'].includes(x.method)));
  assert.ok(logs.some(x=>x.includes('production_one_shot=SUCCESS')));
});
test('failed deployment prevents deploying subsequent apps and does not retry blindly',async()=>{
  const f=fake({failedAt:'taso-browser-prod'});
  await assert.rejects(release({request:f.run,token:'fake',sha,
    waiver:'2026-10-20-explicit-operator-waiver',pause:async()=>{}}),/taso-browser-prod_DEPLOY_FAILED/);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,2);
});
