#!/usr/bin/env node
// One-shot explicit operator backup waiver. Only existing Coolify apps.
// No mutation of env vars, auth secrets, volumes, backup schedules or network.
const API = 'https://coolify.tasarlayalim.com/api/v1';
const PUBLIC = 'https://taso.tasarlayalim.com';
const REPO = 'hasanmertproje/tasarlayalim-infra';
const SHA = /^[a-f0-9]{40}$/i;
const UUID = /^[a-zA-Z0-9_-]{5,64}$/;
const SERVICES = Object.freeze([
  {name:'taso-search-prod',base:'/docker/taso-search'},
  {name:'taso-browser-prod',base:'/docker/taso-browser'},
  {name:'taso-speaker-prod',base:'/docker/taso-speaker',mount:'/data'},
  {name:'taso-core-prod',base:'/taso',mount:'/data'},
  {name:'taso-ui-prod',base:'/taso-ui'},
  {name:'taso-voice-prod',base:'/docker/taso-voice',mount:'/voices',canBeStopped:true},
]);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rows=x=>Array.isArray(x)?x:Array.isArray(x?.deployments)?x.deployments:null;
export function identify(apps){
  if(!Array.isArray(apps))throw Error('APPLICATION_INVENTORY_UNAVAILABLE');
  const matches={};
  for(const service of SERVICES){
    const found=apps.filter(x=>x?.name===service.name);
    if(found.length!==1||!UUID.test(found[0]?.uuid||''))throw Error(service.name+'_NOT_UNIQUE');
    matches[service.name]={...service,uuid:found[0].uuid};
  }
  const owners=apps.filter(x=>String(x?.fqdn||'').split(',').some(v=>v.trim()===PUBLIC));
  if(owners.length!==1||owners[0].uuid!==matches['taso-ui-prod'].uuid)throw Error('PUBLIC_DOMAIN_OWNERSHIP_INVALID');
  return matches;
}
export function verifyDetail(app,service){
  if(app?.name!==service.name||app?.git_repository!==REPO||app?.git_branch!=='main'||
    app?.base_directory!==service.base||app?.environment_id!==2||app?.uuid!==service.uuid)
    throw Error(service.name+'_IDENTITY_MISMATCH');
  if(app?.status!=='running:healthy'&&app?.status!=='running:unknown'&&app?.status!=='running'&&
    !(service.canBeStopped&&/^(stopped|exited:)/.test(String(app?.status))))
    throw Error(service.name+'_UNHEALTHY_PREDEPLOY');
}
export function verifyStorage(payload,service){
  if(!service.mount)return;
  if(!Array.isArray(payload?.persistent_storages)||
    payload.persistent_storages.filter(x=>x?.mount_path===service.mount).length!==1)
    throw Error(service.name+'_PERSISTENT_VOLUME_UNVERIFIED');
}
export function verifyHistory(history,name){
  const all=rows(history);
  if(!all)throw Error(name+'_HISTORY_UNVERIFIABLE');
  if(all.some(x=>['queued','pending','in_progress','running'].includes(x?.status)))
    throw Error(name+'_DEPLOYMENT_IN_PROGRESS');
  if(!all.some(x=>x?.status==='finished'&&SHA.test(x?.commit||x?.git_commit_sha||'')))
    throw Error(name+'_NO_KNOWN_ROLLBACK_SHA');
}
export function verifyAuth(session){
  if(session?.configured!==true||session?.authenticated!==false)throw Error('AUTH_BOUNDARY_UNVERIFIED');
}
export function verifyGateway(coreEnvs,uiEnvs){
  const pick=a=>Array.isArray(a)?a.filter(x=>x?.key==='TASO_GATEWAY_SECRET'&&x?.is_preview!==true):[];
  const c=pick(coreEnvs),u=pick(uiEnvs);
  if(c.length!==1||u.length!==1)throw Error('GATEWAY_KEY_METADATA_INVALID');
  const secret=row=>{
    const v=row.real_value||row.value||'';
    if(typeof v!=='string'||!v||/^\*+$/.test(v)||/^•+$/.test(v)||/^(masked|redacted)$/i.test(v))return null;
    return v;
  };
  const a=secret(c[0]),b=secret(u[0]);
  if(a!==null&&b!==null&&a!==b)throw Error('GATEWAY_SECRET_MISMATCH_REFUSE_ROTATION');
  return a!==null&&b!==null?'EQUAL':'KEYS_PRESENT_CONTENT_UNVERIFIABLE';
}
export function queued(body,uuid){
  const matches=rows(body)?.filter(x=>x?.resource_uuid===uuid&&UUID.test(x?.deployment_uuid||''))||[];
  if(matches.length!==1)throw Error('DEPLOYMENT_NOT_QUEUED');
  return matches[0].deployment_uuid;
}
export async function release({token,sha,waiver,request=fetch,pause=wait,log=console.log}={}){
  if(!token||!SHA.test(sha||'')||waiver!=='2026-10-20-explicit-operator-waiver')throw Error('RELEASE_AUTH_SHA_OR_WAIVER_INVALID');
  const api=async(method,path)=>{
    const response=await request(API+'/'+path,{method,redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if(!response.ok)throw Error('COOLIFY_'+method+'_HTTP_'+response.status);
    return response.json();
  };
  const publicGet=async path=>request(PUBLIC+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)});
  const app=identify(await api('GET','applications'));
  // All checks must pass before the first POST.
  for(const service of SERVICES){
    const target=app[service.name];
    verifyDetail(await api('GET','applications/'+target.uuid),target);
    verifyHistory(await api('GET','deployments/applications/'+target.uuid+'?skip=0&take=25'),target.name);
    if(target.mount)verifyStorage(await api('GET','applications/'+target.uuid+'/storages'),target);
    log('preflight_checked='+target.name);
  }
  const auth=await publicGet('/api/auth/session');
  if(auth.status!==200)throw Error('AUTH_PREFLIGHT_HTTP_'+auth.status);
  verifyAuth(await auth.json());
  const gateway=verifyGateway(await api('GET','applications/'+app['taso-core-prod'].uuid+'/envs'),
    await api('GET','applications/'+app['taso-ui-prod'].uuid+'/envs'));
  log('one_shot_preflight=PASS s3_requirement=WAIVED_BY_OPERATOR existing_apps=6 persistent_volumes=UNCHANGED gateway='+gateway);
  async function deploy(service){
    const id=service.uuid;
    const ticket=queued(await api('POST','deploy?uuid='+encodeURIComponent(id)),id);
    log('deploy_started='+service.name+' expected_sha='+sha);
    let done=false;
    for(let i=0;i<150;i++){
      await pause(12000);
      const result=await api('GET','deployments/'+ticket);
      if(['failed','cancelled','cancelled-by-user'].includes(result?.status))throw Error(service.name+'_DEPLOY_FAILED');
      if(result?.status==='finished'){
        if(String(result.commit||result.git_commit_sha||'').toLowerCase()!==sha.toLowerCase())
          throw Error(service.name+'_DEPLOYED_SHA_UNVERIFIED');
        done=true;break;
      }
    }
    if(!done)throw Error(service.name+'_DEPLOY_TIMEOUT');
    let healthy=false;
    for(let i=0;i<30;i++){
      const current=await api('GET','applications/'+id);
      if(['running:healthy','running:unknown','running'].includes(current?.status)){healthy=true;break;}
      await pause(10000);
    }
    if(!healthy)throw Error(service.name+'_RUNTIME_NOT_RUNNING');
    log('deploy_finished='+service.name+' sha='+sha+' runtime=RUNNING');
  }
  // Voice last: a large CPU image cannot block updating Core/UI.
  for(const service of SERVICES){
    await deploy(app[service.name]);
    if(service.name==='taso-core-prod'){
      const gatewayHealth=await publicGet('/api/gateway/health');
      if(gatewayHealth.status!==200)throw Error('CORE_GATEWAY_HEALTH_HTTP_'+gatewayHealth.status);
    }
  }
  for(const path of ['/','/health','/api/health','/api/gateway/health','/api/auth/session']){
    const result=await publicGet(path);
    if(result.status!==200)throw Error('POSTDEPLOY_HTTP_'+result.status);
    if(path==='/api/auth/session')verifyAuth(await result.json());
  }
  log('production_one_shot=SUCCESS services=6 target_sha='+sha+' s3_waived=true backup_restore=UNVERIFIED');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{await release({token:process.env.COOLIFY_API_TOKEN,sha:process.env.GITHUB_SHA,waiver:process.env.TASO_ONE_SHOT_BACKUP_WAIVER});}
  catch(e){const message=e instanceof Error&&/^[A-Za-z0-9_-]+$/.test(e.message)?e.message:
      (e instanceof TypeError&&e.message==='fetch failed'?'NETWORK_FETCH_FAILED':'UNCLASSIFIED');
    console.error('production_one_shot=FAILED reason='+message);process.exitCode=1;}
}
